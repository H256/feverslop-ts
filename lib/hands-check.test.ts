import {describe, expect, test} from 'bun:test'
import {handsCases, handsIssues} from './hands-check.ts'
import type {AskOptions} from './llm.ts'
import type {ShotPlan} from './project.ts'

// stille-im-spiegel 037: "left hand on Elias' shoulder, guitar in right hand" - Julian drawn twice
const characters = [
    {id: 'julian', name: 'Julian', prop: 'electric guitar'},
    {id: 'mateo', name: 'Mateo', prop: 'drum kit', propCarried: false as const},
    {id: 'elias', name: 'Elias'},
]
const shots: ShotPlan[] = [
    {
        action: 'x',
        people: {
            julian: {state: "left hand on Elias' shoulder, guitar in right hand", motion: 'leans in'},
            mateo: {state: 'at his kit, one hand raised to Elias'},
            elias: {state: 'at the piano, a hand on the keys'},
        },
    },
    {action: 'y', people: {julian: {plays: 'a slow strum'}}},
]

describe('handsCases', () => {
    test('everybody who carries their prop, with all their entry says - not a prop that stands in a place, not who has none', () => {
        expect(handsCases(shots, characters)).toEqual([
            {shot: 0, name: 'Julian', prop: 'electric guitar', text: "left hand on Elias' shoulder, guitar in right hand; leans in"},
            {shot: 1, name: 'Julian', prop: 'electric guitar', text: 'a slow strum'},
        ])
    })
})

describe('handsIssues', () => {
    const asked: AskOptions[] = []
    const answering =
        (twice: boolean[]) =>
        async <T>(options: AskOptions): Promise<T> => {
            asked.push(options)
            return {twice} as T
        }
    const cases = handsCases(shots, characters)

    test('a "yes" is a problem of its shot, with what to write instead', async () => {
        const issues = await handsIssues(cases, answering([true, false]))
        expect(issues).toHaveLength(1)
        expect(issues[0]!.shot).toBe(0)
        expect(issues[0]!.message).toContain('the video model draws Julian twice')
        expect(issues[0]!.message).toContain('hung on its strap, slung on the back or set down')
    })
    test('one call for the beat, thinking off; nothing to check asks nothing', async () => {
        asked.length = 0
        await handsIssues(cases, answering([false, false]))
        expect(asked).toHaveLength(1)
        expect(asked[0]!.reasoning).toBe('none')
        expect(await handsIssues([], answering([]))).toEqual([])
        expect(asked).toHaveLength(1)
    })
})
