import {describe, expect, test} from 'bun:test'
import type {AskOptions} from './llm.ts'
import {placementCases, placementIssues} from './placement-check.ts'
import type {ShotPlan} from './project.ts'

// tides-261115 slot-014: Sera "between Maren and Kael" but right of centre, Kael left of it - Kael drawn twice, Sera left out
const characters = [
    {id: 'maren', name: 'Maren'},
    {id: 'kael', name: 'Kael'},
    {id: 'sera', name: 'Sera'},
]
const shots: ShotPlan[] = [
    {
        action: 'x',
        view: 'from the entrance wall, looking toward the throne wall',
        camera: 'slow arc',
        people: {
            maren: {state: 'at the centre of the mist column', frame: 'sharp, center of frame'},
            kael: {state: "to Maren's left toward the algae wall", frame: 'sharp, left of center'},
            sera: {state: 'between Maren and Kael', frame: 'sharp, right of center'},
        },
    },
    // two people, or somebody without a place in the picture: nothing to check
    {action: 'y', people: {maren: {frame: 'left'}, kael: {frame: 'right'}}},
    {action: 'z', people: {maren: {frame: 'left'}, kael: {frame: 'right'}, sera: {state: 'behind them'}}},
]

describe('placementCases', () => {
    test('a shot with three or more people placed in the picture, with the camera and their words', () => {
        expect(placementCases(shots, characters)).toEqual([
            {
                shot: 0,
                view: 'from the entrance wall, looking toward the throne wall; slow arc',
                people: [
                    {name: 'Maren', state: 'at the centre of the mist column', frame: 'sharp, center of frame'},
                    {name: 'Kael', state: "to Maren's left toward the algae wall", frame: 'sharp, left of center'},
                    {name: 'Sera', state: 'between Maren and Kael', frame: 'sharp, right of center'},
                ],
            },
        ])
    })
})

describe('placementIssues', () => {
    const asked: AskOptions[] = []
    const answering =
        (shots: {clash: boolean; why: string}[]) =>
        async <T>(options: AskOptions): Promise<T> => {
            asked.push(options)
            return {shots} as T
        }
    const cases = placementCases(shots, characters)

    test('a clash is a problem of its shot, with why and what to write instead', async () => {
        const issues = await placementIssues(cases, answering([{clash: true, why: 'Sera is right of centre, both others to her left.'}]))
        expect(issues).toHaveLength(1)
        expect(issues[0]!.shot).toBe(0)
        expect(issues[0]!.message).toContain('(Sera is right of centre, both others to her left)')
        expect(issues[0]!.message).toContain('draws one of them twice and leaves another out')
    })
    test('one call for the beat, thinking low; no clash, no problem; nothing to check asks nothing', async () => {
        asked.length = 0
        expect(await placementIssues(cases, answering([{clash: false, why: ''}]))).toEqual([])
        expect(asked).toHaveLength(1)
        expect(asked[0]!.reasoning).toBe('low')
        expect(asked[0]!.input).toContain("the person's own left and right")
        expect(await placementIssues([], answering([]))).toEqual([])
        expect(asked).toHaveLength(1)
    })
})
