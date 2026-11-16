import {expect, test} from 'bun:test'
import type {Project, TimedLine} from '../project.ts'
import {buildRefinement, applyRefinement, refinementFingerprint, prepareTimingRefinement, applyTimingRefinement} from './timing-refinement.ts'
import {mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {applyTiming} from './timing.ts'

const line = (id: number, text: string, start: number, end: number, extra: Partial<TimedLine> = {}): TimedLine => ({
    line: id,
    text,
    start,
    end,
    section: 'Verse',
    sectionIndex: 0,
    confidence: 1,
    words: [{text, start, end}],
    ...extra,
})
const project = (lines: TimedLine[]): Project => ({
    lyricsTiming: {lines},
    music: {durationSec: 100} as Project['music'],
    singing: {singers: ['lead'], lines: []},
})
const candidate = (id: number, text: string, start: number, end: number) => ({line: id, words: [{text, start, end}]})

test('missing transcript evidence preserves sung lines while usable timing can still apply', () => {
    const unknown = line(14, 'Sagst ganz leise', 28.78, 29.78, {
        confidence: 0,
        words: [
            {text: 'Sagst', start: 28.78, end: 29.113},
            {text: 'ganz', start: 29.113, end: 29.447},
            {text: 'leise', start: 29.447, end: 29.78},
        ],
    })
    const data = project([line(13, 'Wange', 27, 28), unknown])
    const before = structuredClone(unknown)
    const report = buildRefinement(data, [candidate(13, 'Wange', 27.1, 28.1)], 'de')
    expect(report.entries.find(e => e.line === 14)?.status).toBe('review')
    expect(report.change.lines.some(l => l.off !== undefined)).toBe(false)
    applyRefinement(data, report, [])
    expect(data.lyricsTiming!.lines[1]).toEqual(before)
    expect(data.lyricsTiming!.lines[0]?.start).toBe(27.1)
})

test('legacy saved proposals cannot hide lines when applied after the fix', () => {
    const data = project([line(0, 'Sung', 1, 2, {confidence: 0})])
    const before = structuredClone(data)
    const report = buildRefinement(data, [], 'de')
    report.change.lines = [{line: 0, off: true}]
    expect(() => applyRefinement(data, report, [])).toThrow('presence')
    expect(data).toEqual(before)
})

test('unmatched placeholders stay visible without vetoing usable neighbours; confirmed presence still protects them', () => {
    for (const confirmed of [false, true]) {
        const data = project([line(0, 'Good', 1, 2), line(1, 'Unknown', 1.9, 7.5, {confidence: 0, ...(confirmed ? {presenceByHand: true} : {})})])
        const report = buildRefinement(data, [candidate(0, 'Good', 1.1, 2.1)], 'de')
        expect(report.change.lines.some(l => l.line === 0)).toBe(!confirmed)
        expect(report.change.lines.some(l => l.off !== undefined)).toBe(false)
    }
})

test('caps Zahl only at an independently anchored next onset; preserves a held Herz', () => {
    const data = project([line(0, 'Zahl', 35, 41), line(1, 'Erwacht', 40.8, 42, {byHand: true}), line(2, 'Herz', 78, 81)])
    const report = buildRefinement(data, [candidate(0, 'Zahl', 35.6, 41.1), candidate(1, 'Erwacht', 41.1, 42), candidate(2, 'Herz', 78.4, 83.82)], 'de')
    expect(report.change.lines.find(l => l.line === 0)?.words?.[0]?.end).toBe(40.8)
    expect(report.change.lines.find(l => l.line === 1)).toBeUndefined()
    expect(report.change.lines.find(l => l.line === 2)?.words?.[0]?.end).toBe(83.82)
})
test('protects anchors and omitted lines; missing text evidence is review-only', () => {
    const data = project([
        line(0, 'Missing', 1, 2, {confidence: 0}),
        line(1, 'Partial', 3, 4, {confidence: 0.2}),
        line(2, 'Anchor', 5, 6, {words: [{text: 'Anchor', start: 5, end: 6, anchor: true}]}),
        line(3, 'Off', 7, 8, {off: true}),
    ])
    const report = buildRefinement(data, [candidate(1, 'Partial', 3.1, 4.1), candidate(2, 'Anchor', 5.1, 6.1), candidate(3, 'Off', 7.1, 8.1)], 'en')
    expect(report.change.lines.map(l => l.line)).toEqual([1])
    expect(report.entries[0]?.status).toBe('review')
    expect(report.change.lines[0]?.off).toBeUndefined()
})
test('does not cut across different singers; rejects collapsed words and large jumps', () => {
    const data = project([line(0, 'A', 1, 4), line(1, 'B', 3, 5, {byHand: true}), line(2, 'C', 6, 7), line(3, 'D', 8, 9)])
    data.singing!.lines = [
        {line: 0, text: 'A', singers: ['a']},
        {line: 1, text: 'B', singers: ['b']},
    ]
    const report = buildRefinement(data, [candidate(0, 'A', 1, 4.2), candidate(2, 'C', 6, 6.01), candidate(3, 'D', 20, 21)], 'fr')
    expect(report.change.lines).toHaveLength(1)
    expect(report.change.lines[0]?.words?.[0]?.end).toBe(4.2)
    expect(report.entries.filter(e => e.status === 'review')).toHaveLength(2)
})
test('automatic application stays unreviewed and preserves text confidence; stale previews cannot apply', () => {
    const data = project([line(0, 'Herz', 78, 81, {confidence: 0.7})])
    const report = buildRefinement(data, [candidate(0, 'Herz', 78.4, 83.82)], 'de')
    const before = refinementFingerprint(data)
    applyRefinement(data, report, [])
    expect(data.lyricsTiming!.lines[0]?.byHand).not.toBe(true)
    expect(data.lyricsTiming!.lines[0]?.confidence).toBe(0.7)
    expect(data.lyricsTiming!.lines[0]?.words[0]?.estimated).toBe(true)
    expect(refinementFingerprint(data)).not.toBe(before)
    expect(() => applyRefinement(data, report, [])).toThrow('changed')
})
test('independently aligned windows cannot introduce a new collision between lines', () => {
    const data = project([line(0, 'mehr', 70, 72.5), line(1, 'Als', 73, 75)])
    const report = buildRefinement(data, [candidate(0, 'mehr', 70.3, 72.82), candidate(1, 'Als', 72.724, 75.4)], 'de')
    expect(report.change.lines).toHaveLength(0)
    expect(report.entries.every(e => e.status === 'review')).toBe(true)
})
test('explicitly re-enabling an unheard line allows a refinement candidate', () => {
    const data = project([line(0, 'Sung', 1, 2, {confidence: 0, off: true})])
    applyTiming(data, {lines: [{line: 0, off: false}]}, [])
    const report = buildRefinement(data, [candidate(0, 'Sung', 1.1, 2.1)], 'de')
    expect(report.entries[0]?.status).toBe('refined')
    expect(report.change.lines[0]?.off).toBeUndefined()
})

test('service prepares without mutation, backs up before applying, and refuses changed vocals', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'timing-refinement-test-'))
    try {
        const data = project([line(0, 'Missing', 1, 2, {confidence: 0})])
        data.stems = {vocals: 'vocals.wav', drums: '', bass: '', other: ''}
        const file = join(dir, 'project.json')
        const original = JSON.stringify(data)
        writeFileSync(file, original)
        writeFileSync(join(dir, 'vocals.wav'), 'unused: no eligible lines, so no model needed')
        const target = {id: 'test-refinement', kind: 'music' as const, dir}
        const report = await prepareTimingRefinement(target, 'de')
        expect(readFileSync(file, 'utf8')).toBe(original)
        await applyTimingRefinement(target, report.id)
        expect(readFileSync(file, 'utf8')).toBe(original)
        expect(report.entries[0]?.status).toBe('review')
        // Supply a deterministic successful acoustic result without running a model.
        const eligible = structuredClone(data)
        eligible.lyricsTiming!.lines[0]!.confidence = 1
        writeFileSync(file, JSON.stringify(eligible))
        const usable = buildRefinement(eligible, [candidate(0, 'Missing', 1.1, 2.1)], 'de')
        const proposalFile = join(dir, '.timing-refinement', 'proposal.json')
        writeFileSync(proposalFile, JSON.stringify({...JSON.parse(readFileSync(proposalFile, 'utf8')), ...usable}))
        await applyTimingRefinement(target, usable.id)
        expect(JSON.parse(readFileSync(file, 'utf8')).lyricsTiming.lines[0].start).toBe(1.1)
        const backup = readdirSync(join(dir, '.timing-refinement')).find(f => f.startsWith('before-'))!
        expect(JSON.parse(readFileSync(join(dir, '.timing-refinement', backup), 'utf8'))).toEqual(eligible.lyricsTiming)
        writeFileSync(file, original)
        const next = await prepareTimingRefinement(target, 'de')
        writeFileSync(join(dir, 'vocals.wav'), 'changed')
        await expect(applyTimingRefinement(target, next.id)).rejects.toThrow('Vocals changed')
        expect(readFileSync(file, 'utf8')).toBe(original)
    } finally {
        rmSync(dir, {recursive: true, force: true})
    }
})

