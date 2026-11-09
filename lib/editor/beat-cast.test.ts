import {describe, expect, test} from 'bun:test'
import {applyBeatCast as apply, mergeCastRules} from './beat-cast.ts'
import type {BeatCastChange} from '../../shared/workspace.ts'
import type {Project} from '../project.ts'

const planned = (): Project =>
    ({
        cast: {
            characters: [{id: 'elias', name: 'Elias', role: 'the singer'}],
            locations: [{id: 'hall', name: 'Hall'}],
        },
        beats: [
            {id: 'beat-01', summary: 'Elias walks', characterIds: ['elias'], kind: 'build', moments: [], stateAfter: []},
            {id: 'beat-02', summary: 'Elias sings', characterIds: ['elias'], kind: 'build', moments: [], stateAfter: []},
        ],
        characterLooks: {elias: 'a man in a grey coat'},
        characterDescriptions: {elias: 'Elias, grey coat'},
        locationLooks: {hall: 'a dark hall'},
        timeline: {slots: []},
        blocking: {'beat-01': {staging: 'a', starts: {}, ends: {}}, 'beat-02': {staging: 'b', starts: {}, ends: {}}},
        shotMoments: {'beat-01': {staging: 'a', shots: []}, 'beat-02': {staging: 'b', shots: []}},
    }) as unknown as Project
// beat-01: slot-001, slot-002 · beat-02: slot-003, slot-004 (cut into two shots), slot-005
const clips = new Map([
    [
        'beat-01',
        [
            {clip: 'slot-001', shots: [1]},
            {clip: 'slot-002', shots: [2]},
        ],
    ],
    [
        'beat-02',
        [
            {clip: 'slot-003', shots: [1]},
            {clip: 'slot-004', shots: [2, 3]},
            {clip: 'slot-005', shots: [4]},
        ],
    ],
])
const applyBeatCast = (data: Project, change: BeatCastChange) => apply(data, change, clips)

describe('people brought into chosen beats of a planned music video (#765)', () => {
    test('new people join the cast: only their looks are written again, the beats, the timeline and the other shots stay', () => {
        const data = planned()
        const result = applyBeatCast(data, {beats: ['beat-02'], join: [{name: 'Mara', role: 'a dancer in a red dress'}]})
        expect(result.joined).toEqual(['mara'])
        expect(data.cast!.characters.map(c => c.id)).toEqual(['elias', 'mara'])
        expect(data.beats!.find(b => b.id === 'beat-02')!.characterIds).toEqual(['elias', 'mara'])
        expect(data.beats!.find(b => b.id === 'beat-01')!.characterIds).toEqual(['elias'])
        // the look of elias is kept by hand: the next run asks for mara only
        expect(data.characterLooks).toBeUndefined()
        expect(Object.keys(data.partials!.characterLooks!)).toEqual(['elias'])
        expect(data.locationLooks).toEqual({hall: 'a dark hall'})
        expect(data.timeline).toBeDefined()
        expect(Object.keys(data.shotMoments!)).toEqual(['beat-01'])
        expect(Object.keys(data.blocking!)).toEqual(['beat-01'])
        expect(result.replanned).toEqual(['beat-02'])
    })

    test('a character of the cast into two beats: nothing of the cast changes', () => {
        const data = planned()
        data.cast!.characters.push({id: 'lene', name: 'Lene', role: 'a dancer'} as never)
        const result = applyBeatCast(data, {beats: ['beat-01', 'beat-02'], characters: ['lene']})
        expect(result.joined).toEqual([])
        expect(result.added).toEqual([
            {beat: 'beat-01', character: 'lene'},
            {beat: 'beat-02', character: 'lene'},
        ])
        expect(data.characterLooks).toEqual({elias: 'a man in a grey coat'})
        expect(data.shotMoments).toEqual({})
    })

    test('says what is wrong', () => {
        expect(() => applyBeatCast(planned(), {beats: ['beat-09'], characters: ['elias']})).toThrow('no beat beat-09')
        expect(() => applyBeatCast(planned(), {beats: ['beat-01'], characters: ['nobody']})).toThrow('no character nobody')
        expect(() => applyBeatCast(planned(), {beats: ['beat-01']})).toThrow('name who comes into the shots or goes out')
        expect(() => applyBeatCast(planned(), {beats: ['beat-01'], join: [{name: 'Mara', role: ''}]})).toThrow('needs a name and a role')
    })

    test('without a note, a newcomer still gets a rule: the planner leaves out whoever the beat text does not name otherwise', () => {
        const data = planned()
        data.cast!.characters.push({id: 'lene', name: 'Lene', role: 'a dancer'} as never)
        const {castRules} = applyBeatCast(data, {beats: ['beat-01'], characters: ['lene']})
        expect(castRules).toEqual([
            {
                text: 'Lene is in this beat and seen in its shots.',
                scope: {kind: 'beat', id: 'beat-01'},
                planned: true,
                presence: {characters: ['lene'], in: true},
            },
        ])
    })
})

