import {describe, expect, test} from 'bun:test'
import {applyBeatCast} from './beat-cast.ts'
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
        expect(() => applyBeatCast(planned(), {beats: ['beat-01']})).toThrow('name who comes into the beats')
        expect(() => applyBeatCast(planned(), {beats: ['beat-01'], join: [{name: 'Mara', role: ''}]})).toThrow('needs a name and a role')
    })
})
