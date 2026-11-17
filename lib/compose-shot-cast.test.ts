import {describe, expect, test} from 'bun:test'
import {buildClipRequests, type ClipRequest} from './compose.ts'
import {checkPrompt} from './prompt-check.ts'
import type {Character, ShotPlan, StoryBeat} from './project.ts'
import {castProps} from './props.ts'

// A clip whose shots say who they show has the pictures of those people only - not the whole cast of its beat. A
// beat of a band gave a clip of the drummer and the singer all four players and their instruments (8 pictures): the
// model put the singer at the drum kit, and the prompt named the others, with empty "appears in" lines.
const band: Character[] = [
    {id: 'lead', name: 'Lead', role: 'singer'},
    {id: 'gtr', name: 'Gtr', role: 'guitarist', prop: 'an electric guitar', propStem: 'guitar'},
    {id: 'bss', name: 'Bss', role: 'bassist', prop: 'a bass guitar', propStem: 'bass'},
    {id: 'drm', name: 'Drm', role: 'drummer', prop: 'a drum kit', propStem: 'drums', propCarried: false, propInHand: 'drumsticks'},
]

const beat = {
    id: 'b1',
    order: 1,
    summary: 'Drm drives the beat while Gtr and Bss lock in and Lead walks to the front.',
    moments: ['Drm drives the beat.'],
    locationId: 'stage',
    characterIds: ['lead', 'gtr', 'bss', 'drm'],
    intensity: 0.5,
    weight: 1,
    kind: 'build',
    stateAfter: [],
} as StoryBeat

const twoShots: ShotPlan[] = [
    {action: 'Drm hits the snare.', characters: ['drm']},
    {action: 'Lead walks to the front.', characters: ['lead']},
]

function clip(options: {shots?: ShotPlan[]; staging?: string; summary?: string; sung?: boolean} = {}): ClipRequest {
    return buildClipRequests({
        slots: [
            {
                id: 'slot-001',
                index: 0,
                section: 'Intro',
                start: 0,
                end: 4,
                bars: 2,
                energy: 0.8,
                lyrics: [],
                ...(options.sung ? {vocals: [{line: 0, text: 'into the fire', start: 0.2, end: 1.6, words: [{text: 'fire', start: 0.4, end: 1.6}]}]} : {}),
            },
        ],
        ...(options.sung ? {singing: {singers: ['lead'], lines: [{line: 0, text: 'into the fire', singers: ['lead']}]}} : {}),
        mapping: [{slotId: 'slot-001', beatId: 'b1'}],
        beats: [{...beat, ...(options.summary ? {summary: options.summary} : {})}],
        characters: band,
        locations: [{id: 'stage', name: 'Stage'}],
        characterDescriptions: {},
        locationDescriptions: {},
        lookBrief: '',
        music: {bpm: 120, durationSec: 4, downbeats: [0, 2], barEnergy: [0.8, 0.8], sections: []},
        language: 'English',
        stemsAvailable: true,
        propActivity: {guitar: [{start: 0, end: 4}], bass: [{start: 0, end: 4}], drums: [{start: 0, end: 4}]},
        shotMoments: {b1: {shots: options.shots ?? twoShots, ...(options.staging ? {staging: options.staging} : {})}},
        props: castProps(band),
    })[0]!
}

describe('the cast of a clip is the people its shots show', () => {
    test('only the pictures of the people in the shots, and their props', () => {
        const c = clip()
        expect(c.shots.map(s => s.label)).toEqual(['[Shot 1]', '[Shot 2]'])
        expect(c.assets.pictures.map(p => [p.kind, p.id])).toEqual([
            ['location', 'stage'],
            ['character', 'lead'],
            ['character', 'drm'],
            ['prop', 'drum-kit'],
        ])
    })

    test('every subject appears in a shot, and nobody without a picture is named', () => {
        const c = clip({staging: 'Drm sits at the kit at the back, Lead stands at the front, Gtr and Bss stand to the left.'})
        expect(c.prompt).not.toContain('appears in )')
        expect(c.prompt).not.toMatch(/\b(Gtr|Bss)\b/)
        expect(checkPrompt(c)).toEqual([])
    })

    test('a staging that names only the people of the clip is kept', () => {
        const c = clip({staging: 'Drm sits at the kit at the back, Lead stands at the front.'})
        expect(c.prompt).toContain('Layout of the place when the scene begins')
    })

    test('a staging that names somebody without a picture is left out', () => {
        const c = clip({staging: 'Drm sits at the kit at the back, Lead stands at the front, Gtr and Bss stand to the left.'})
        expect(c.prompt).not.toContain('Layout of the place')
    })

    test('a beat summary that names only the people of the clip still opens the scene', () => {
        const c = clip({summary: 'Drm drives the beat and Lead walks to the front.'})
        expect(c.prompt).toContain('<Subject 3> drives the beat and <Subject 2> walks to the front.')
    })

    test('the subjects are not all visible from the first frame: each is from the shots it is in', () => {
        const c = clip()
        expect(c.prompt).not.toContain('Every listed subject is already fully visible')
        expect(c.prompt).toContain('from the first frame of the shots it appears in')
    })

    // tides-261115, slot-019/026: the singer was pulled into a shot of the band the planner had left her out of - "in the frame",
    // without a place - and the video model merged her into the bassist, the singer holding the bass
    test('a singer the plan leaves out of a shot is heard off screen, not pulled into it', () => {
        const c = clip({
            sung: true,
            shots: [
                {action: 'Drm hits the snare.', characters: ['drm']},
                {action: 'Lead walks to the front.', characters: ['lead']},
            ],
        })
        const first = c.prompt.slice(c.prompt.lastIndexOf('[Shot 1] '), c.prompt.lastIndexOf('[Shot 2] '))
        expect(c.shots[0]!.subjects).not.toContain('<Subject 2>')
        expect(first).not.toContain('<Subject 2>, Lead, in the frame')
        expect(first).toContain('the voice of <Subject 2> (S1) is heard off screen, singing <d>[English] into the fire.</d> while <Subject 3> hits the snare.')
        expect(first).not.toContain('holds the long note')
        expect(first).toContain('<Subject 3>, Drm, stays silent')
    })

    test('a plan that answers "no" for the others in the picture says nothing of them', () => {
        const c = clip({shots: [{action: 'Drm hits the snare.', characters: ['drm', 'lead'], rest: 'no'}, twoShots[1]!]})
        expect(c.prompt).not.toContain('in it as well: no')
    })

    test('a plan whose shots do not say who they show keeps the cast of the beat', () => {
        const c = clip({shots: [{action: 'Drm hits the snare.'}, {action: 'Lead walks to the front.'}]})
        expect(c.assets.pictures.filter(p => p.kind === 'character').map(p => p.id)).toEqual(['lead', 'gtr', 'bss', 'drm'])
    })
})
