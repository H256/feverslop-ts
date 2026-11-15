import {expect, test} from 'bun:test'
import type {Project, TimedLine} from '../project.ts'
import {passageInput} from './timing-passage.ts'
import {applyRefinement, buildPassageRefinement} from './timing-refinement.ts'
import {applyTiming} from './timing.ts'
const line = (n: number, extra: Partial<TimedLine> = {}): TimedLine => ({
    line: n,
    text: `word${n}`,
    section: 'Verse',
    sectionIndex: 0,
    start: n * 3,
    end: n * 3 + 2,
    confidence: 1,
    words: [{text: `word${n}`, start: n * 3, end: n * 3 + 2}],
    ...extra,
})
const fixture = (): Project => ({music: {durationSec: 60} as Project['music'], lyricsTiming: {lines: Array.from({length: 10}, (_, n) => line(n))}})
const candidate = (n: number, start = n * 3 + 0.1) => ({line: n, words: [{text: `word${n}`, start, end: start + 2}]})

test('move, save, then refine words inside the saved block without touching neighbours', () => {
    const data = fixture()
    applyTiming(data, {lines: [{line: 4, words: [{start: 12.5, end: 14.8}]}]}, [])
    expect(data.lyricsTiming!.lines[4]!.byHand).toBe(true)
    const before = structuredClone(data)
    const request = {line: 4, confirmSung: true, mode: 'line-window'} as const
    const input = passageInput(data, request)
    expect(input.window).toMatchObject({start: 12.5, end: 14.8, targets: [4], bounded: true})
    expect(input.lines.map(l => l.line)).toEqual([4])
    const report = buildPassageRefinement(data, [candidate(4, 12.6), candidate(5)], 'de', request)
    expect(report.change.lines.map(l => l.line)).toEqual([4])
    expect(data).toEqual(before)
    applyRefinement(data, report, [])
    expect(data.lyricsTiming!.lines[4]!.start).toBe(12.6)
    expect(data.lyricsTiming!.lines[4]!.byHand).toBe(true)
    expect(data.lyricsTiming!.lines[5]).toEqual(before.lyricsTiming!.lines[5])
    const outside = buildPassageRefinement(before, [candidate(4, 12.4)], 'de', request)
    expect(outside.change.lines).toEqual([])
})

test('confirmed missing line joins a single bounded context, only target and following line are editable', () => {
    const data = fixture()
    Object.assign(data.lyricsTiming!.lines[4]!, {off: true, confidence: 0})
    const before = structuredClone(data)
    const input = passageInput(data, {line: 4, confirmSung: true})
    expect(input.lines.map(l => l.line)).toEqual([1, 2, 3, 4, 5, 6])
    expect(input.window.targets).toEqual([4, 5])
    expect(input.window.end - input.window.start).toBeLessThanOrEqual(30)
    expect(data).toEqual(before)
    const report = buildPassageRefinement(data, [candidate(3), candidate(4), candidate(5), candidate(6)], 'de', {line: 4, confirmSung: true})
    expect(report.change.lines.map(l => l.line)).toEqual([4, 5])
    expect(data).toEqual(before)
    applyRefinement(data, report, [])
    expect(data.lyricsTiming!.lines[4]).toMatchObject({presenceByHand: true, confidence: 0, start: 12.1})
    expect(data.lyricsTiming!.lines[4]!.off).toBeUndefined()
    expect(data.lyricsTiming!.lines[4]!.byHand).not.toBe(true)
    expect(data.lyricsTiming!.lines[3]).toEqual(before.lyricsTiming!.lines[3])
    expect(data.lyricsTiming!.lines[6]).toEqual(before.lyricsTiming!.lines[6])
})
test('confirmation is mandatory; manual target stays protected and protected neighbours are context only', () => {
    const data = fixture()
    expect(() => passageInput(data, {line: 4, confirmSung: false} as never)).toThrow('Confirm')
    data.lyricsTiming!.lines[5]!.byHand = true
    expect(passageInput(data, {line: 4, confirmSung: true}).window.targets).toEqual([4])
    data.lyricsTiming!.lines[4]!.words[0]!.anchor = true
    expect(() => passageInput(data, {line: 4, confirmSung: true})).toThrow('protected')
})
test('unusable target cannot apply a neighbour or persist presence', () => {
    const data = fixture()
    Object.assign(data.lyricsTiming!.lines[4]!, {confidence: 0, off: true})
    const report = buildPassageRefinement(data, [candidate(4, 40), candidate(5)], 'de', {line: 4, confirmSung: true})
    expect(report.change.lines).toEqual([])
    const before = structuredClone(data)
    expect(() => applyRefinement(data, report, [])).toThrow('selected line')
    expect(data).toEqual(before)
})
test('long passages and missing targets are rejected instead of silently clipping audio', () => {
    const data = fixture()
    expect(() => passageInput(data, {line: 100, confirmSung: true})).toThrow()
    data.lyricsTiming!.lines[4]!.end = 55
    expect(() => passageInput(data, {line: 4, confirmSung: true})).toThrow('30')
})

test('eligible neighbour failure withholds the entire passage; stale and out-of-scope proposals cannot apply', () => {
    const data = fixture()
    const partial = buildPassageRefinement(data, [candidate(4)], 'de', {line: 4, confirmSung: true})
    expect(partial.change.lines).toEqual([])
    const report = buildPassageRefinement(data, [candidate(4), candidate(5)], 'de', {line: 4, confirmSung: true})
    const before = structuredClone(data)
    const forged = structuredClone(report)
    forged.change.lines.push({line: 6, words: candidate(6).words})
    expect(() => applyRefinement(data, forged, [])).toThrow()
    expect(data).toEqual(before)
    data.lyricsTiming!.lines[3]!.byHand = true
    expect(() => applyRefinement(data, report, [])).toThrow('changed')
    expect(data.lyricsTiming!.lines[4]).toEqual(before.lyricsTiming!.lines[4])
})

test('presence-only confirmation persists without claiming timing was reviewed', () => {
    const data = fixture()
    data.lyricsTiming!.lines[4]!.confidence = 0
    data.lyricsTiming!.lines[4]!.words[0]!.estimated = true
    data.lyricsTiming!.lines[5]!.off = true
    const report = buildPassageRefinement(data, [candidate(4, 12)], 'de', {line: 4, confirmSung: true})
    expect(report.passage!.targets).toEqual([4])
    const result = applyRefinement(data, report, [])
    expect(result.changed).toEqual([4])
    expect(data.lyricsTiming!.lines[4]).toMatchObject({presenceByHand: true, confidence: 0, start: 12})
    expect(data.lyricsTiming!.lines[4]!.byHand).toBeUndefined()
    expect(data.lyricsTiming!.lines[5]!.off).toBe(true)
})
