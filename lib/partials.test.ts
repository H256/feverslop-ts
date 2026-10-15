import {describe, expect, test} from "bun:test";
import {dropPartials, keepEach, type Partials} from "./partials.ts";

describe('keepEach', () => {
    const run = (data: { partials?: Partials }, key: string, input: unknown, calls: string[]) =>
        keepEach(data, async () => { calls.push('save') }, 'coverage', key, input, async () => { calls.push(`ask ${key}`); return `answer ${key}` })

    test('an answer is kept at once, and not asked again for the same input', async () => {
        const data: { partials?: Partials } = {}
        const calls: string[] = []
        expect(await run(data, 's1', {prompt: 'a'}, calls)).toBe('answer s1')
        expect(await run(data, 's1', {prompt: 'a'}, calls)).toBe('answer s1')
        expect(calls).toEqual(['ask s1', 'save'])
    })
    test('a run that fails on the third element leaves the first two, the next run asks only for the rest', async () => {
        const data: { partials?: Partials } = {}
        const asked: string[] = []
        const step = async (fail: boolean) => {
            for (const key of ['s1', 's2', 's3', 's4', 's5']) {
                await keepEach(data, async () => {}, 'coverage', key, {key}, async () => {
                    asked.push(key)
                    if (fail && key === 's3') throw new Error('boom')
                    return key
                })
            }
        }
        await expect(step(true)).rejects.toThrow('boom')
        expect(Object.keys(data.partials!.coverage!)).toEqual(['s1', 's2'])
        asked.length = 0
        await step(false)
        expect(asked).toEqual(['s3', 's4', 's5'])
    })
    test('an element asked differently is asked again', async () => {
        const data: { partials?: Partials } = {}
        const calls: string[] = []
        await run(data, 's1', {prompt: 'a'}, calls)
        await run(data, 's1', {prompt: 'b'}, calls)
        expect(calls.filter(c => c.startsWith('ask'))).toHaveLength(2)
    })
    test('dropping a step leaves nothing behind', async () => {
        const data: { partials?: Partials } = {}
        await run(data, 's1', {}, [])
        dropPartials(data, 'coverage')
        expect(data.partials).toBeUndefined()
    })
})
