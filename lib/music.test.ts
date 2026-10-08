import {describe, expect, test} from "bun:test";
import {chooseClipStarts} from "./music.ts";
import type {LyricsTiming} from "./project.ts";

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
