import {describe, expect, test} from "bun:test";
import {refineSections} from "./lyrics.ts";
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
