import {describe, expect, test} from "bun:test";
import {activeSpans, buildClipRequests} from "./compose.ts";
import type {Character, ShotPlan, StoryBeat} from "./project.ts";

const beat = {id: 'b1', order: 1, summary: 'They play.', moments: ['They play.'], locationId: 'clearing', characterIds: [], intensity: 0.5, weight: 1, kind: 'build', stateAfter: []} as StoryBeat

describe('audio tracks of a band', () => {
    const band: Character[] = [
        {id: 'lead', name: 'Lead', role: 'singer'},
        {id: 'gtr', name: 'Gtr', role: 'guitarist', prop: 'guitar', propStem: 'guitar'},
        {id: 'bss', name: 'Bss', role: 'bassist', prop: 'bass', propStem: 'bass'},
        {id: 'drm', name: 'Drm', role: 'drummer', prop: 'drum kit', propStem: 'drums'},
    ]
    const clip = (ids: string[], sung: boolean, shot: ShotPlan = {action: 'They play.', characters: ids}) => buildClipRequests({
        slots: [{id: 'slot-001', index: 0, section: 'Chorus', start: 0, end: 4, bars: 2, energy: 0.8, lyrics: [], ...(sung ? {vocals: [{line: 0, text: 'la la', start: 0.2, end: 3.5, words: []}]} : {})}],
        mapping: [{slotId: 'slot-001', beatId: 'b1'}],
        beats: [{...beat, characterIds: ids}],
        characters: band,
        locations: [{id: 'clearing', name: 'Stage'}],
        characterDescriptions: {},
        locationDescriptions: {},
        lookBrief: '',
        music: {bpm: 120, durationSec: 4, downbeats: [0, 2], barEnergy: [0.8, 0.8], sections: []},
        language: 'English',
        stemsAvailable: true,
        propActivity: {guitar: [{start: 0, end: 4}], bass: [{start: 0, end: 4}], drums: [{start: 0, end: 4}]},
        ...(sung ? {singing: {singers: ['lead'], lines: [{line: 0, text: 'la la', singers: ['lead']}]}} : {}),
        shotMoments: {b1: {shots: [shot]}},
    })[0]!

    test('vocals, the drums, and guitar and bass mixed into the one slot left', () => {
        const c = clip(['lead', 'gtr', 'bss', 'drm'], true)
        expect(c.assets.audio.map(a => [a.stem, a.mix])).toEqual([['vocals', undefined], ['mix-bass-guitar', ['guitar', 'bass']], ['drums', undefined]])
        expect(c.prompt).toContain('<Audio 2> is the guitar and bass layers of the Chorus section')
        expect(c.prompt).toContain('mixed into one track')
        expect(c.prompt).toContain('its guitar drives the instrument motion of <Subject 3>, its bass drives the instrument motion of <Subject 4>')
    })
    test('without singing, guitar and bass each have their own track', () => {
        const c = clip(['gtr', 'bss', 'drm'], false)
        expect(c.assets.audio.map(a => a.stem)).toEqual(['guitar', 'bass', 'drums'])
    })
    test('a heard player always gets the playing sentence, with the hands the planner wrote, even when the moment names them', () => {
        const c = clip(['gtr', 'drm'], false, {
            action: 'Gtr leans toward Drm, who presses her palms on the rails.', characters: ['gtr', 'drm'],
            people: {gtr: {state: 'at the front', motion: 'leans toward Drm', playing: true, plays: 'strums hard downstrokes, the fretting hand gripping a chord.'}, drm: {state: 'behind the kit', motion: 'sways', playing: true}},
        })
        expect(c.prompt).toContain('<Subject 2>, Gtr, plays the guitar through the whole shot: strums hard downstrokes, the fretting hand gripping a chord.')
        expect(c.prompt).toContain('<Subject 3>, Drm, is actively using the drum kit right now.')
    })
    test('an instrument heard for part of the shot plays only then - in the clip’s own time, held still after', () => {
        expect(activeSpans({start: 0, end: 4}, [{start: 0, end: 1.3}])).toEqual([{start: 0, end: 1.3}])
        expect(activeSpans({start: 0, end: 4}, [{start: -2, end: 3.9}])).toBeUndefined()
        expect(activeSpans({start: 0, end: 4}, [{start: 5, end: 6}])).toBeUndefined()
        // heard at the start and at the end, silent between (tides 2:42) - not "through the whole shot"
        expect(activeSpans({start: 162.58, end: 166.33}, [{start: 154.95, end: 162.85}, {start: 165.9, end: 213.15}])).toEqual([{start: 162.58, end: 162.85}, {start: 165.9, end: 166.33}])
        const c = buildClipRequests({
            slots: [{id: 'slot-001', index: 0, section: 'Bridge', start: 10, end: 14, bars: 2, energy: 0.8, lyrics: []}],
            mapping: [{slotId: 'slot-001', beatId: 'b1'}],
            beats: [{...beat, characterIds: ['gtr']}],
            characters: band, locations: [{id: 'clearing', name: 'Stage'}], characterDescriptions: {}, locationDescriptions: {}, lookBrief: '',
            music: {bpm: 120, durationSec: 20, downbeats: [10, 12], barEnergy: [0.8, 0.8], sections: []}, language: 'English', stemsAvailable: true,
            propActivity: {guitar: [{start: 10, end: 11.3}], drums: [{start: 0, end: 20}]},
            shotMoments: {b1: {shots: [{action: 'Gtr plays.', characters: ['gtr'], people: {gtr: {state: 'at the front', motion: 'steps in', playing: true, plays: 'strums a last chord'}}}]}},
        })[0]!
        expect(c.prompt).toContain('<Subject 2>, Gtr, plays the guitar from 00:00.000 to 00:01.300: strums a last chord - after that the guitar is held still.')
    })
    test('an instrument heard at the start and the end of a shot plays then, and is held still between', () => {
        const c = buildClipRequests({
            slots: [{id: 'slot-001', index: 0, section: 'Bridge', start: 10, end: 14, bars: 2, energy: 0.8, lyrics: []}],
            mapping: [{slotId: 'slot-001', beatId: 'b1'}],
            beats: [{...beat, characterIds: ['gtr']}],
            characters: band, locations: [{id: 'clearing', name: 'Stage'}], characterDescriptions: {}, locationDescriptions: {}, lookBrief: '',
            music: {bpm: 120, durationSec: 20, downbeats: [10, 12], barEnergy: [0.8, 0.8], sections: []}, language: 'English', stemsAvailable: true,
            propActivity: {guitar: [{start: 9, end: 10.5}, {start: 11, end: 11.3}, {start: 13.4, end: 16}], drums: [{start: 0, end: 20}]},
            shotMoments: {b1: {shots: [{action: 'Gtr plays.', characters: ['gtr'], people: {gtr: {state: 'at the front', motion: 'steps in', playing: true, plays: 'hits a chord'}}}]}},
        })[0]!
        expect(c.prompt).toContain('plays the guitar from 00:00.000 to 00:00.500 and from 00:01.000 to 00:01.300: hits a chord - in between and outside these times the guitar is held still.')
    })

    test('a hands shot shows both hands and the instrument, never the face - and pulls in no singer', () => {
        const c = clip(['lead', 'gtr'], true, {action: '{Gtr} picks a fast run.', characters: ['gtr'], hands: 'gtr', people: {gtr: {state: 'at the front', motion: 'leans in', playing: true, plays: 'picks a fast run'}}})
        expect(c.prompt).toContain('extreme close-up of the hands of <Subject')
        expect(c.prompt).toContain('The hand that strikes, picks or strums, the hand that holds, frets or presses, and the body of the guitar fill the frame; the face is out of the frame.')
        expect(c.shots[0]!.subjects).not.toContain(c.assets.pictures.find(p => p.id === 'lead')?.subject)
    })
    test('a player no shot shows is heard off camera - the drum track times the cuts, it drives no drumming', () => {
        const c = clip(['lead', 'gtr', 'drm'], true, {action: 'Lead sings to Gtr.', characters: ['lead', 'gtr'], people: {gtr: {state: 'at the front', motion: 'steps in', playing: true, plays: 'strums'}}})
        expect(c.prompt).toContain('is the isolated drum layer of the Chorus section')
        expect(c.prompt).not.toContain("drumming")
    })
})
