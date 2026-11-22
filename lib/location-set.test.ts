import {describe, expect, test} from 'bun:test'
import {buildClipRequests, type Input} from './compose.ts'
import {performersOf, setOf} from './pipeline/look.ts'
import type {Character, StoryBeat} from './project.ts'
import {locationLayoutPrompt} from './prompts.ts'
import {placeOf} from './shot-planner.ts'

// The set of a place in a band video (#1119): where the band plays, where a drum kit that stands there stands, where the
// audience watches from. tides-of-eternal-flame-261115: the kit was drawn as a picture of its own (propPictures), the place
// without it - and every beat put the kit and the audience somewhere else, the audience on the stage beside the singer.
const band: Character[] = [
    {id: 'maren', name: 'Maren', role: 'the singer'},
    {id: 'kael', name: 'Kael', role: 'guitarist', prop: 'black guitar', propStem: 'guitar'},
    {id: 'vex', name: 'Vex', role: 'drummer', prop: 'coral drum kit', propStem: 'drums', propCarried: false, propInHand: 'drumsticks', propPlace: 'hall'},
    {id: 'crowd', name: 'The audience', role: 'spectators', isGroup: true},
]

describe('the set of a place', () => {
    test('the players, the drum kit that stands there and the crowd have a place in it; a story without them has none', () => {
        expect(performersOf(band, 'hall')).toEqual([
            {name: 'Kael', role: 'guitarist', prop: 'black guitar'},
            {name: 'Vex', role: 'drummer', prop: 'coral drum kit', standing: true},
            {name: 'The audience', role: 'spectators', group: true},
        ])
        // the kit stands in the hall, not in the forest - and is not in the drummer's hands there (zz-stille-261118)
        expect(performersOf(band, 'forest').find(p => p.name === 'Vex')).toEqual({name: 'Vex', role: 'drummer'})
        expect(performersOf([{id: 'a', name: 'Ann', role: 'a girl'}], 'hall')).toEqual([])
        // a singer has a place on the stage too - slot-033: Maren and Sera were both "in the centre of the stage"
        expect(performersOf(band, 'hall', ['maren'])[0]).toEqual({name: 'Maren', role: 'the singer', sings: true})
    })

    test('everybody of the band gets a place of their own on the stage, the singer and the players who carry theirs too', () => {
        const prompt = locationLayoutPrompt('Hall', 'A hall.', 'A long hall.', performersOf(band, 'hall', ['maren'])).input
        expect(prompt).toContain('"name" exactly as below: "Maren", "Kael", "Vex", "The audience"')
        expect(prompt).toContain('- Maren: the singer - sings')
        expect(prompt).toContain('every one of them at a different place, none of two in the same one')
        // a singer and one guitarist, no crowd and no kit: a band, so a set
        const duo = performersOf(band.slice(0, 2), 'hall', ['maren'])
        expect(locationLayoutPrompt('Hall', 'A hall.', 'A long hall.', duo).input).toContain('"name" exactly as below: "Maren", "Kael"')
        // a place of the story they may only walk through: the model may leave its stage empty, read from the story - not where
        // an instrument stands (the band plays there), not without a band (the prompt as before)
        const story = 'The duo walks the road at night.'
        const road = locationLayoutPrompt('Road', 'A road.', 'A long road.', duo, story).input
        expect(road).toContain('Or "" when the band does not play or sing on a stage here in the story below')
        expect(road).toContain(`The story of the video: ${story}\n\nPlace: Road`)
        const hall = locationLayoutPrompt('Hall', 'A hall.', 'A long hall.', performersOf(band, 'hall', ['maren']), story).input
        expect(hall).not.toContain('Or ""')
        expect(hall).not.toContain('The story of the video')
        expect(locationLayoutPrompt('Road', 'A road.', 'A long road.', [], story).input).toBe(locationLayoutPrompt('Road', 'A road.', 'A long road.', []).input)
        // a singer alone is no band: no set, as before
        expect(locationLayoutPrompt('Hall', 'A hall.', 'A long hall.', performersOf(band.slice(0, 1), 'hall', ['maren'])).input).not.toContain('"set"')
    })

    test('the layout is asked for the set only when there is a band or a crowd', () => {
        const withSet = locationLayoutPrompt('Hall', 'A hall.', 'A long hall.', performersOf(band, 'hall'))
        expect(withSet.input).toContain('"set": where the people below have their fixed places')
        expect(withSet.input).toContain('"name" exactly as below: "Kael", "Vex", "The audience"')
        expect(withSet.input).toContain('- Vex: drummer - plays coral drum kit, which stands in the place')
        // zz-stille-261118 slot-007: the piano player at the back of the piano; tides-261115: "Vex plays behind the kit, facing
        // the throne" - the spot says only where the instrument stands, the clip says the player is on its playing side
        expect(withSet.input).toContain('only where that instrument stands - on the stage, at one fixed feature - and nothing of its player')
        expect((withSet.schema as {required: string[]}).required).toEqual(['layout', 'views', 'set'])
        const without = locationLayoutPrompt('Hall', 'A hall.', 'A long hall.', [])
        expect(without.input).not.toContain('"set"')
        expect((without.schema as {required: string[]}).required).toEqual(['layout', 'views'])
    })

    test('an answer becomes the set by character id; a name not in the cast is left out, no stage is no set', () => {
        const set = setOf(
            {
                stage: 'Between the throne and the mist column.',
                spots: [
                    {name: 'Vex', spot: 'The kit stands in front of the throne.'},
                    {name: 'Nobody', spot: 'Somewhere.'},
                ],
            },
            band,
        )
        expect(set).toEqual({stage: 'Between the throne and the mist column.', spots: {vex: 'The kit stands in front of the throne.'}})
        expect(setOf({stage: '', spots: []}, band)).toBeUndefined()
        expect(setOf(undefined, band)).toBeUndefined()
    })

    test('the blocking and the shot planner read the set by name', () => {
        const place = placeOf(
            'hall',
            [{id: 'hall', name: 'Hall'}],
            {hall: 'A long hall.'},
            {
                hall: {
                    layout: 'The throne at the back.',
                    views: [],
                    set: {stage: 'In front of the throne.', spots: {crowd: 'At the near end, facing the band.'}},
                },
            },
            band,
        )
        expect(place).toEqual({
            name: 'Hall',
            description: 'A long hall.',
            layout: 'The throne at the back.',
            set: {stage: 'In front of the throne.', spots: {'The audience': 'At the near end, facing the band.'}},
        })
    })
})