describe('who is in which shots (#767)', () => {
    const withDancers = () => {
        const data = planned()
        data.cast!.characters.push({id: 'suzie', name: 'Suzie', role: 'a dancer'} as never, {id: 'leanne', name: 'Leanne', role: 'a dancer'} as never)
        return data
    }
    test('some clips of a beat: the beat gets them, the marked shots say they are in, the others that they are not', () => {
        const data = withDancers()
        const result = applyBeatCast(data, {clips: ['slot-003', 'slot-004'], characters: ['suzie', 'leanne'], note: 'They dance.'})
        expect(result.beats).toEqual(['beat-02'])
        // slot-004 is cut into two shots: both are in
        expect(result.shots).toEqual(['beat-02:shot1', 'beat-02:shot2', 'beat-02:shot3'])
        expect(data.beats!.find(b => b.id === 'beat-02')!.characterIds).toEqual(['elias', 'suzie', 'leanne'])
        expect(Object.keys(data.shotMoments!)).toEqual(['beat-01'])
        expect(result.castRules.map(r => [r.scope, r.text])).toEqual([
            [{kind: 'shot', id: 'beat-02:shot1'}, 'Suzie and Leanne are in this shot.'],
            [{kind: 'shot', id: 'beat-02:shot1'}, 'They dance.'],
            [{kind: 'shot', id: 'beat-02:shot2'}, 'Suzie and Leanne are in this shot.'],
            [{kind: 'shot', id: 'beat-02:shot2'}, 'They dance.'],
            [{kind: 'shot', id: 'beat-02:shot3'}, 'Suzie and Leanne are in this shot.'],
            [{kind: 'shot', id: 'beat-02:shot3'}, 'They dance.'],
            [{kind: 'shot', id: 'beat-02:shot4'}, 'Suzie and Leanne are not in this shot.'],
        ])
    })
    test('all clips of a beat count as the beat', () => {
        const data = withDancers()
        const result = applyBeatCast(data, {clips: ['slot-001', 'slot-002', 'slot-003'], characters: ['suzie']})
        expect(result.beats).toEqual(['beat-01', 'beat-02'])
        expect(result.castRules.map(r => r.scope)).toEqual([
            {kind: 'beat', id: 'beat-01'},
            {kind: 'shot', id: 'beat-02:shot1'},
            {kind: 'shot', id: 'beat-02:shot2'},
            {kind: 'shot', id: 'beat-02:shot3'},
            {kind: 'shot', id: 'beat-02:shot4'},
        ])
    })
    test('out of a whole beat: off its cast, with a rule against what its text still says', () => {
        const data = withDancers()
        data.beats![1]!.characterIds.push('suzie', 'leanne')
        const result = applyBeatCast(data, {beats: ['beat-02'], without: ['suzie', 'leanne']})
        expect(data.beats![1]!.characterIds).toEqual(['elias'])
        expect(result.removed).toEqual([
            {beat: 'beat-02', character: 'suzie'},
            {beat: 'beat-02', character: 'leanne'},
        ])
        expect(result.castRules[0]!.text).toStartWith('Suzie and Leanne are not in this beat: no shot shows them')
        expect(result.castRules[0]!.presence).toEqual({characters: ['suzie', 'leanne'], in: false})
    })
    test('out of some shots: they stay in the beat', () => {
        const data = withDancers()
        data.beats![1]!.characterIds.push('suzie')
        const result = applyBeatCast(data, {clips: ['slot-005'], without: ['suzie']})
        expect(data.beats![1]!.characterIds).toEqual(['elias', 'suzie'])
        expect(result.castRules.map(r => [r.scope, r.text])).toEqual([[{kind: 'shot', id: 'beat-02:shot4'}, 'Suzie is not in this shot.']])
    })
    test('says what is wrong', () => {
        expect(() => applyBeatCast(withDancers(), {clips: ['slot-009'], characters: ['suzie']})).toThrow('no clip slot-009')
        expect(() => applyBeatCast(withDancers(), {beats: ['beat-01'], without: ['suzie']})).toThrow('suzie is in none of beat-01')
        expect(() => applyBeatCast(withDancers(), {beats: ['beat-01'], characters: ['suzie'], without: ['suzie']})).toThrow('cannot come in and go out')
    })
    test('a newer presence rule takes its people out of older ones on the same beat or shot', () => {
        const data = withDancers()
        const old = [
            {
                id: 'a',
                text: 'Suzie and Leanne are in this beat and seen in its shots.',
                scope: {kind: 'beat' as const, id: 'beat-02'},
                planned: true,
                presence: {characters: ['suzie', 'leanne'], in: true},
            },
            {
                id: 'b',
                text: 'Suzie is in this shot.',
                scope: {kind: 'shot' as const, id: 'beat-01:shot1'},
                planned: true,
                presence: {characters: ['suzie'], in: true},
            },
            {id: 'c', text: 'They dance.', scope: {kind: 'beat' as const, id: 'beat-02'}, planned: true},
        ]
        const merged = mergeCastRules(old, data, [
            {text: 'Suzie is not in this shot.', scope: {kind: 'shot', id: 'beat-02:shot3'}, planned: true, presence: {characters: ['suzie'], in: false}},
        ])
        expect(merged.map(r => r.text)).toEqual([
            'Leanne is in this beat and seen in its shots.',
            'Suzie is in this shot.',
            'They dance.',
            'Suzie is not in this shot.',
        ])
        expect(merged[0]!.presence).toEqual({characters: ['leanne'], in: true})
    })
})
