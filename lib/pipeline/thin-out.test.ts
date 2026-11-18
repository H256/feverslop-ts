import {describe, expect, test} from 'bun:test'
import type {Character, ShotPlan} from '../project.ts'
import {withoutLeaving} from './plan-shots.ts'

// tides-261115 beat-12, shot 8: four of the band in a medium shot after the second answer as well
const band: Character[] = [
    {id: 'vex', name: 'Vex', role: 'drummer'},
    {id: 'maren', name: 'Maren', role: 'singer'},
    {id: 'kael', name: 'Kael', role: 'guitarist'},
    {id: 'sera', name: 'Sera', role: 'bassist'},
]
const shot: ShotPlan = {
    action: '{Maren} sings to {Kael}, {Sera} sways beside them, {Vex} drives the beat',
    size: 'medium',
    characters: ['vex', 'maren', 'kael', 'sera'],
    people: {vex: {state: 'at the kit'}, maren: {state: 'front'}, kael: {state: 'left'}, sera: {state: 'right'}},
    rest: '{Sera} nods along',
}

describe('an overfull shot rewritten without who leaves it', () => {
    test('the new words, and who leaves is gone from its people', () => {
        const thinned = withoutLeaving(shot, ['sera'], '{Maren} sings to {Kael}, {Vex} drives the beat', '', band)!
        expect(thinned.action).toBe('{Maren} sings to {Kael}, {Vex} drives the beat')
        expect(thinned.characters).toEqual(['vex', 'maren', 'kael'])
        expect(Object.keys(thinned.people!)).toEqual(['vex', 'maren', 'kael'])
        expect(thinned.rest).toBeUndefined()
        expect(thinned.size).toBe('medium')
    })
    test('a rewrite that still names who leaves, or has no action, keeps the shot as it was', () => {
        expect(withoutLeaving(shot, ['sera'], '{Maren} sings, {Sera} sways', '', band)).toBeUndefined()
        expect(withoutLeaving(shot, ['sera'], '{Maren} sings', '{Sera} nods', band)).toBeUndefined()
        expect(withoutLeaving(shot, ['sera'], ' ', '', band)).toBeUndefined()
    })
})
