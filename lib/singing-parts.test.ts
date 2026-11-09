import {describe, expect, test} from "bun:test";
import type {LyricsTiming} from "./project.ts";
import {normalizeParts, splitAtCuts, splitBySinger} from "./singing-parts.ts";

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


test('singer splitting recombines joined pieces and preserves clip fragment suffix', () => {
    const splitWords = [{text: 'w', start: 0, end: .2}, {text: 'e', joined: true, start: .2, end: .4}, {text: 'ri', start: .5, end: .7}]
    const t: LyricsTiming = {lines: [{...timing.lines[0]!, words: [...splitWords, {text: 'se', joined: true, start: 1, end: 1.2}]}]}
    const v = {text: 'we ri-', start: 0, end: .7, words: splitWords}
    const line = {line: 0, text: 'we rise', singers: ['a', 'b'], parts: [{from: 0, singers: ['a']}, {from: 2, singers: ['b']}]}
    expect(splitBySinger(v, 0, line, t, []).map(p => p.text)).toEqual(['we', 'ri-'])
})


test('literal trailing hyphens are not mistaken for a continuation marker', () => {
    const t: LyricsTiming = {lines: [{...timing.lines[0]!, words: [{text: 'we', start: 0, end: .4}, {text: 'go-', start: .5, end: 1}]}]}
    const v = {text: 'we go-', start: 0, end: 1, words: t.lines[0]!.words}
    const line = {line: 0, text: 'we go-', singers: ['a', 'b'], parts: [{from: 0, singers: ['a']}, {from: 1, singers: ['b']}]}
    expect(splitBySinger(v, 0, line, t, []).map(p => p.text)).toEqual(['we', 'go-'])
})

describe('splitAtCuts', () => {
    const w = (text: string, start: number, end: number, joined?: boolean) => ({text, start, end, ...(joined ? {joined} : {})})
    // schwarzer-flur slot-018: the line starts before the cut at 3.708, "Narben" right after it
    const line = {line: 20, text: 'Die Stadt trägt nasse Narben', start: 2.417, end: 4.767,
        words: [w('Die', 2.417, 2.659), w('Stadt', 2.663, 2.802), w('trägt', 2.854, 3.058), w('nasse', 3.08, 3.705), w('Narben', 3.71, 4.767)]}

    test('a line crossing a cut becomes one piece per shot, each with its own span', () => {
        expect(splitAtCuts(line, [0, 3.708]).map(p => [p.text, p.start, p.end, p.continues])).toEqual([['Die Stadt trägt nasse', 2.417, 3.705, true], ['Narben', 3.71, 4.767, undefined]])
    })
    test('a line inside one shot stays as it is', () => {
        expect(splitAtCuts(line, [0, 5])).toEqual([line])
    })
    test('a word split at the cut keeps its hyphens, the clip fragment its own', () => {
        const split = {line: 1, text: 'nas-', start: 1, end: 3, words: [w('na', 1, 1.9), w('s', 2.1, 3, true)]}
        expect(splitAtCuts(split, [0, 2]).map(p => p.text)).toEqual(['na-', '-s-'])
    })
})
