import {describe, expect, test} from "bun:test";
import type {StoryBeat} from "./project.ts";
import {type PlanContext, planPrompt} from "./shot-planner.ts";

const beat = {id: 'beat-01', order: 1, summary: 'Runa walks in.', moments: ['Runa walks in.'], locationId: 'hall', characterIds: ['runa'], intensity: 0.5, weight: 1, kind: 'build', stateAfter: []} as StoryBeat
const context: PlanContext = {
    characters: [{id: 'runa', name: 'Runa', role: 'a girl'}],
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
