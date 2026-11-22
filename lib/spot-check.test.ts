import {describe, expect, test} from 'bun:test'
import type {AskOptions} from './llm.ts'
import type {ShotPlan} from './project.ts'
import {spotCases, spotIssues} from './spot-check.ts'

// tides-261115 slot-033: Sera "in the centre of the stage" like Maren - each start picture put her somewhere else
const characters = [
    {id: 'maren', name: 'Maren'},
    {id: 'sera', name: 'Sera'},
    {id: 'vex', name: 'Vex', propCarried: false as const},
    {id: 'crowd', name: 'The audience', isGroup: true},
]
const set = {
    stage: 'In front of the throne wall.',
    spots: {
        maren: 'At the front of the stage, before the mist column.',
        sera: 'On the basalt-wall side of the stage.',
        vex: 'The kit stands at the throne wall.',
        crowd: 'In the nave in front of the stage.',
    },
}
const shots: ShotPlan[] = [
    {
        action: 'a',
        characters: ['maren', 'sera', 'vex', 'crowd'],
        people: {
            maren: {state: 'at the front of the stage, singing'},
            sera: {state: 'in the centre of the stage, playing'},
            vex: {state: 'at the kit'},
            crowd: {state: 'facing the band'},
        },
    },
    // no state, or not in the shot: nothing to check
    {action: 'b', characters: ['maren'], people: {maren: {}, sera: {state: 'on the basalt-wall side'}}},
]

describe('spotCases', () => {
    test('who moves freely and has a spot, with the words of the shot - not a standing kit, not a crowd, not without a set', () => {
        expect(spotCases(shots, characters, set)).toEqual([
            {shot: 0, name: 'Maren', spot: set.spots.maren, state: 'at the front of the stage, singing'},
            {shot: 0, name: 'Sera', spot: set.spots.sera, state: 'in the centre of the stage, playing'},
        ])
        expect(spotCases(shots, characters, undefined)).toEqual([])
        expect(spotCases(shots, characters, {stage: 'x', spots: {}})).toEqual([])
    })
})

describe('spotIssues', () => {
    const asked: AskOptions[] = []
    const answering =
        (kept: boolean[]) =>
        async <T>(options: AskOptions): Promise<T> => {
            asked.push(options)
            return {kept} as T
        }
    const cases = spotCases(shots, characters, set)

    test('a "no" is a problem of its shot, naming the place and what to do', async () => {
        const issues = await spotIssues(cases, [], answering([true, false]))
        expect(issues).toEqual([expect.objectContaining({shot: 0})])
        expect(issues[0]!.message).toContain('Sera is put elsewhere ("in the centre of the stage, playing")')
        expect(issues[0]!.message).toContain('"On the basalt-wall side of the stage."')
        expect(await spotIssues(cases, [], answering([true, true]))).toEqual([])
    })
    test('one call for the beat, thinking off, with the moments that may move somebody; nothing to check asks nothing', async () => {
        asked.length = 0
        await spotIssues(cases, ['Maren walks down into the crowd'], answering([true, true]))
        expect(asked).toHaveLength(1)
        expect(asked[0]!.reasoning).toBe('none')
        expect(asked[0]!.input).toContain('- Maren walks down into the crowd')
        expect(await spotIssues([], [], answering([]))).toEqual([])
        expect(asked).toHaveLength(1)
    })
})