test('taking only some lines of a proposal: the others stay, and the rest of the proposal still fits', () => {
    const data = project([line(0, 'One', 1, 2), line(1, 'Two', 10, 11), line(2, 'Three', 20, 21)])
    const report = buildRefinement(data, [candidate(0, 'One', 1.4, 2.4), candidate(1, 'Two', 10.4, 11.4), candidate(2, 'Three', 20.4, 21.4)], 'de')
    expect(report.change.lines.length).toBe(3)
    applyRefinement(data, report, [], [1])
    expect(data.lyricsTiming!.lines.map(l => l.start)).toEqual([1, 10.4, 20])
    expect(() => applyRefinement(data, report, [], [1])).toThrow('Timing or singers changed')
})
test('a line is not taken alone when it would run into a neighbour that keeps its times', () => {
    const data = project([line(0, 'One', 1, 5), line(1, 'Two', 5.1, 9)])
    const report = buildRefinement(data, [candidate(0, 'One', 1.5, 4.9), candidate(1, 'Two', 5.4, 9.4)], 'de')
    expect(report.change.lines.length).toBe(2)
    report.change.lines[0]!.words![0]!.end = 5.3
    expect(() => applyRefinement(data, report, [], [0])).toThrow('keeps its times')
    expect(data.lyricsTiming!.lines[0]!.end).toBe(5)
    applyRefinement(data, report, [], [1])
    expect(data.lyricsTiming!.lines[1]!.start).toBe(5.4)
})
