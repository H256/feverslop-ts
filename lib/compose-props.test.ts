import {describe, expect, test} from 'bun:test'
import {buildClipRequests, type ClipRequest} from './compose.ts'
import {checkPrompt} from './prompt-check.ts'
import type {Character, PropActivity, ShotPlan, StoryBeat} from './project.ts'
import {castProps} from './props.ts'

// config.propPictures (#944): a character's prop comes into a clip with its owner, as a picture of its own
const beat = {
    id: 'b1',
    order: 1,
    summary: 'They play.',
    moments: ['They play.'],
    locationId: 'stage',
    characterIds: [],
    intensity: 0.5,
    weight: 1,
    kind: 'build',
    stateAfter: [],
} as StoryBeat

const band: Character[] = [
    {id: 'lead', name: 'Lead', role: 'singer'},
    {id: 'gtr', name: 'Gtr', role: 'guitarist', prop: 'an electric guitar', propStem: 'guitar'},
    {id: 'bss', name: 'Bss', role: 'bassist', prop: 'a bass guitar', propStem: 'bass'},
    {id: 'drm', name: 'Drm', role: 'drummer', prop: 'a drum kit', propStem: 'drums', propCarried: false, propInHand: 'drumsticks'},
]
const everything: PropActivity = {guitar: [{start: 0, end: 4}], bass: [{start: 0, end: 4}], drums: [{start: 0, end: 4}]}

function clip(
    ids: string[],
    options: {shots?: ShotPlan[]; props?: boolean; characters?: Character[]; activity?: PropActivity; beat?: Partial<StoryBeat>} = {},
): ClipRequest {
    const characters = options.characters ?? band
    return buildClipRequests({
        slots: [{id: 'slot-001', index: 0, section: 'Chorus', start: 0, end: 4, bars: 2, energy: 0.8, lyrics: []}],
        mapping: [{slotId: 'slot-001', beatId: 'b1'}],
        beats: [{...beat, characterIds: ids, ...options.beat}],
        characters,
        locations: [{id: 'stage', name: 'Stage'}],
        characterDescriptions: {},
        locationDescriptions: {},
        lookBrief: '',
        music: {bpm: 120, durationSec: 4, downbeats: [0, 2], barEnergy: [0.8, 0.8], sections: []},
        language: 'English',
        stemsAvailable: true,
        propActivity: options.activity ?? everything,
        shotMoments: {b1: {shots: options.shots ?? [{action: 'They play.', characters: ids}]}},
        ...(options.props === false ? {} : {props: castProps(characters)}),
    })[0]!
}

describe('prop pictures in a clip request (#944)', () => {
    test('without the setting the request has no prop picture', () => {
        const c = clip(['gtr'], {props: false})
        expect(c.assets.pictures.map(p => p.kind)).toEqual(['location', 'character'])
        expect(c.prompt).not.toContain('exactly as in')
    })

    test('the prop comes after the characters, with its subject definition, its shots and its retention line', () => {
        const c = clip(['lead', 'gtr'])
        expect(c.assets.pictures.map(p => [p.label, p.kind, p.file])).toEqual([
            ['<Picture 1>', 'location', 'assets/locations/stage.png'],
            ['<Picture 2>', 'character', 'assets/characters/lead.png'],
            ['<Picture 3>', 'character', 'assets/characters/gtr.png'],
            ['<Picture 4>', 'prop', 'assets/props/electric-guitar.png'],
        ])
        expect(c.prompt).toContain('<Subject 4> is the electric guitar of <Subject 3>, the object in <Picture 4>: an electric guitar')
        expect(c.prompt).toContain('In the shot: <Subject 4>, the electric guitar of <Subject 3>, exactly as in <Picture 4>.')
        expect(c.prompt).toMatch(
            /<Subject 4> \(appears in \[Shot 1\]\): fully_preserved - the shape, size, colors and material of the electric guitar are retained/,
        )
        expect(checkPrompt(c)).toEqual([])
    })

    test('a shot without its owner does not name the prop', () => {
        const c = clip(['lead', 'gtr'], {
            shots: [
                {action: 'Lead sings.', characters: ['lead']},
                {action: 'Gtr plays.', characters: ['gtr']},
            ],
        })
        const [first, second] = c.prompt.split('[Shot 2]').slice(-2)
        expect(first).not.toContain('In the shot: <Subject 4>')
        expect(second).toContain('In the shot: <Subject 4>')
        expect(c.shots.map(s => s.subjects.includes('<Subject 4>'))).toEqual([false, true])
    })

    test('a drum kit that stands in the place is a prop picture of its own too', () => {
        const c = clip(['drm'])
        expect(c.assets.pictures.at(-1)).toMatchObject({kind: 'prop', file: 'assets/props/drum-kit.png'})
        expect(c.prompt).toContain('<Subject 3> is the drum kit of <Subject 2>')
    })

    test('the props of the players heard in the clip come first; one that does not fit is drawn from its words', () => {
        // seven people, one location: one picture slot is left over for a prop
        const crowd: Character[] = [...band, ...['a', 'b', 'c'].map(id => ({id, name: id.toUpperCase(), role: 'fan'}))]
        const c = clip(
            crowd.map(c => c.id),
            {characters: crowd, activity: {bass: [{start: 0, end: 4}]}},
        )
        expect(c.assets.pictures.filter(p => p.kind === 'prop').map(p => p.id)).toEqual(['bass-guitar'])
        expect(c.droppedProps).toEqual(['electric-guitar', 'drum-kit'])
        expect(c.assets.pictures).toHaveLength(9)
    })

    test("a group's other members give way to the props", () => {
        const crew: Character[] = [
            {id: 'gtr', name: 'Gtr', role: 'guitarist', prop: 'an electric guitar', propStem: 'guitar'},
            ...['a', 'b', 'c', 'd'].map(id => ({id, name: id.toUpperCase(), role: 'fan'})),
            {id: 'orcs', name: 'Orcs', role: 'a horde', isGroup: true},
        ]
        const ids = crew.map(c => c.id)
        const request = (props: boolean) =>
            buildClipRequests({
                slots: [{id: 'slot-001', index: 0, section: 'Chorus', start: 0, end: 4, bars: 2, energy: 0.8, lyrics: []}],
                mapping: [{slotId: 'slot-001', beatId: 'b1'}],
                beats: [{...beat, characterIds: ids, groupSize: {orcs: 9}}],
                characters: crew,
                locations: [{id: 'stage', name: 'Stage'}],
                characterDescriptions: {},
                locationDescriptions: {},
                lookBrief: '',
                music: {bpm: 120, durationSec: 4, downbeats: [0, 2], barEnergy: [0.8, 0.8], sections: []},
                language: 'English',
                stemsAvailable: true,
                propActivity: everything,
                shotMoments: {b1: {shots: [{action: 'They play.', characters: ids}]}},
                ...(props ? {props: castProps(crew)} : {}),
            })[0]!.assets.pictures.map(p => p.kind)
        // the location and six of the cast: two slots left, for two other orcs - or the guitar and one other orc
        const members = (kinds: string[]) => kinds.slice(7).filter(k => k === 'character').length
        const without = request(false)
        const withProps = request(true)
        expect(without.slice(7)).toEqual(['character', 'character'])
        expect(withProps.slice(7)).toEqual(['prop', 'character'])
        expect(members(withProps)).toBe(members(without) - 1)
    })
})
