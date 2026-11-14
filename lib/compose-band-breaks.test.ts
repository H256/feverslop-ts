import {describe, expect, test} from 'bun:test'
import {buildClipRequests, clipCuts, countShotsPerBeat, propActivityPerBeat} from './compose.ts'
import type {Character, ShotPlan, StoryBeat} from './project.ts'
import {castProps} from './props.ts'

// A band that breaks off inside a clip (#968): the quiet is a shot of its own - one shot from the playing into the quiet was
// rendered playing all through it. tides-of-eternal-flame-261113, slot-025: the band is out from 2:42.45 to 2:46.65.
const band: Character[] = [
    {id: 'lead', name: 'Lead', role: 'singer'},
    {id: 'gtr', name: 'Gtr', role: 'guitarist', prop: 'an electric guitar', propStem: 'guitar'},
]
const beat = {
    id: 'b1',
    order: 1,
    summary: 'Lead sings the bridge, Gtr beside her.',
    moments: ['Lead sings.'],
    locationId: 'stage',
    characterIds: ['lead', 'gtr'],
    intensity: 0.5,
    weight: 1,
    kind: 'build',
    stateAfter: [],
} as StoryBeat
const slots = [{id: 'slot-025', index: 0, section: 'Bridge', start: 160.287, end: 168.229, bars: 4, energy: 0.6, lyrics: []}]
const mapping = [{slotId: 'slot-025', beatId: 'b1'}]
const music = {bpm: 123, durationSec: 215, downbeats: [158.29, 160.29, 162.26, 164.26, 166.32, 168.23], barEnergy: [0.6, 0.6, 0.6, 0.6, 0.6, 0.6], sections: []}
const propActivity = {
    guitar: [
        {start: 0.6, end: 162.45},
        {start: 166.65, end: 178.7},
    ],
}
const base = {slots, mapping, beats: [beat], characters: band, music, propActivity}
const shot = (action: string): ShotPlan => ({action, characters: ['lead', 'gtr']})

describe('a break of the band inside a clip', () => {
    test('is a shot of its own: playing, the quiet, the band coming back', () => {
        expect(clipCuts(base).get('slot-025')).toEqual([0, 1.973, 6.033])
        expect(countShotsPerBeat(base)).toEqual({b1: 3})
    })

    test('a beat planned before with the cuts on the bars keeps them until it is planned again', () => {
        const planned = {b1: {shots: [shot('Gtr strums.'), shot('Lead sings.')]}}
        expect(clipCuts({...base, shotMoments: planned}).get('slot-025')).toEqual([0, 3.973])
        // planned for the new cuts: those
        const replanned = {b1: {shots: [shot('Gtr strums.'), shot('Lead sings alone.'), shot('Gtr strikes back in.')]}}
        expect(clipCuts({...base, shotMoments: replanned}).get('slot-025')).toEqual([0, 1.973, 6.033])
    })

    test('the planner is told when in a shot the instrument is heard', () => {
        const [gtr] = propActivityPerBeat(base, propActivity).b1!
        expect(gtr!.activePerShot).toEqual([true, false, true])
        // shot 1 runs to 2:42.26, a moment before the guitar stops: heard all through it; shot 3 from 2:46.32, the guitar from 2:46.65
        expect(gtr!.heardPerShot).toEqual([undefined, undefined, [{start: 0.33, end: 1.909}]])
    })

    test('the clip prompt is cut in three shots', () => {
        const c = buildClipRequests({
            ...base,
            locations: [{id: 'stage', name: 'Stage'}],
            characterDescriptions: {},
            locationDescriptions: {},
            lookBrief: '',
            language: 'English',
            stemsAvailable: true,
            shotMoments: {b1: {shots: [shot('Gtr strums.'), shot('Lead sings alone.'), shot('Gtr strikes back in.')]}},
            props: castProps(band),
        })[0]!
        expect(c.shots.map(s => s.at)).toEqual([0, 1.973, 6.033])
        expect(c.prompt).toContain('cut in 3 shots')
    })
})
