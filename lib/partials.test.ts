import {describe, expect, test} from "bun:test";
import {dropPartials, keepEach, keepFound, type Partials} from "./partials.ts";

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

describe('keepFound - the shot planning, one beat at a time (#340)', () => {
    const beats = ['beat-01', 'beat-02', 'beat-03', 'beat-04']
    // a planner that plans every beat it is asked for, except the ones whose answers stay unusable (no plan); the computer
    // goes off before the beat `stopAt`
    const plan = async (data: { partials?: Partials }, asked: string[], {stopAt, unusable = [], question = {}}: { stopAt?: string, unusable?: string[], question?: Record<string, string> } = {}) => {
        const plans: Record<string, string | undefined> = {}
        for (const beat of beats) {
            plans[beat] = await keepFound(data, async () => {}, 'shotMoments', beat, {question: question[beat] ?? `shots of ${beat}`}, async () => {
                if (beat === stopAt) throw new Error('stopped')
                asked.push(beat)
                return unusable.includes(beat) ? undefined : `plan of ${beat}`
            })
        }
        return plans
    }

    test('a stopped planning goes on from the beats it had planned - only the rest is asked', async () => {
        const data: { partials?: Partials } = {}
        const first: string[] = []
        await expect(plan(data, first, {stopAt: 'beat-03'})).rejects.toThrow('stopped')
        expect(first).toEqual(['beat-01', 'beat-02'])
        const second: string[] = []
        expect(await plan(data, second)).toEqual({'beat-01': 'plan of beat-01', 'beat-02': 'plan of beat-02', 'beat-03': 'plan of beat-03', 'beat-04': 'plan of beat-04'})
        expect(second).toEqual(['beat-03', 'beat-04'])
    })
    test('a beat that ended without a plan is not kept - the next run asks for it again', async () => {
        const data: { partials?: Partials } = {}
        expect((await plan(data, [], {unusable: ['beat-03']}))['beat-03']).toBeUndefined()
        const second: string[] = []
        expect((await plan(data, second))['beat-03']).toBe('plan of beat-03')
        expect(second).toEqual(['beat-03'])
    })
    test('a beat asked differently (another blocking, another film look) is planned again', async () => {
        const data: { partials?: Partials } = {}
        await plan(data, [])
        const second: string[] = []
        await plan(data, second, {question: {'beat-02': 'shots of beat-02, closer'}})
        expect(second).toEqual(['beat-02'])
    })
})
