import {describe, expect, test} from "bun:test";
import type {StoryBeat} from "./project.ts";
import {type PlanContext, plannerCalls, planPrompt} from "./shot-planner.ts";

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
