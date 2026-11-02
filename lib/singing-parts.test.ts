import {describe, expect, test} from "bun:test";
import type {LyricsTiming} from "./project.ts";
import {normalizeParts, splitBySinger} from "./singing-parts.ts";

// "we rise and fall" at 10.0, 10.5, 11.0, 11.5 s of the song, each word 0.3 s long
const words = ['we', 'rise', 'and', 'fall'].map((text, n) => ({text, start: 10 + n * 0.5, end: 10.3 + n * 0.5}))
const timing: LyricsTiming = {lines: [{line: 0, sectionIndex: 0, section: 'Verse', text: 'we rise and fall', start: 10, end: 11.8, words, confidence: 1}]}
// the line in a clip that starts at 9 s: times relative to the clip
const vocal = {line: 0, text: 'we rise and fall', start: 1, end: 2.8, words: words.map(w => ({...w, start: w.start - 9, end: w.end - 9}))}

describe('normalizeParts', () => {
    test('sorted, from word 0, neighbours with the same singers merged, a single part is none', () => {
        expect(normalizeParts([{from: 2, singers: ['b']}, {from: 1, singers: ['a']}], 4)).toEqual([{from: 0, singers: ['a']}, {from: 2, singers: ['b']}])
        expect(normalizeParts([{from: 0, singers: ['a']}, {from: 2, singers: ['a']}], 4)).toBeUndefined()
        expect(normalizeParts([{from: 0, singers: ['a']}, {from: 9, singers: ['b']}], 4)).toBeUndefined()
        expect(normalizeParts([{from: 0, singers: ['a']}, {from: 1, singers: ['b']}, {from: 2, singers: ['b']}, {from: 3, singers: ['a', 'b']}], 4))
            .toEqual([{from: 0, singers: ['a']}, {from: 1, singers: ['b']}, {from: 3, singers: ['a', 'b']}])
    })
})

describe('splitBySinger', () => {
    const line = {line: 0, text: 'we rise and fall', singers: ['a', 'b'], parts: [{from: 0, singers: ['a']}, {from: 2, singers: ['b']}]}

    test('a line is split where its singer changes, each piece with its own words and times', () => {
        expect(splitBySinger(vocal, 9, line, timing, [])).toEqual([
            {...vocal, text: 'we rise', start: vocal.words[0]!.start, end: vocal.words[1]!.end, words: vocal.words.slice(0, 2), singers: ['a']},
            {...vocal, text: 'and fall', start: vocal.words[2]!.start, end: vocal.words[3]!.end, words: vocal.words.slice(2), singers: ['b']},
        ])
    })

    test('a clip that holds only the end of the line has only the later part', () => {
        const tail = {...vocal, text: 'fall', start: 2.5, end: 2.8, words: vocal.words.slice(3)}
        expect(splitBySinger(tail, 9, line, timing, []).map(p => [p.text, p.singers])).toEqual([['fall', ['b']]])
    })

    test('a word off by a frame stays in its part: the boundary lies between the words', () => {
        const late = {...vocal, words: vocal.words.map((w, n) => n === 2 ? {...w, start: w.start - 0.08} : w)}
        expect(splitBySinger(late, 9, line, timing, []).map(p => p.text)).toEqual(['we rise', 'and fall'])
    })

    test('without parts, or without word times, the line is one piece with its singers', () => {
        expect(splitBySinger(vocal, 9, {...line, parts: undefined}, timing, []).map(p => p.singers)).toEqual([['a', 'b']])
        expect(splitBySinger(vocal, 9, line, undefined, []).map(p => p.singers)).toEqual([['a', 'b']])
        expect(splitBySinger(vocal, 9, undefined, timing, ['lead']).map(p => p.singers)).toEqual([['lead']])
    })
})
