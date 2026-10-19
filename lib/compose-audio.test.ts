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
    test('a long held note gets one held mouth shape, short words none', () => {
        const c = buildClipRequests({
            slots: [{id: 'slot-001', index: 0, section: 'Chorus', start: 0, end: 4, bars: 2, energy: 0.8, lyrics: [], vocals: [{line: 0, text: 'la flame', start: 0.2, end: 3.5, words: [{text: 'la', start: 0.2, end: 0.6}, {text: 'flame', start: 0.8, end: 3.5}]}]}],
            mapping: [{slotId: 'slot-001', beatId: 'b1'}],
            beats: [{...beat, characterIds: ['lead']}],
            characters: band, locations: [{id: 'clearing', name: 'Stage'}], characterDescriptions: {}, locationDescriptions: {}, lookBrief: '',
            music: {bpm: 120, durationSec: 4, downbeats: [0, 2], barEnergy: [0.8, 0.8], sections: []}, language: 'English', stemsAvailable: true,
            singing: {singers: ['lead'], lines: [{line: 0, text: 'la flame', singers: ['lead']}]},
            shotMoments: {b1: {shots: [{action: 'Lead sings.', characters: ['lead']}]}},
        })[0]!
        expect(c.prompt).toContain('From 00:00.800 to 00:02.000, <Subject 2> (S1) holds the long note of "flame": one open vowel shape held')
        expect(c.prompt).not.toContain('note of "la"')
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

    test('a player of a prop that stands in a place is only ever at it - one person, not also the standing figure of the picture (#327)', () => {
        const kit: Character = {id: 'drm', name: 'Drm', role: 'drummer', prop: 'drum kit', propStem: 'drums', propCarried: false, propInHand: 'drumsticks'}
        const c = buildClipRequests({
            slots: [{id: 'slot-001', index: 0, section: 'Chorus', start: 0, end: 4, bars: 2, energy: 0.8, lyrics: []}],
            mapping: [{slotId: 'slot-001', beatId: 'b1'}],
            beats: [{...beat, characterIds: ['gtr', 'drm']}],
            characters: [band[1]!, kit], locations: [{id: 'clearing', name: 'Stage'}], characterDescriptions: {}, locationDescriptions: {}, lookBrief: '',
            music: {bpm: 120, durationSec: 4, downbeats: [0, 2], barEnergy: [0.8, 0.8], sections: []}, language: 'English', stemsAvailable: true,
            propActivity: {guitar: [{start: 0, end: 4}], drums: [{start: 0, end: 4}]},
            shotMoments: {b1: {shots: [{action: 'They play.', characters: ['gtr', 'drm']}]}},
        })[0]!
        expect(c.prompt).toContain('In the video <Subject 3> is only ever at the drum kit, where it stands, to play it - one person, never also a standing figure like the one in <Picture 3>.')
        expect(c.prompt).toContain('and so is its standing pose - Drm is only at the drum kit')
        // a carried instrument is in the picture as it is played: nothing of this
        expect(c.prompt.match(/is only ever at the/g)).toHaveLength(1)
    test('the track definitions keep a silent stretch in the middle of a clip - the band does not play through it (#325)', () => {
        // tides slot-025: an a-cappella line of the bridge, the band heard only at the start and the end of the clip
        const c = buildClipRequests({
            slots: [{id: 'slot-001', index: 0, section: 'Bridge', start: 160, end: 168, bars: 4, energy: 0.5, lyrics: []}],
            mapping: [{slotId: 'slot-001', beatId: 'b1'}],
            beats: [{...beat, characterIds: ['bss', 'drm']}],
            characters: band, locations: [{id: 'clearing', name: 'Stage'}], characterDescriptions: {}, locationDescriptions: {}, lookBrief: '',
            music: {bpm: 120, durationSec: 200, downbeats: [160, 162, 164, 166], barEnergy: [0.5, 0.5, 0.5, 0.5], sections: []}, language: 'English', stemsAvailable: true,
            propActivity: {bass: [{start: 150, end: 162.9}, {start: 165.9, end: 200}], drums: [{start: 0, end: 163.6}, {start: 165.9, end: 200}]},
            shotMoments: {b1: {shots: [{action: 'They play.', characters: ['bss', 'drm']}]}},
        })[0]!
        expect(c.prompt).toContain('<Subject 2> only actually plays from 02:40.000 to 02:43.100 and from 02:45.700 to 02:48.000 of the song; between and outside these spans within <Audio 1>, keep the instrument still.')
        expect(c.prompt).toContain('confined to 02:40.000-02:43.100 and 02:45.700-02:48.000; between and outside these spans <Subject 2> keeps the instrument still')
        expect(c.prompt).toContain("<Subject 3>'s drumming - used to time the cuts and blocking to the beat as well; <Subject 3> only actually plays from 02:40.000 to 02:43.800 and from 02:45.700 to 02:48.000 of the song, between and outside these spans the drums are held still.")
        expect(c.prompt).toContain('drive the drumming motion of <Subject 3>, confined to 02:40.000-02:43.800 and 02:45.700-02:48.000')
        expect(c.prompt).not.toContain('from 02:40.000 to 02:48.000')
    })

    test('context frames: a continuing clip is longer at the head by them, every time in its prompt moves by them', () => {
        const build = (contextFrames: number) => buildClipRequests({
            slots: [0, 1].map(k => ({id: `slot-00${k + 1}`, index: k, section: 'Chorus', start: 4 * k, end: 4 * k + 4, bars: 2, energy: 0.8, lyrics: []})),
            mapping: [{slotId: 'slot-001', beatId: 'b1'}, {slotId: 'slot-002', beatId: 'b1'}],
            beats: [{...beat, characterIds: ['gtr']}],
            characters: band, locations: [{id: 'clearing', name: 'Stage'}], characterDescriptions: {}, locationDescriptions: {}, lookBrief: '',
            music: {bpm: 120, durationSec: 8, downbeats: [0, 2, 4, 6], barEnergy: [0.8, 0.8, 0.8, 0.8], sections: []}, language: 'English', stemsAvailable: true,
            propActivity: {guitar: [{start: 0, end: 8}], drums: [{start: 0, end: 8}]},
            continuity: 'always', pinStartFrame: true, contextFrames,
            shotMoments: {b1: {shots: [0, 1, 2, 3].map(n => ({action: `{Gtr} plays, part ${n}.`, characters: ['gtr']}))}},
        })
        const [first, second] = build(22)
        expect(first!.prompt).not.toContain('end of the previous clip')
        expect(second!.startsFrom).toBe('slot-001')
        expect(second!.prompt).toContain('Its first 1.04 seconds are the end of the previous clip, given as its frames')
        expect(second!.prompt).toContain('At 00:03.042, the shot cuts to')
        expect(build(0)[1]!.prompt).toContain('At 00:02.000, the shot cuts to')
    })
    test('a hands shot shows both hands and the instrument, never the face - and pulls in no singer', () => {
        const c = clip(['lead', 'gtr'], true, {action: '{Gtr} picks a fast run.', characters: ['gtr'], hands: 'gtr', people: {gtr: {state: 'at the front', motion: 'leans in', playing: true, plays: 'picks a fast run'}}})
        expect(c.prompt).toContain('extreme close-up of the hands of <Subject')
        expect(c.prompt).toContain('The hand that strikes, picks or strums, the hand that holds, frets or presses, and the body of the guitar fill the frame; the face is out of the frame.')
        expect(c.shots[0]!.subjects).not.toContain(c.assets.pictures.find(p => p.id === 'lead')?.subject)
    })
    test('a drummer no shot shows is heard off camera - the drum track gives its slot to the players', () => {
        const c = clip(['lead', 'gtr', 'bss', 'drm'], true, {action: 'Lead sings to Gtr and Bss.', characters: ['lead', 'gtr', 'bss'], people: {gtr: {state: 'at the front', motion: 'steps in', playing: true, plays: 'strums'}, bss: {state: 'beside him', motion: 'leans in', playing: true, plays: 'thumbs the low string'}}})
        expect(c.assets.audio.map(a => a.stem)).toEqual(['vocals', 'guitar', 'bass'])
        expect(c.prompt).not.toContain('drum')
        expect(c.prompt).toContain('cut in 2 shots on the downbeats of the music')
    })
    test('a drummer in the picture keeps the drum track - the other players share what is left', () => {
        const c = clip(['lead', 'gtr', 'bss', 'drm'], true)
        expect(c.assets.audio.map(a => a.stem)).toEqual(['vocals', 'mix-bass-guitar', 'drums'])
    })
})
