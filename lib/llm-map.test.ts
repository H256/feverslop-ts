import {afterAll, describe, expect, test} from "bun:test";
import {configureLlm, llmMap} from "./llm.ts";

afterAll(() => configureLlm({}))

// counts how many runs are inside run() at the same moment
async function peak(parallel: number | undefined, items: number) {
    configureLlm({parallel})
    let running = 0
    let most = 0
    const results = await llmMap(Array.from({length: items}, (_, i) => i), async (item) => {
        most = Math.max(most, ++running)
        await Bun.sleep(5)
        running--
        return item * 10
    })
    return {most, results}
}

describe('llmMap', () => {
    test('one at a time by default', async () => {
        expect((await peak(undefined, 4)).most).toBe(1)
    })
    test('at most llm.parallel at once, the results in the order of the items', async () => {
        const {most, results} = await peak(3, 7)
        expect(most).toBe(3)
        expect(results).toEqual([0, 10, 20, 30, 40, 50, 60])
    })
    test('no more workers than items', async () => {
        expect((await peak(8, 2)).most).toBe(2)
    })
})
