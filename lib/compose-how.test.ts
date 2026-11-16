import {describe, expect, test} from 'bun:test'
import {propActivityPerBeat, type StemPower} from './compose.ts'
import type {Character, StoryBeat} from './project.ts'

// How an instrument is heard in a shot, from its stem (#1024): single hits with silence between, and who carries the part.
// tides-of-eternal-flame-261113, slot-020: the guitar strikes at 2:12.0 and 2:14.1 with silence between - the activity calls it
// playing all through, the stem says hits. Here a clip of 8 s in two shots of 4 s.
const band: Character[] = [
    {id: 'lead', name: 'Lead', role: 'singer'},
    {id: 'gtr', name: 'Gtr', role: 'guitarist', prop: 'an electric guitar', propStem: 'guitar'},
]
const beat = {
    id: 'b1',
    order: 1,
    summary: 'The band plays on.',
    moments: ['They play.'],
    locationId: 'stage',
    characterIds: ['lead', 'gtr'],
    intensity: 0.5,
    weight: 1,
    kind: 'build',
    stateAfter: [],
} as StoryBeat
const slots = [{id: 'slot-001', index: 0, section: 'Solo', start: 0, end: 8, bars: 4, energy: 0.6, lyrics: []}]
const mapping = [{slotId: 'slot-001', beatId: 'b1'}]
const music = {bpm: 120, durationSec: 12, downbeats: [0, 2, 4, 6, 8, 10], barEnergy: [0.6, 0.6, 0.6, 0.6, 0.6, 0.6], sections: []}
const propActivity = {guitar: [{start: 0, end: 12}]}
const base = {slots, mapping, beats: [beat], characters: band, music, propActivity}

const hop = 0.05
const power = (f: (t: number) => number) => Array.from({length: Math.round(12 / hop)}, (_, i) => f(i * hop))
const loud = 1e-2,
    quiet = 1e-9
const db = (x: number) => 10 * Math.log10(x)
const stem = (f: (t: number) => number, loudDb = db(loud)): StemPower => ({power: power(f), hopSec: hop, loudDb})
// a hit of 0.5 s every 2 s, silence between
const hits = (t: number) => (t % 2 < 0.5 ? loud : quiet)

describe('propActivityPerBeat - how the instrument is heard in each shot', () => {
    test('a stem that plays through says nothing, one of single hits says so', () => {
        const [gtr] = propActivityPerBeat(base, propActivity, {guitar: stem(t => (t < 4 ? loud : hits(t)))}).b1!
        expect(gtr!.activePerShot).toEqual([true, true])
        expect(gtr!.howPerShot).toEqual([undefined, {articulation: 'hits'}])
    })

    test('the stem that is above its own usual level while the others are not carries the part', () => {
        // the guitar is 10 dB over its own loud level in the first shot, the other stem sits on its own level
        const stems = {guitar: stem(t => (t < 4 ? loud : 1e-3), db(1e-3)), other: stem(() => loud)}
        const [gtr] = propActivityPerBeat(base, propActivity, stems).b1!
        expect(gtr!.howPerShot).toEqual([{articulation: 'sustained', leads: true}, undefined])
    })

    test('without the stems nothing is said - a project without them plans as before', () => {
        const [gtr] = propActivityPerBeat(base, propActivity).b1!
        expect(gtr!.howPerShot).toBeUndefined()
        const [other] = propActivityPerBeat(base, propActivity, {}).b1!
        expect(other!.howPerShot).toBeUndefined()
    })
})
