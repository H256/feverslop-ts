import {describe, expect, test} from 'bun:test'
import {crowdViewCases, crowdViewIssues} from './crowd-view-check.ts'
import type {AskOptions} from './llm.ts'
import type {ShotPlan} from './project.ts'

// tides-261115 slot-040: "from the nave floor among the audience" - the crowd drawn on the stage around the band
const characters = [
    {id: 'kael', name: 'Kael', prop: 'guitar'},
    {id: 'maren', name: 'Maren'},
    {id: 'crowd', name: 'The audience', isGroup: true},
]
const set = {stage: 'At the throne wall.', spots: {crowd: 'On the nave floor in front of the stage.'}}
const shots: ShotPlan[] = [
    {action: 'a', characters: ['kael', 'maren', 'crowd'], view: 'from the nave floor among the audience'},
    {action: 'b', characters: ['kael', 'maren'], view: 'from the stage edge'},
    {action: 'c', characters: ['maren', 'crowd'], view: 'from behind the audience'},
]

describe('crowdViewCases', () => {
    test('a shot of the crowd of the set with somebody who plays - not without the crowd, not without a player, not without a set', () => {
        expect(crowdViewCases(shots, characters, set)).toEqual([
            {shot: 0, crowd: 'The audience', band: ['Kael'], view: 'from the nave floor among the audience'},
        ])
        expect(crowdViewCases(shots, characters, undefined)).toEqual([])
        expect(crowdViewCases(shots, characters, {stage: 'x', spots: {}})).toEqual([])
    })
})

describe('crowdViewIssues', () => {
    const asked: AskOptions[] = []
    const answering =
        (over: boolean[]) =>
        async <T>(options: AskOptions): Promise<T> => {
            asked.push(options)
            return {over} as T
        }
    const cases = crowdViewCases(shots, characters, set)

    test('a "no" is a problem of its shot, with what to write instead', async () => {
        const issues = await crowdViewIssues(cases, answering([false]))
        expect(issues).toEqual([expect.objectContaining({shot: 0})])
        expect(issues[0]!.message).toContain('a "view" from behind The audience, over their heads toward the stage')
        expect(await crowdViewIssues(cases, answering([true]))).toEqual([])
    })
    test('one call for the beat, thinking off; nothing to check asks nothing', async () => {
        asked.length = 0
        await crowdViewIssues(cases, answering([true]))
        expect(asked).toHaveLength(1)
        expect(asked[0]!.reasoning).toBe('none')
        expect(await crowdViewIssues([], answering([]))).toEqual([])
        expect(asked).toHaveLength(1)
    })
})
