import {describe, expect, test} from 'bun:test'
import type {AskOptions} from './llm.ts'
import {countPeople, describeCounts, notOnce} from './startframe-check.ts'

const people = [
    {id: 'maren', name: 'Maren', reference: 'data:maren'},
    {id: 'sera', name: 'Sera', reference: 'data:sera'},
    {id: 'vex', name: 'Vex', reference: 'data:vex'},
]
const answering =
    (figures: string[], asked: AskOptions[] = []) =>
    async <T>(options: AskOptions): Promise<T> => {
        asked.push(options)
        return {figures} as T
    }

// tides-261115 slot-033 shot 1: Sera drawn twice in a wide shot - asked for counts, the model said 1; naming each figure, 2
describe('countPeople', () => {
    test('the model names each figure left to right, the code counts them', async () => {
        const counts = await countPeople('data:picture', people, answering(['Maren', 'Sera', 'other', 'Sera']))
        expect(counts.map(c => c.count)).toEqual([1, 2, 0])
        expect(describeCounts(notOnce(counts))).toBe('Sera is in it 2 times, Vex is missing')
    })
    test('one call with the picture first and a reference per person; nobody to check asks nothing', async () => {
        const asked: AskOptions[] = []
        await countPeople('data:picture', people, answering(['Maren', 'Sera', 'Vex'], asked))
        expect(asked).toHaveLength(1)
        expect(asked[0]!.images).toEqual(['data:picture', 'data:maren', 'data:sera', 'data:vex'])
        expect(asked[0]!.input).toContain('image 2 Maren, image 3 Sera, image 4 Vex')
        expect(await countPeople('data:picture', [], answering([], asked))).toEqual([])
        expect(asked).toHaveLength(1)
    })
})
