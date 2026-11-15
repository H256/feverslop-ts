import {describe, expect, test} from 'bun:test'
import {instrumentParts, type PartsInput} from './instrument-parts.ts'

// a 120 s song of 2 s bars, 0.05 s frames; every stem is a function of the time
const hop = 0.05,
    bar = 2,
    length = 120
const downbeats = Array.from({length: length / bar}, (_, i) => i * bar)
const power = (f: (t: number) => number) => Array.from({length: Math.round(length / hop)}, (_, i) => f(i * hop))
const loud = 1e-2,
    quiet = 1e-9
const between = (t: number, a: number, b: number) => t >= a && t < b

function song(over: Partial<PartsInput> & {energy?: (t: number) => number}): PartsInput {
    const energy = over.energy ?? (() => 0.5)
    return {
        downbeats,
        durationSec: length,
        barEnergy: downbeats.map(energy),
        vocals: power(t => (between(t, 40, 80) ? quiet : loud)),
        stems: {guitar: power(() => loud), bass: power(() => loud)},
        hopSec: hop,
        ...over,
    }
}

describe('instrumentParts - the vocal gaps of a song and how each stem plays in them', () => {
    test('a stretch without singing is a gap, a shorter pause between lines is not', () => {
        const gaps = instrumentParts(song({vocals: power(t => (between(t, 40, 80) || between(t, 10, 14) ? quiet : loud))}))
        expect(gaps.map(g => [g.start, g.end])).toEqual([[40, 80]])
    })
    test('a song with singing all through has no gap', () => {
        expect(instrumentParts(song({vocals: power(() => loud)}))).toEqual([])
    })
    test('a song without vocals is one gap, split by its energy', () => {
        const gaps = instrumentParts(song({vocals: undefined, energy: t => (t < 40 ? 0.2 : t < 80 ? 0.5 : 0.9)}))
        expect(gaps).toHaveLength(1)
        expect(gaps[0]!.parts.map(p => [p.start, p.end, p.level])).toEqual([
            [0, 40, 'low'],
            [40, 80, 'mid'],
            [80, 120, 'high'],
        ])
    })
    test('the parts follow the energy, a part shorter than 4 s joins its neighbour', () => {
        // low 40-56, high 56-62, one bar (2 s) of mid 62-64 - closer to the low run after it than to the high one before - then low until 80
        const energy = (t: number) => (t < 40 ? 0.3 : t < 56 ? 0.2 : t < 62 ? 0.9 : t < 64 ? 0.25 : 0.2)
        const parts = instrumentParts(song({energy}))[0]!.parts
        expect(parts.map(p => [p.start, p.end, p.level])).toEqual([
            [40, 56, 'low'],
            [56, 62, 'high'],
            [62, 80, 'low'],
        ])
    })
    test('a stem that plays through is sustained, one with a pause between hits has hits and pauses, a silent one is still', () => {
        const hits = (t: number) => (between(t % 2, 0, 0.25) ? loud : quiet) // a hit every bar, silence between
        const parts = instrumentParts(song({stems: {guitar: power(() => loud), bass: power(hits), synth: power(t => (between(t, 40, 80) ? quiet : loud))}}))[0]!
            .parts
        const by = Object.fromEntries(parts[0]!.stems.map(s => [s.stem, s]))
        expect(by.guitar!.articulation).toBe('sustained')
        expect(by.bass!.articulation).toBe('hits')
        expect(by.bass!.pauses).toBeGreaterThan(0)
        expect(by.synth!.articulation).toBe('still')
    })
    test('the stem that is above its own usual level while the others are not leads', () => {
        // the guitar is 10 dB louder for 6 s of the gap - its own loud bars (95th percentile) are the rest of the song
        const guitar = power(t => (between(t, 50, 56) ? loud * 10 : loud))
        // the song's thirds are 0.2 / 0.6: the gap is mid, the 3 bars of the solo high
        const energy = (t: number) => (between(t, 50, 56) ? 0.9 : t < 40 ? 0.2 : t < 80 ? 0.4 : 0.6)
        const parts = instrumentParts(song({stems: {guitar, bass: power(() => loud)}, energy}))[0]!.parts
        const solo = parts.find(p => p.start === 50)!
        expect(solo.leads).toBe('guitar')
        expect(parts.filter(p => p !== solo).every(p => p.leads === undefined)).toBe(true)
    })
    test('with no stems the parts still follow the energy', () => {
        const gaps = instrumentParts(song({stems: {}}))
        expect(gaps[0]!.parts[0]!.stems).toEqual([])
        expect(gaps[0]!.parts[0]!.leads).toBeUndefined()
    })
})
