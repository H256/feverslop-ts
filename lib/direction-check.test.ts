import {describe, expect, test} from 'bun:test'
import {directionCases, directionIssues} from './direction-check.ts'
import type {AskOptions} from './llm.ts'
import type {ShotPlan} from './project.ts'

// tides-261115 slot-028: the singer "presses her weight forward" on a stage seen over a crowd - drawn walking into the crowd
const characters = [
    {id: 'maren', name: 'Maren'},
    {id: 'vex', name: 'Vex'},
]
const shots: ShotPlan[] = [
    {
        action: 'x',
        view: 'from behind The audience, over their heads toward the stage',
        camera: 'slow push in',
        people: {
            maren: {state: 'on the stage, arms raised', frame: 'small, center', motion: 'presses her body fully forward'},
            vex: {state: 'at the coral drum kit', motion: 'the arms drive the sticks'},
        },
    },
    // nobody said to stand or move anywhere: nothing to check
    {action: 'y', people: {maren: {frame: 'center'}}},
    {action: 'z'},
]

describe('directionCases', () => {
    test('a shot with somebody who stands or moves somewhere, with the camera and their words', () => {
        expect(directionCases(shots, characters)).toEqual([
            {
                shot: 0,
                view: 'from behind The audience, over their heads toward the stage; slow push in',
                people: [
                    {name: 'Maren', state: 'on the stage, arms raised', frame: 'small, center', motion: 'presses her body fully forward'},
                    {name: 'Vex', state: 'at the coral drum kit', frame: '', motion: 'the arms drive the sticks'},
                ],
            },
        ])
    })
})

describe('directionIssues', () => {
    const asked: AskOptions[] = []
    const answering =
        (shots: {unclear: boolean; who: string; why: string}[]) =>
        async <T>(options: AskOptions): Promise<T> => {
            asked.push(options)
            return {shots} as T
        }
    const cases = directionCases(shots, characters)

    test('an unclear direction is a problem of its shot, with who, the words and what to write instead', async () => {
        const issues = await directionIssues(cases, answering([{unclear: true, who: 'Maren', why: 'presses her body fully forward.'}]))
        expect(issues).toHaveLength(1)
        expect(issues[0]!.shot).toBe(0)
        expect(issues[0]!.message).toContain('Maren leans, presses or steps without a target ("presses her body fully forward")')
        expect(issues[0]!.message).toContain('say toward whom or what')
    })
    test('one call for the beat, thinking low; a clear direction is no problem; nothing to check asks nothing', async () => {
        asked.length = 0
        expect(await directionIssues(cases, answering([{unclear: false, who: '', why: ''}]))).toEqual([])
        expect(asked).toHaveLength(1)
        expect(asked[0]!.reasoning).toBe('low')
        expect(asked[0]!.input).toContain('when only hair, head, hands or arms move')
        expect(await directionIssues([], answering([]))).toEqual([])
        expect(asked).toHaveLength(1)
    })
})
