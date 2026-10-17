import {describe, expect, test} from "bun:test";
import {alignLyrics, keepTogether, refineSections} from "./lyrics.ts";
import type {LyricSection, LyricsTiming, MusicMap} from "./project.ts";

// 120 bpm: a bar every 2 s
const music = (sections: [string, number][]): MusicMap => ({
    bpm: 120,
    durationSec: 120,
    downbeats: Array.from({length: 60}, (_, i) => i * 2),
    barEnergy: Array(60).fill(0.5),
    sections: sections.map(([label, start], i) => ({label, start, end: sections[i + 1]?.[1] ?? 120, energy: 0.5})),
})
const line = (sectionIndex: number, start: number, end: number, confidence = 1) => ({line: 0, section: '', sectionIndex, text: 'x', start, end, confidence, words: []})
const timing = (lines: ReturnType<typeof line>[]) => ({lines}) as unknown as LyricsTiming
const lyricSections = (labels: string[]): LyricSection[] => labels.map(label => ({label, lines: []}))
const startOf = (sections: { label: string, start: number }[], label: string) => sections.find(s => s.label === label)!.start

describe('refineSections', () => {
    test('a section without vocals right after a sung one starts where those vocals end, not at the estimate', () => {
        const labels = ['Intro', 'Chorus', 'Guitar Solo', 'Bridge']
        const sections = refineSections(music([['Intro', 0], ['Chorus', 10], ['Guitar Solo', 50], ['Bridge', 60]]), lyricSections(labels),
            timing([line(1, 10.2, 29.1), line(3, 60.1, 70)]))
        expect(startOf(sections, 'Guitar Solo')).toBe(30)
        expect(startOf(sections, 'Bridge')).toBe(60)
    })
    test('a second section without vocals in a row keeps its estimate', () => {
        const labels = ['Intro', 'Chorus', 'Guitar Solo', 'Interlude', 'Bridge']
        const sections = refineSections(music([['Intro', 0], ['Chorus', 10], ['Guitar Solo', 40], ['Interlude', 50], ['Bridge', 60]]), lyricSections(labels),
            timing([line(1, 10.2, 29.1), line(4, 60.1, 70)]))
        expect(startOf(sections, 'Guitar Solo')).toBe(30)
        expect(startOf(sections, 'Interlude')).toBe(50)
    })
    test('a sung section whose first line was not heard keeps the estimate, as before', () => {
        const labels = ['Intro', 'Chorus', 'Verse', 'Bridge']
        const sections = refineSections(music([['Intro', 0], ['Chorus', 10], ['Verse', 40], ['Bridge', 60]]), lyricSections(labels),
            timing([line(1, 10.2, 29.1), line(2, 33, 50, 0), line(3, 60.1, 70)]))
        expect(startOf(sections, 'Verse')).toBe(40)
    })
    test('after a last line that was not heard, a section without lyrics keeps the estimate', () => {
        const labels = ['Intro', 'Chorus', 'Guitar Solo', 'Bridge']
        const sections = refineSections(music([['Intro', 0], ['Chorus', 10], ['Guitar Solo', 40], ['Bridge', 60]]), lyricSections(labels),
            timing([line(1, 10.2, 20), line(1, 20, 29.1, 0), line(3, 60.1, 70)]))
        expect(startOf(sections, 'Guitar Solo')).toBe(40)
    })
    test('the intro starts at 0 and a sung section at its first line', () => {
        const sections = refineSections(music([['Intro', 0], ['Verse', 7]]), lyricSections(['Intro', 'Verse']), timing([line(1, 8.3, 20)]))
        expect(startOf(sections, 'Intro')).toBe(0)
        expect(startOf(sections, 'Verse')).toBe(8)
    })
})

describe('keepTogether - the words of a line are sung together', () => {
    const w = (text: string, start: number, end: number, sim = 1) => ({text, start, end, sim})
    test('a first word far before the rest is put right before it, as a guess', () => {
        const r = keepTogether([w('Cold', 108.6, 109.1), w('as', 161.7, 162.6), w('ice', 162.6, 163.3)], 8)
        expect(r.map(x => [x.text, x.start, x.sim])).toEqual([['Cold', 161.25, 0], ['as', 161.7, 1], ['ice', 162.6, 1]])
    })
    test('a last word far after the rest is put right after it', () => {
        const r = keepTogether([w('The', 10, 10.4), w('serrated', 10.4, 11), w('scream', 70, 70.5)], 8)
        expect(r.map(x => [x.text, x.start, x.sim])).toEqual([['The', 10, 1], ['serrated', 10.4, 1], ['scream', 11, 0]])
    })
    test('a held word or a pause shorter than the limit changes nothing', () => {
        const words = [w('Oh', 0, 7.5), w('night', 8, 9), w('falls', 15, 16)]
        expect(keepTogether(words, 8)).toBe(words)
    })
    test('the part with the most heard words stays, guessed words do not count', () => {
        const r = keepTogether([w('a', 0, 1), w('b', 1, 2), w('c', 30, 31), w('d', 31, 32, 0), w('e', 32, 33, 0)], 8)
        expect(r.map(x => x.text + '@' + x.start)).toEqual(['a@0', 'b@1', 'c@2', 'd@2.45', 'e@2.9'])
    })
})

describe('alignLyrics - a word matched bars away from its line', () => {
    const heard = (text: string, start: number) => ({text, start, end: start + 0.4, probability: 0.9})
    const sections: LyricSection[] = [{label: 'Chorus', lines: ['Where the gods have bled']}, {label: 'Bridge', lines: ['Cold as ice and deep as time']}]
    // "cold" heard right after the chorus too (a backing echo, a hallucination) - the line is sung 50 s later
    const words = [...'where the gods have bled'.split(' ').map((t, i) => heard(t, 100 + i * 0.5)), heard('cold', 103),
        ...'as ice and deep as time'.split(' ').map((t, i) => heard(t, 153.4 + i * 0.5))]
    test('does not set the start of the line - with the bar of the song', () => {
        const line = alignLyrics(sections, words, undefined, undefined, 120).lines[1]!
        expect(line.start).toBeCloseTo(152.95)
        expect(line.words.map(x => x.text)).toEqual(['Cold', 'as', 'ice', 'and', 'deep', 'as', 'time'])
    })
    test('without a bpm the timing stays as it was', () => {
        expect(alignLyrics(sections, words).lines[1]!.start).toBe(103)
    })
})