describe('the set in a clip', () => {
    const beat = {
        id: 'b1',
        order: 1,
        summary: 'The band plays.',
        moments: ['The band plays.'],
        locationId: 'hall',
        characterIds: ['vex', 'kael', 'crowd'],
        intensity: 0.5,
        weight: 1,
        kind: 'build',
        stateAfter: [],
    } as StoryBeat
    const input = (shot: string[]): Input => ({
        slots: [{id: 'slot-001', index: 0, section: 'A', start: 0, end: 4, bars: 2, energy: 0.5, lyrics: []}],
        mapping: [{slotId: 'slot-001', beatId: 'b1'}],
        beats: [beat],
        characters: band,
        locations: [{id: 'hall', name: 'Hall'}],
        characterDescriptions: {vex: 'A drummer.', kael: 'A guitarist.', crowd: 'A fan.'},
        locationDescriptions: {hall: 'A long hall.'},
        locationLayouts: {
            hall: {
                layout: 'The throne at the back.',
                set: {
                    stage: 'In front of the throne.',
                    spots: {vex: 'The kit stands between the pillars', crowd: 'At the near end, facing the band.', kael: 'Left.'},
                },
            },
        },
        lookBrief: '',
        music: {bpm: 120, durationSec: 4, downbeats: [0, 2], barEnergy: [0.5, 0.5], sections: []},
        language: 'English',
        stemsAvailable: false,
        shotMoments: {b1: {shots: [{action: 'The band plays.', characters: shot}]}},
    })

    test('the drum kit and the crowd of the clip have their fixed places in it; a carried guitar has none', () => {
        const prompt = buildClipRequests(input(['vex', 'kael', 'crowd']))[0]!.prompt
        expect(prompt).toContain('Fixed places in <Subject 1>, the same in every shot:')
        expect(prompt).toContain('Vex, at the coral drum kit, on the side it is played from, never at its back: The kit stands between the pillars;')
        expect(prompt).toContain('The audience: At the near end, facing the band')
        expect(prompt).not.toContain(': Left')
    })

    // tides-261115, slot-040: "The audience, in the frame" - the crowd stood on the stage between the band
    test('somebody in a shot without an entry of their own is in their fixed place', () => {
        const prompt = buildClipRequests(input(['vex', 'kael', 'crowd']))[0]!.prompt
        expect(prompt).toContain(
            'The audience, nearest to the camera, their backs to it, facing the band - in their fixed place: At the near end, facing the band',
        )
        expect(prompt).not.toMatch(/The audience, in the frame/)
    })

    test('a clip without them says nothing of the set', () => {
        expect(buildClipRequests(input(['kael']))[0]!.prompt).not.toContain('Fixed places')
    })

    // tides-261115 slot-028: every player placed in the frame on their own - the singer was drawn big among the crowd in front of
    // the camera, three renders of three; slot-025: the crowd faced the camera. The crowd first, backs to the lens, the band beyond it
    test('a shot of the crowd with the band: the crowd first with its back to the camera, the band as one group far beyond it', () => {
        const prompt = buildClipRequests(input(['vex', 'kael', 'crowd']))[0]!.prompt
        expect(prompt).toMatch(
            /In frame: <Subject \d+>, The audience, nearest to the camera, their backs to it, facing the band - in their fixed place: At the near end, facing the band; far beyond <Subject \d+>, small on the stage: <Subject \d+>, Vex, at the coral drum kit/,
        )
        expect(prompt).toContain('Both are on the stage, far from the camera and small in the picture; nobody of the band is among')
        const without = buildClipRequests(input(['vex', 'kael']))[0]!.prompt
        expect(without).not.toContain('far beyond')
        expect(without).not.toContain('far from the camera')
    })

    // #1187: a start picture locked at the shot's first frame draws who stands where - the words that held slot-028 told only
    // what moves: no crowd first, no band far beyond, no place in the frame
    test('a shot with a start picture tells only what moves; without one it is told in full', () => {
        const staged = input(['vex', 'kael', 'crowd'])
        staged.shotMoments = {
            b1: {
                shots: [
                    {
                        action: 'The band plays.',
                        characters: ['vex', 'kael', 'crowd'],
                        view: 'from behind the audience',
                        people: {kael: {state: 'on the left of the stage', frame: 'left of centre', motion: 'he rocks on his heels'}},
                    },
                ],
            },
        }
        const pinned = buildClipRequests({...staged, pinnedShots: (clip, shot) => clip === 'slot-001' && shot === 0})[0]!.prompt
        expect(pinned).toContain('The shot starts on its first frame as it is given: everyone is where that frame shows them and moves on from there.')
        expect(pinned).toMatch(/<Subject \d+>, Kael, he rocks on his heels/)
        expect(pinned).toMatch(/<Subject \d+>, Vex, where the first frame shows them/)
        for (const told of ['far beyond', 'left of centre', 'on the left of the stage', 'Camera position:', 'nearest to the camera'])
            expect(pinned).not.toContain(told)
        const full = buildClipRequests(staged)[0]!.prompt
        expect(full).not.toContain('as it is given')
        expect(full).toContain('far beyond')
        // one shot of two with a picture: the clip keeps its places for the other; all of them: the pictures hold the places
        expect(pinned).toContain('Fixed places')
        const all = buildClipRequests({...staged, pinnedShots: () => true})[0]!.prompt
        expect(all).not.toContain('Fixed places')
        expect(all).not.toContain('Layout of the place')
    })
})
