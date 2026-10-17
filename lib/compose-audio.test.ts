import {describe, expect, test} from "bun:test";
import {buildClipRequests} from "./compose.ts";
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
})
