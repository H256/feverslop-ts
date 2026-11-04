import {describe, expect, test} from "bun:test";
import type {Project} from "../project.ts";
import {applyTiming, outdatedClips, timingView} from "./timing.ts";

// two clips: slot-001 0-4 s (beat b1), slot-002 4-8 s (beat b2). Line 0 "we rise" in the first, line 1 "and fall" in the
// second - but line 1 is barely found: its words are a guess at 6 s, the singer really sings it at 2.5 s, in the first clip
const words = (texts: string[], at: number) => texts.map((text, n) => ({text, start: at + n * 0.5, end: at + n * 0.5 + 0.4}))
const project = (): Project => {
    const timing = {lines: [
        {line: 0, sectionIndex: 0, section: 'Verse', text: 'we rise', start: 0.5, end: 1.4, words: words(['we', 'rise'], 0.5), confidence: 1},
        {line: 1, sectionIndex: 0, section: 'Verse', text: 'and fall', start: 6, end: 6.9, words: words(['and', 'fall'], 6), confidence: 0.2},
    ]}
    const slot = (id: string, start: number, end: number) => ({id, index: 0, section: 'Verse', start, end, bars: 2, energy: .5, lyrics: []})
    return {
        music: {durationSec: 8} as Project['music'],
        lyricsTiming: timing,
        timeline: {maxClipSec: 8, barsPerSlot: 2, aligned: true, sections: [], slots: [
            {...slot('slot-001', 0, 4), vocals: [{line: 0, text: 'we rise', start: 0.5, end: 1.4, words: words(['we', 'rise'], 0.5)}]},
            {...slot('slot-002', 4, 8), vocals: [{line: 1, text: 'and fall', start: 2, end: 2.9, words: words(['and', 'fall'], 2)}]},
        ]},
        mapping: [{slotId: 'slot-001', beatId: 'b1'}, {slotId: 'slot-002', beatId: 'b2'}],
        beats: [{id: 'b1'}, {id: 'b2'}] as Project['beats'],
        shotMoments: {b1: {shots: []}, b2: {shots: []}} as unknown as Project['shotMoments'],
    }
}
const requests = [{id: 'slot-001', beatId: 'b1'}, {id: 'slot-002', beatId: 'b2'}]
const at = (start: number) => [{start, end: start + 0.4}, {start: start + 0.5, end: start + 0.9}]

describe('applyTiming - words moved by hand', () => {
    test('a guessed line moved into the clip before: both clips sing something else, both beats are planned again', () => {
        const data = project()
        const result = applyTiming(data, {lines: [{line: 1, words: at(2.5)}]}, requests)
        expect(result).toEqual({changed: [1], slots: ['slot-001', 'slot-002'], replanned: ['b1', 'b2'], staleClips: ['slot-001', 'slot-002'], crossing: []})
        const line = data.lyricsTiming!.lines[1]!
        expect([line.start, line.end, line.confidence, line.byHand]).toEqual([2.5, 3.4, 1, true])
        expect(line.words.map(w => w.text)).toEqual(['and', 'fall'])
        expect(data.timeline!.slots[0]!.vocals!.map(v => v.line)).toEqual([0, 1])
        expect(data.timeline!.slots[1]!.vocals).toEqual([])
        expect(data.shotMoments).toEqual({})
    })

    test('moved within its clip: only that clip and its beat', () => {
        const data = project()
        const result = applyTiming(data, {lines: [{line: 1, words: at(5)}]}, requests)
        expect(result.slots).toEqual(['slot-002'])
        expect(result.replanned).toEqual(['b2'])
        expect(Object.keys(data.shotMoments!)).toEqual(['b1'])
    })

    test('a cut that falls into a moved word is named', () => {
        const result = applyTiming(project(), {lines: [{line: 1, words: [{start: 3.4, end: 3.8}, {start: 3.9, end: 4.3}]}]}, requests)
        expect(result.crossing).toEqual([{line: 1, word: 'fall', cut: 4}])
    })

    test('the same times are no change', () => {
        const data = project()
        expect(applyTiming(data, {lines: [{line: 1, words: at(6)}]}, requests).changed).toEqual([])
        expect(Object.keys(data.shotMoments!)).toEqual(['b1', 'b2'])
    })

    test('times of the alignment finer than a millisecond, given back as they were (bun run timing --set): no change, not by hand', () => {
        const data = project()
        const fine = data.lyricsTiming!.lines[1]!.words.map(w => ({...w, start: w.start + 0.00012, end: w.end + 0.00012}))
        data.lyricsTiming!.lines[1]!.words = fine
        expect(applyTiming(data, {lines: [{line: 1, words: fine.map(w => ({start: w.start, end: w.end}))}]}, requests).changed).toEqual([])
        expect(data.lyricsTiming!.lines[1]!.byHand).toBeUndefined()
    })

    test('refuses what cannot be', () => {
        const apply = (words: { start: number, end: number }[], line = 1) => () => applyTiming(project(), {lines: [{line, words}]}, requests)
        expect(apply(at(2), 9)).toThrow('no sung line 9')
        expect(apply([{start: 1, end: 2}])).toThrow('has 2 words, not 1')
        expect(apply([{start: 2, end: 2.02}, {start: 2.5, end: 3}])).toThrow('shorter than')
        expect(apply([{start: 2, end: 2.6}, {start: 2.5, end: 3}])).toThrow('starts before')
        expect(apply([{start: 7.5, end: 7.9}, {start: 7.95, end: 8.5}])).toThrow('outside the song')
        expect(() => applyTiming({}, {lines: []}, requests)).toThrow('no timing')
    })
})

