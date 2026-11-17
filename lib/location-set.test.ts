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
        // the kit stands in the hall, not in the forest
        expect(performersOf(band, 'forest').find(p => p.name === 'Vex')?.standing).toBeUndefined()
        expect(performersOf([{id: 'a', name: 'Ann', role: 'a girl'}], 'hall')).toEqual([])
    })

    test('the layout is asked for the set only when there is a band or a crowd', () => {
        const withSet = locationLayoutPrompt('Hall', 'A hall.', 'A long hall.', performersOf(band, 'hall'))
        expect(withSet.input).toContain('"set": where the people below have their fixed places')
        expect(withSet.input).toContain('"name" exactly as below: "Vex", "The audience"')
        expect(withSet.input).toContain('- Vex: drummer - plays coral drum kit, which stands in the place')
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
                    spots: {vex: 'The kit stands in front of the throne.', crowd: 'At the near end, facing the band.', kael: 'Left.'},
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
        expect(prompt).toContain('Vex, at the coral drum kit: The kit stands in front of the throne')
        expect(prompt).toContain('The audience: At the near end, facing the band')
        expect(prompt).not.toContain(': Left')
    })

    test('a clip without them says nothing of the set', () => {
        expect(buildClipRequests(input(['kael']))[0]!.prompt).not.toContain('Fixed places')
    })
})
