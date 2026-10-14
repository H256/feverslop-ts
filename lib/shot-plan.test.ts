import {describe, expect, test} from "bun:test";
import {asBeatShots, readBeatPlan} from "./shot-plan.ts";
import type {Character, StoryBeat} from "./project.ts";

const cael: Character = {id: 'cael', name: 'Cael', role: 'singer'}
const maren: Character = {id: 'maren', name: 'Maren', role: 'miner'}
const beat = {id: 'b1', characterIds: ['cael', 'maren']} as StoryBeat

describe('readBeatPlan', () => {
    test('resolves names to ids, takes the staging and the ends, pads to the shots needed', () => {
        const r = readBeatPlan({staging: 'the shaft on the left', ends: {Cael: 'stands at the shaft'}, shots: [
            {action: 'Cael lifts the hammer', characters: ['Cael', 'Maren'], people: {Cael: {state: 'stands', frame: 'left', motion: 'stays'}}, hold: true},
        ]}, beat, [cael, maren], 2)!
        expect(r.problems).toEqual([])
        expect(r.plan.shots).toHaveLength(2)
        expect(r.plan.shots[0]!.characters).toEqual(['cael', 'maren'])
        expect(r.plan.shots[0]!.people!.cael!.frame).toBe('left')
        expect(r.plan.ends).toEqual({cael: 'stands at the shaft'})
    })
    test('asks again for an unknown name, a stranger in the text and a singing shot without a singer', () => {
        const r = readBeatPlan({shots: [{action: 'Maren swings', characters: ['Cael', 'Nobody']}]}, beat, [cael, maren], 1, {singerIds: ['cael'], singingPerShot: [true]})!
        expect(r.problems.length).toBe(2)
        const q = readBeatPlan({shots: [{action: 'Maren swings', characters: ['Cael']}]}, beat, [cael, maren], 1)!
        expect(q.problems[0]).toContain('Maren')
        const none = readBeatPlan({shots: [{action: 'x', characters: ['Maren']}]}, beat, [cael, maren], 1, {singerIds: ['cael'], singingPerShot: [true]})!
        expect(none.problems[0]).toContain('sung')
    })
    test('an old plan of actions stays usable', () => {
        expect(asBeatShots(['a', 'b']).shots.map(s => s.action)).toEqual(['a', 'b'])
    })
})

describe('readBeatPlan - individuals', () => {
    const brenna: Character = {id: 'brenna', name: 'Brenna', role: 'smith'}
    const sylvi: Character = {id: 'sylvi', name: 'Sylvi', role: 'smith'}
    const orcs: Character = {id: 'orcs', name: 'Orcs', role: 'crowd', isGroup: true, alike: true}
    const party = {id: 'b2', characterIds: ['brenna', 'sylvi', 'orcs']} as StoryBeat
    const all = [brenna, sylvi, orcs]

    test('two people with the same motion are in unison and asked again', () => {
        const r = readBeatPlan({shots: [{action: 'They strike', characters: ['Brenna', 'Sylvi'], people: {
            Brenna: {state: 'by the wall', motion: 'drives the hammer down in an overhead arc'},
            Sylvi: {state: 'by the river', motion: 'Drives the hammer down in an overhead arc.'},
        }}]}, party, all, 1)!
        expect(r.problems).toHaveLength(1)
        expect(r.problems[0]).toContain('Brenna, Sylvi')
    })
    test('different motions, and a crowd entry next to a person, are fine', () => {
        const r = readBeatPlan({shots: [{action: 'They strike', characters: ['Brenna', 'Sylvi', 'Orcs'], people: {
            Brenna: {state: 'by the wall', motion: 'swings low from the left'},
            Sylvi: {state: 'by the river', motion: 'ducks and drives the haft up'},
            Orcs: {state: 'press in', motion: 'the first lunges, two hang back'},
        }}]}, party, all, 1)!
        expect(r.problems).toEqual([])
    })
    test('somebody who does not sing in the shot is not described singing', () => {
        const singers = {singerIds: ['brenna'], singingPerShot: [true]}
        const r = readBeatPlan({shots: [{action: 'They march', characters: ['Brenna', 'Sylvi'], people: {
            Brenna: {state: 'leads', motion: 'sings, mouth open on the verse'},
            Sylvi: {state: 'follows', motion: 'mouth open on the verse'},
        }}]}, party, all, 1, singers)!
        expect(r.problems).toHaveLength(1)
        expect(r.problems[0]).toContain('Sylvi')
        const silent = readBeatPlan({shots: [{action: 'They march', characters: ['Brenna'], people: {Brenna: {state: 'leads', motion: 'sings'}}}]}, party, all, 1, {singerIds: ['brenna'], singingPerShot: [false]})!
        expect(silent.problems[0]).toContain('Brenna')
    })
})

describe('readBeatPlan - foreground', () => {
    const names = ['Anna', 'Bea', 'Cora', 'Dina', 'Edda', 'Fay']
    const cast: Character[] = names.map(name => ({id: name.toLowerCase(), name, role: 'x'}))
    const beat7 = {id: 'b3', characterIds: cast.map(c => c.id)} as StoryBeat
    const entry = (name: string, n: number) => ({state: `stands ${n} paces from the wall`, motion: `does move number ${n}`})

    test('more than four own entries in one shot are asked again', () => {
        const people = Object.fromEntries(names.slice(0, 5).map((n, i) => [n, entry(n, i)]))
        const r = readBeatPlan({shots: [{action: 'They fight', framing: 'wide shot', characters: names.slice(0, 5), people}]}, beat7, cast, 1)!
        expect(r.problems).toHaveLength(1)
        expect(r.problems[0]).toContain('5 people have their own entry')
    })
    test('more than four people in a medium shot are asked again, in a wide shot they are fine', () => {
        const medium = readBeatPlan({shots: [{action: 'They march', framing: 'medium shot', characters: names}]}, beat7, cast, 1)!
        expect(medium.problems[0]).toContain('only a wide or establishing shot')
        const wide = readBeatPlan({shots: [{action: 'They march', framing: 'wide shot', characters: names, people: {Anna: entry('Anna', 1), Bea: entry('Bea', 2)}}]}, beat7, cast, 1)!
        expect(wide.problems).toEqual([])
    })
})
