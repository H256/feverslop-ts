import {describe, expect, test} from "bun:test";
import type {StoryBeat} from "./project.ts";
import {blockingPrompt, type PlanContext, plannerCalls, planPrompt} from "./shot-planner.ts";

const beat = {id: 'beat-01', order: 1, summary: 'Runa walks in.', moments: ['Runa walks in.'], locationId: 'hall', characterIds: ['runa'], intensity: 0.5, weight: 1, kind: 'build', stateAfter: []} as StoryBeat
const context: PlanContext = {
    characters: [{id: 'runa', name: 'Runa', role: 'a girl'}],
    locations: [{id: 'hall', name: 'Hall'}],
    characterDescriptions: {runa: 'A girl in a red coat.'},
    locationDescriptions: {hall: 'A long stone hall with one door on the left.'},
    continuity: 'never',
    slots: [{id: 'slot-001', index: 0, section: 'A', start: 0, end: 8, bars: 4, energy: 0.8, lyrics: []}],
    mapping: [{slotId: 'slot-001', beatId: 'beat-01'}],
    shotCounts: {'beat-01': 6},
    beatSinging: {},
}

describe('the shot planner prompt', () => {
    test('the instructions are the same for every call - which shots and the problems are at the end of the input', () => {
        const first = planPrompt(context, [beat], undefined, undefined, [], {from: 0, to: 4, total: 6, written: []})
        const second = planPrompt(context, [beat], undefined, undefined, ['shot 5: "Bob" is not one of the characters'], {from: 4, to: 6, total: 6, written: [{action: 'x'}], staging: 'A hall.'})
        expect(second.instructions).toBe(first.instructions)
        expect(first.input).toContain('This call writes ONLY shots 1 to 4 of the 6')
        expect(first.input).toContain('Write the STAGING line first.')
        expect(first.input).toContain('no ENDS block')
        expect(second.input).toContain('end with the ENDS block')
        expect(second.input).toEndWith('- shot 5: "Bob" is not one of the characters')
    })
})

describe('asked again: only the calls whose shots have a problem', () => {
    test('the first time every call is asked', () => {
        expect(plannerCalls(10, 4).map(c => [c.from, c.to, c.keep])).toEqual([[0, 4, false], [4, 8, false], [8, 10, false]])
    })
    test('a problem in shot 6 asks the second call again, with only its problem', () => {
        const calls = plannerCalls(10, 4, {issues: [{shot: 5, message: 'shot 6: "Bob" is not one of the characters'}], previousShots: 10})
        expect(calls.map(c => c.keep)).toEqual([true, false, true])
        expect(calls[1]!.problems).toEqual(['shot 6: "Bob" is not one of the characters'])
    })
    test('a problem of the whole beat asks every call again', () => {
        const calls = plannerCalls(10, 4, {issues: [{message: 'shot count: needed 10, got 9'}], previousShots: 9})
        expect(calls.every(c => !c.keep && c.problems.length === 1)).toBe(true)
    })
})

describe('the planner sees what the pictures show', () => {
    test('the descriptions of the place and of the people of the beat are in the input', () => {
        const {input} = planPrompt(context, [beat], undefined, undefined, [], {from: 0, to: 4, total: 6, written: []})
        expect(input).toContain('"hall":{"name":"Hall","description":"A long stone hall with one door on the left."}')
        expect(input).toContain('"Runa":"A girl in a red coat."')
    })
})

describe('the fixed layout of the place', () => {
    test('a place with a layout gives it to the planner; a place without one gives only its description', () => {
        const withLayout = planPrompt({...context, locationLayouts: {hall: {layout: 'The door is on the left, the hearth at the back.', views: []}}}, [beat], undefined, undefined, [], {from: 0, to: 4, total: 6, written: []})
        expect(withLayout.input).toContain('"layout":"The door is on the left, the hearth at the back."')
        const without = planPrompt(context, [beat], undefined, undefined, [], {from: 0, to: 4, total: 6, written: []})
        expect(without.input).not.toContain('"layout"')
        expect(withLayout.instructions).toBe(without.instructions)
    })
})

describe('the example shot', () => {
    test('one complete shot in the answer format instead of weak/strong pairs', () => {
        const {instructions} = planPrompt(context, [beat], undefined, undefined, [], {from: 0, to: 4, total: 6, written: []})
        expect(instructions).not.toContain('Weak:')
        expect(instructions).toContain('One shot as it should be written')
        for (const field of ['framing:', 'size:', 'camera:', 'view:', 'hold:', 'risky:', 'characters:', 'action:', 'person: Kara |', 'rest:']) expect(instructions.split('One shot as it should be written')[1]).toContain(field)
    })
})

describe('blocking first, then the shots', () => {
    test('the blocking call: the same instructions for every beat, the beat before and its ends in the input', () => {
        const first = blockingPrompt(context, beat, undefined, undefined)
        const second = blockingPrompt(context, {...beat, id: 'beat-02'}, {beatId: 'beat-01', staging: 'A hall.', ends: {Runa: 'stands at the door'}}, undefined)
        expect(second.instructions).toBe(first.instructions)
        expect(first.input).toContain('This is the first beat of the video.')
        expect(second.input).toContain('"ends":{"Runa":"stands at the door"}')
        expect(first.reasoning).toBe('low')
    })
    test('a shot call with a blocking writes neither the staging nor the ends', () => {
        const blocking = {staging: 'A hall, the door on the left.', starts: {Runa: 'stands at the door'}, ends: {Runa: 'sits by the fire'}}
        const {input} = planPrompt(context, [beat], undefined, undefined, [], {from: 4, to: 6, total: 6, written: [], blocking})
        expect(input).toContain('Blocking of this beat - fixed, keep to it:')
        expect(input).toContain('write no STAGING line and no ENDS block')
        expect(input).toContain('the last shot of the beat leaves everybody where the blocking ends them')
    })
})