describe('applyTiming - a line left out', () => {
    test('left out, no clip sings it and its beat is planned again; sung again, it is back where it was', () => {
        const data = project()
        const result = applyTiming(data, {lines: [{line: 1, off: true}]}, requests)
        expect(result).toEqual({changed: [1], slots: ['slot-002'], replanned: ['b2'], staleClips: ['slot-002'], crossing: []})
        expect(data.lyricsTiming!.lines[1]!.off).toBe(true)
        expect(data.lyricsTiming!.lines[1]!.words.map(w => w.start)).toEqual([6, 6.5])
        expect(data.timeline!.slots[1]!.vocals).toEqual([])
        expect(timingView('/nowhere', data, requests)!.lines[1]!.off).toBe(true)

        const back = applyTiming(data, {lines: [{line: 1, off: false}]}, requests)
        expect(back.changed).toEqual([1])
        expect(data.lyricsTiming!.lines[1]!.off).toBeUndefined()
        expect(data.timeline!.slots[1]!.vocals!.map(v => v.line)).toEqual([1])
    })

    test('left out as it is, or neither words nor off: nothing changes, or it is refused', () => {
        const data = project()
        expect(applyTiming(data, {lines: [{line: 1, off: false}]}, requests).changed).toEqual([])
        expect(() => applyTiming(data, {lines: [{line: 1}]}, requests)).toThrow('neither words nor "off"')
    })
})

describe('timingView', () => {
    test('per line its words, whether it is a guess and the beats it is sung in; the cuts with their beats', () => {
        const view = timingView('/nowhere', project(), requests)!
        expect(view.lines[1]).toEqual({line: 1, section: 'Verse', text: 'and fall', words: words(['and', 'fall'], 6), estimated: true, byHand: false, beats: ['b2']})
        expect(view.lines[0]!.estimated).toBe(false)
        expect(view.cuts).toEqual([{id: 'slot-001', start: 0, end: 4, beat: 'b1'}, {id: 'slot-002', start: 4, end: 8, beat: 'b2'}])
        expect(view.duration).toBe(8)
    })

    test('a line found sung nowhere gets its words laid out from its place, to be dragged; unmoved they are not saved', () => {
        const data = project()
        Object.assign(data.lyricsTiming!.lines[1]!, {start: 6, end: 6, words: [], confidence: 0})
        const line = timingView('/nowhere', data, requests)!.lines[1]!
        expect(line.unplaced).toBe(true)
        expect(line.words).toEqual([{text: 'and', start: 6, end: 6.4}, {text: 'fall', start: 6.4, end: 6.8}])
        expect(applyTiming(data, {lines: [{line: 1, words: line.words}]}, requests).changed).toEqual([])
        expect(data.lyricsTiming!.lines[1]!.words).toEqual([])
        // dragged where it is sung: it has its words from then on
        expect(applyTiming(data, {lines: [{line: 1, words: at(2.5)}]}, requests).changed).toEqual([1])
        expect(data.lyricsTiming!.lines[1]!.words.map(w => w.text)).toEqual(['and', 'fall'])
        expect(timingView('/nowhere', data, requests)!.lines[1]!.unplaced).toBeUndefined()
    })

    test('a line placed by hand is no longer a guess', () => {
        const data = project()
        applyTiming(data, {lines: [{line: 1, words: at(5)}]}, requests)
        expect(timingView('/nowhere', data, requests)!.lines[1]!.estimated).toBe(false)
    })
})

describe('outdatedClips - the clips that do not know a move yet', () => {
    // the requests of the last plan run: what each clip says is sung, and when (clip-relative, with its singers)
    const sung = (id: string, line: number, text: string, from: number, to: number) => ({id, beatId: id === 'slot-001' ? 'b1' : 'b2', vocals: [{at: from, end: to, line, text, singers: [{id: 'a', subject: 'Ann', speaker: '(S1)'}]}]})
    const planned = () => [sung('slot-001', 0, 'we rise', 0.5, 1.4), sung('slot-002', 1, 'and fall', 2, 2.9)]
    const withSinging = (data: Project, singing = {singers: ['a'], lines: [{line: 0, text: 'we rise', singers: ['a']}, {line: 1, text: 'and fall', singers: ['a']}]}) => ({...data, singing})

    test('what the last plan run saw is up to date', () => {
        expect(outdatedClips(withSinging(project()), planned())).toEqual([])
    })
    test('a line moved since: both clips, with the line - the one it left and the one it went into', () => {
        const data = withSinging(project())
        applyTiming(data, {lines: [{line: 1, words: at(2.5)}]}, requests)
        expect(outdatedClips(data, planned())).toEqual([{clip: 'slot-001', lines: [1]}, {clip: 'slot-002', lines: [1]}])
        expect(timingView('', data, planned())!.outdated).toHaveLength(2)
    })
    test('a move within what a frame of rounding gives is none', () => {
        const data = withSinging(project())
        data.timeline!.slots[1]!.vocals![0]!.start += 0.05
        expect(outdatedClips(data, planned())).toEqual([])
    })
    test('a line the singing does not have is sung by everybody, as the request has it; one nobody sings is not expected in it', () => {
        const data = withSinging(project(), {singers: ['a'], lines: [{line: 0, text: 'we rise', singers: ['a']}]})
        // line 1 has no entry: expected, and the request has it
        expect(outdatedClips(data, planned())).toEqual([])
        const nobody = withSinging(project(), {singers: ['a'], lines: [{line: 0, text: 'we rise', singers: ['a']}, {line: 1, text: 'and fall', singers: []}]})
        expect(outdatedClips(nobody, [planned()[0]!, {id: 'slot-002', beatId: 'b2'}])).toEqual([])
    })
    test('without singers there is nothing in a request to be out of date', () => {
        expect(outdatedClips(project(), [{id: 'slot-001', beatId: 'b1'}, {id: 'slot-002', beatId: 'b2'}])).toEqual([])
    })
})
