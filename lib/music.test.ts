import {describe, expect, test} from "bun:test";
import {chooseClipStarts, isFightBeat, splitFightSlots} from "./music.ts";
import type {Character, LyricsTiming, MusicMap, Slot, StoryBeat} from "./project.ts";

const word = (text: string, start: number, end: number) => ({text, start, end})
// bars every 3 s; a word runs 5.5-6.5 (over the boundary at 6) and a pause lies at 9
const timing = {lines: [{line: 0, section: 's', sectionIndex: 0, text: 'a b', start: 3.2, end: 8.5, confidence: 1, words: [word('a', 3.2, 5.0), word('b', 5.5, 6.5), word('c', 6.8, 8.5)]}]} as unknown as LyricsTiming

describe('chooseClipStarts', () => {
    test('does not cut a sung word in two when another bar boundary is free', () => {
        const bars = [0, 3, 6, 9, 12]
        const starts = chooseClipStarts(bars, 0, 15, 2, 3, 9.3, timing)!
        // no clip starts at 6 (inside "b"), the clips start at 0, 3 and 9 / 12
        expect(starts).not.toContain(2)
        expect(starts[0]).toBe(0)
    })
    test('every clip stays within the longest clip', () => {
        const bars = [0, 3, 6, 9, 12]
        const starts = chooseClipStarts(bars, 0, 15, 2, 3, 9.3, timing)!
        const edges = [...starts.map(i => i === 0 ? 0 : bars[i]!), 15]
        for (let k = 1; k < edges.length; k++) expect(edges[k]! - edges[k - 1]!).toBeLessThanOrEqual(9.3)
    })
    test('no split within the limit gives undefined', () => {
        expect(chooseClipStarts([0], 0, 30, 2, 3, 9.3, timing)).toBeUndefined()
    })
})

describe('splitFightSlots', () => {
    const music = {bpm: 112, durationSec: 40, downbeats: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20], barEnergy: [], sections: []} as unknown as MusicMap
    const orcs: Character = {id: 'orcs', name: 'Orcs', role: 'x', isGroup: true, alike: true}
    const vael: Character = {id: 'vael', name: 'Vael', role: 'x'}
    const beat = (id: string, kind: StoryBeat['kind'], ids: string[]) => ({id, kind, characterIds: ids, intensity: 0.5, weight: 1} as StoryBeat)
    const slot = (i: number, start: number, end: number, extra: Partial<Slot> = {}): Slot => ({id: `slot-${i + 1}`, index: i, section: 's', start, end, bars: Math.round((end - start) / 2), energy: 0.6, lyrics: [], ...extra})

    test('a fight beat is a hit with a crowd in it', () => {
        expect(isFightBeat(beat('a', 'hit', ['vael', 'orcs']), [vael, orcs])).toBe(true)
        expect(isFightBeat(beat('b', 'hit', ['vael']), [vael, orcs])).toBe(false)
        expect(isFightBeat(beat('c', 'build', ['vael', 'orcs']), [vael, orcs])).toBe(false)
    })
    test('the slots of a fight are cut into bars, the others stay, ids and mapping are numbered anew', () => {
        const slots = [slot(0, 0, 4), slot(1, 4, 12), slot(2, 12, 16)]
        const beats = [beat('b1', 'build', ['vael']), beat('b2', 'hit', ['vael', 'orcs']), beat('b3', 'release', ['vael'])]
        const mapping = [{slotId: 'slot-1', beatId: 'b1'}, {slotId: 'slot-2', beatId: 'b2'}, {slotId: 'slot-3', beatId: 'b3'}]
        const r = splitFightSlots(slots, mapping, beats, [vael, orcs], music)
        expect(r.slots.map(s => [s.start, s.end])).toEqual([[0, 4], [4, 6], [6, 8], [8, 10], [10, 12], [12, 16]])
        expect(r.slots.map(s => s.micro ?? false)).toEqual([false, true, true, true, true, false])
        expect(r.slots.map(s => s.id)).toEqual(['slot-001', 'slot-002', 'slot-003', 'slot-004', 'slot-005', 'slot-006'])
        expect(r.mapping.map(m => m.beatId)).toEqual(['b1', 'b2', 'b2', 'b2', 'b2', 'b3'])
        expect(r.mapping.map(m => m.slotId)).toEqual(r.slots.map(s => s.id))
        expect(r.slots.every((s, i) => s.index === i)).toBe(true)
    })
    test('sung words go to the piece they are sung in, with times relative to it', () => {
        const vocals = [{line: 0, text: 'Orcs in the dark', start: 1.5, end: 3.4, words: [
            {text: 'Orcs', start: 1.5, end: 1.9}, {text: 'in', start: 2.1, end: 2.3}, {text: 'the', start: 2.5, end: 2.8}, {text: 'dark', start: 3.0, end: 3.4},
        ]}]
        const slots = [slot(0, 4, 12, {vocals, lyrics: ['Orcs in the dark']})]
        const beats = [beat('b2', 'hit', ['vael', 'orcs'])]
        const r = splitFightSlots(slots, [{slotId: 'slot-1', beatId: 'b2'}], beats, [vael, orcs], music)
        // slot starts at 4: words at 5.5-5.9 (piece 4-6) and 6.1-7.4 (piece 6-8)
        expect(r.slots[0]!.vocals![0]!.words.map(w => w.text)).toEqual(['Orcs'])
        expect(r.slots[0]!.vocals![0]!.words[0]!.start).toBeCloseTo(1.5)
        expect(r.slots[1]!.vocals![0]!.words.map(w => w.text)).toEqual(['in', 'the', 'dark'])
        expect(r.slots[1]!.vocals![0]!.words[0]!.start).toBeCloseTo(0.1)
        expect(r.slots[0]!.lyrics).toEqual(['Orcs in the dark'])
        expect(r.slots[1]!.lyrics).toEqual([])
        expect(r.slots[2]!.vocals).toEqual([])
    })
})
