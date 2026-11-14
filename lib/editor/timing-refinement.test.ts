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

test('caps Zahl only at an independently anchored next onset; preserves a held Herz', () => {
    const data = project([line(0, 'Zahl', 35, 41), line(1, 'Erwacht', 40.8, 42, {byHand: true}), line(2, 'Herz', 78, 81)])
    const report = buildRefinement(data, [candidate(0, 'Zahl', 35.6, 41.1), candidate(1, 'Erwacht', 41.1, 42), candidate(2, 'Herz', 78.4, 83.82)], 'de')
    expect(report.change.lines.find(l => l.line === 0)?.words?.[0]?.end).toBe(40.8)
    expect(report.change.lines.find(l => l.line === 1)).toBeUndefined()
    expect(report.change.lines.find(l => l.line === 2)?.words?.[0]?.end).toBe(83.82)
})
test('protects anchors, omitted lines and partially heard lyrics; only proposes omission without any text evidence', () => {
    const data = project([
        line(0, 'Missing', 1, 2, {confidence: 0}),
        line(1, 'Partial', 3, 4, {confidence: 0.2}),
        line(2, 'Anchor', 5, 6, {words: [{text: 'Anchor', start: 5, end: 6, anchor: true}]}),
        line(3, 'Off', 7, 8, {off: true}),
    ])
    const report = buildRefinement(data, [candidate(1, 'Partial', 3.1, 4.1), candidate(2, 'Anchor', 5.1, 6.1), candidate(3, 'Off', 7.1, 8.1)], 'en')
    expect(report.change.lines.map(l => l.line)).toEqual([0, 1])
    expect(report.change.lines[0]).toEqual({line: 0, off: true})
    expect(report.change.lines[1]?.off).toBeUndefined()
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
test('explicitly re-enabling an unheard line prevents future automatic omission', () => {
    const data = project([line(0, 'Sung', 1, 2, {confidence: 0})])
    applyRefinement(data, buildRefinement(data, [], 'de'), [])
    expect(data.lyricsTiming!.lines[0]?.off).toBe(true)
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
        expect(JSON.parse(readFileSync(file, 'utf8')).lyricsTiming.lines[0].off).toBe(true)
        const backup = readdirSync(join(dir, '.timing-refinement')).find(f => f.startsWith('before-'))!
        expect(JSON.parse(readFileSync(join(dir, '.timing-refinement', backup), 'utf8'))).toEqual(data.lyricsTiming)
        writeFileSync(file, original)
        const next = await prepareTimingRefinement(target, 'de')
        writeFileSync(join(dir, 'vocals.wav'), 'changed')
        await expect(applyTimingRefinement(target, next.id)).rejects.toThrow('Vocals changed')
        expect(readFileSync(file, 'utf8')).toBe(original)
    } finally {
        rmSync(dir, {recursive: true, force: true})
    }
})
