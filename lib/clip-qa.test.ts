import {describe, expect, test} from 'bun:test'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {bestTake, findProblems, frameStats, type FrameStats, QA, scoreOf} from './clip-qa.ts'

// frame stats as a clip at 24 fps gives them: how bright, the bright peak, how much changed since the frame before
const FPS = 24
const moving = (n: number, mean = 90): FrameStats[] => Array.from({length: n}, (_, i) => ({mean, peak: 200, diff: i ? 3 + (i % 3) : 0}))
const at = (stats: FrameStats[], from: number, length: number, frame: Partial<FrameStats>) =>
    stats.map((s, i) => (i >= from && i < from + length ? {...s, ...frame} : s))

describe('what a rendered clip came out with (#405)', () => {
    test('normal movement, and a dark night scene with a lit window, are nothing', () => {
        expect(findProblems(moving(168), FPS)).toEqual([])
        expect(
            findProblems(
                moving(168, 3).map(s => ({...s, peak: 60})),
                FPS,
            ),
        ).toEqual([])
    })
    test('black frames: dark and without a bright spot, at least a quarter second', () => {
        expect(findProblems(at(moving(168), 48, 24, {mean: 1, peak: 6, diff: 0}), FPS)).toEqual([{kind: 'black', at: 2, seconds: 1}])
        // four frames are a flash, not a black stretch
        expect(findProblems(at(moving(168), 48, 4, {mean: 1, peak: 6}), FPS).filter(f => f.kind === 'black')).toEqual([])
    })
    test('a picture that stands still for more than 1.5 s - only where there is light enough to see a move', () => {
        expect(findProblems(at(moving(168), 72, 48, {diff: 0.05}), FPS)).toEqual([{kind: 'frozen', at: 3, seconds: 2}])
        expect(findProblems(at(moving(168, 10), 72, 48, {diff: 0.05}), FPS)).toEqual([])
        expect(findProblems(at(moving(168), 72, 24, {diff: 0.05}), FPS)).toEqual([])
    })
    test('a jump: one frame changes far more than the clip moves - unless the plan cuts there', () => {
        const jumped = at(moving(168), 84, 1, {diff: 60})
        expect(findProblems(jumped, FPS)).toEqual([{kind: 'cut', at: 3.5, seconds: 0}])
        expect(findProblems(jumped, FPS, [3.2])).toEqual([])
        expect(findProblems(jumped, FPS, [3.5 + QA.planned + 0.2])).toEqual([{kind: 'cut', at: 3.5, seconds: 0}])
    })
    test('the better of two takes has the lower score: each finding 10, and its length on top', () => {
        expect(scoreOf([])).toBe(0)
        expect(scoreOf([{kind: 'black', at: 2, seconds: 1}])).toBe(11)
        expect(scoreOf([{kind: 'cut', at: 3, seconds: 0}])).toBeLessThan(scoreOf([{kind: 'frozen', at: 0, seconds: 2}]))
    })
    test('the stats of a frame: mean, the 99th percentile and the difference to the frame before', () => {
        const frame = new Uint8Array(100).fill(10)
        frame[99] = 250
        expect(frameStats(frame)).toEqual({mean: 12.4, peak: 10, diff: 0})
        expect(frameStats(new Uint8Array(100).fill(20), new Uint8Array(100).fill(10)).diff).toBe(10)
    })
})

describe('the best take of a clip (#405)', () => {
    const black = [{kind: 'black' as const, at: 2, seconds: 1}]
    const setup = () => {
        const dir = mkdtempSync(join(tmpdir(), 'clip-qa-'))
        const target = join(dir, 'videos', 'slot-001.mp4')
        mkdirSync(join(dir, 'videos'))
        writeFileSync(target, 'take 1')
        writeFileSync(`${target}.json`, '{"seed": 100}')
        return {dir, target, putAway: (seed: number) => join(dir, 'old', 'qa', `slot-001-seed-${seed}`)}
    }
    test('a black take is rendered again with a derived seed; the better new one is kept, the first put away with its sidecar', async () => {
        const {dir, target, putAway} = setup()
        const found = [black, []]
        const seeds: number[] = []
        const best = await bestTake({
            target,
            seed: 100,
            retries: 1,
            putAway,
            check: async () => found.shift()!,
            again: async seed => {
                seeds.push(seed)
                writeFileSync(target, 'take 2')
                writeFileSync(`${target}.json`, `{"seed": ${seed}}`)
                return seed
            },
        })
        expect(seeds).toEqual([100 + 7919])
        expect(best).toEqual({seed: 8019, findings: []})
        expect(readFileSync(target, 'utf8')).toBe('take 2')
        expect(readFileSync(join(putAway(100), 'slot-001.mp4'), 'utf8')).toBe('take 1')
        expect(existsSync(join(putAway(100), 'slot-001.mp4.json'))).toBe(true)
        rmSync(dir, {recursive: true, force: true})
    })
    test('a new take that is worse goes away, and the first comes back', async () => {
        const {dir, target, putAway} = setup()
        const found = [black, [...black, {kind: 'frozen' as const, at: 4, seconds: 2}]]
        const best = await bestTake({
            target,
            seed: 100,
            retries: 1,
            putAway,
            check: async () => found.shift()!,
            again: async seed => {
                writeFileSync(target, 'take 2')
                return seed
            },
        })
        expect(best).toEqual({seed: 100, findings: black})
        expect(readFileSync(target, 'utf8')).toBe('take 1')
        expect(readFileSync(join(putAway(8019), 'slot-001.mp4'), 'utf8')).toBe('take 2')
        rmSync(dir, {recursive: true, force: true})
    })
    test('without qaRetries, or with only a jump, nothing is rendered again', async () => {
        const {dir, target, putAway} = setup()
        let again = 0
        await bestTake({
            target,
            seed: 100,
            retries: 0,
            putAway,
            check: async () => black,
            again: async s => {
                again++
                return s
            },
        })
        await bestTake({
            target,
            seed: 100,
            retries: 2,
            putAway,
            check: async () => [{kind: 'cut', at: 1, seconds: 0}],
            again: async s => {
                again++
                return s
            },
        })
        expect(again).toBe(0)
        rmSync(dir, {recursive: true, force: true})
    })
})
