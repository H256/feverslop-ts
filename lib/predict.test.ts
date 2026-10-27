import {describe, expect, test} from "bun:test";
import {cost, describePrediction, median, percentile, predictJob, predictJobs, predictLlmSeconds, resolutionPixels, sumTokens} from "./predict.ts";
import type {Timing} from "./timings.ts";

const clip = (seconds: number, extra: Partial<Timing> = {}): Timing => ({
    at: '', kind: 'clip', name: 'wan', seconds, variant: 'v1', workflowHash: 'h1', server: 'gpu1', frames: 22, pixels: 400_000, ...extra,
})
const job = {kind: 'clip' as const, name: 'wan', workflowHash: 'h1', frames: 22, resolution: 0.4}

test('median and p90', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([])).toBe(0)
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBeCloseTo(9.1)
})

test('resolutionPixels: megapixels, a size, or the workflow default', () => {
    expect(resolutionPixels(0.4)).toBe(400_000)
    expect(resolutionPixels('1280x720')).toBe(921_600)
    expect(resolutionPixels(-1)).toBeUndefined()
})

describe('predictJob', () => {
    test('the same variant, server and size: the median, measured', () => {
        const p = predictJob([clip(100), clip(200), clip(1000)], job, ['gpu1'])
        expect(p).toEqual({seconds: 200, basis: 'measured', samples: 3, servers: ['gpu1']})
    })
    test('cold starts, failed tries and other workflows are left out', () => {
        const p = predictJob([clip(100), clip(900, {cold: true}), clip(5, {outcome: 'failed'}), clip(5, {name: 'other'}), clip(5, {workflowHash: 'edited'})], job, ['gpu1'])
        expect(p.seconds).toBe(100)
    })
    test('another size is scaled by frames x pixels and marked as extrapolated', () => {
        const p = predictJob([clip(100)], {...job, frames: 44}, ['gpu1'])
        expect(p).toMatchObject({seconds: 200, basis: 'extrapolated'})
        const q = predictJob([clip(100)], {...job, resolution: 0.8}, ['gpu1'])
        expect(q).toMatchObject({seconds: 200, basis: 'extrapolated'})
    })
    test('an unknown variant (an edited workflow) gives no number', () => {
        expect(predictJob([clip(100)], {...job, workflowHash: 'edited'}, ['gpu1'])).toEqual({basis: 'none', samples: 0, servers: []})
        expect(predictJob([], job, ['gpu1']).seconds).toBeUndefined()
    })
    test('servers add up their throughput, a server without data does not count', () => {
        const timings = [clip(100), clip(100, {server: 'gpu2'})]
        expect(predictJob(timings, job, ['gpu1', 'gpu2', 'gpu3'])).toMatchObject({seconds: 50, servers: ['gpu1', 'gpu2']})
    })
    test('the size of the resolution setting, not of the graph: a two-pass workflow records its first pass (schwarzer-flur-261026-sing)', () => {
        const twoPass = clip(530, {frames: 209, pixels: 522_240, resolution: 2})
        expect(predictJob([twoPass], {...job, frames: 209, resolution: 2}, ['gpu1'])).toEqual({seconds: 530, basis: 'measured', samples: 1, servers: ['gpu1']})
        // was 3.8x too long when 2 MP were compared with the 960x544 of the graph
        expect(predictJob([twoPass], {...job, frames: 209, resolution: 1}, ['gpu1']).seconds).toBe(265)
    })
    test('a workflow default size (unknown pixels) is the size it had before', () => {
        expect(predictJob([clip(100)], {...job, resolution: -1}, ['gpu1'])).toMatchObject({seconds: 100, basis: 'measured'})
    })
})

describe('predictJobs', () => {
    test('the sum of what is missing; jobs without data are counted, not guessed', () => {
        const total = predictJobs([clip(100)], [job, job, {...job, name: 'unknown'}], ['gpu1'])
        expect(total).toMatchObject({seconds: 200, jobs: 3, known: 2, extrapolated: 0})
        expect(describePrediction('clip', total)).toBe('3 clips left: about 3m 20s (measured, median of up to 1 jobs on gpu1), 1 without data not counted')
    })
    test('no data at all says so', () => {
        expect(describePrediction('clip', predictJobs([], [job], ['gpu1']))).toBe('1 clip left: no data for this workflow variant yet, measured during this run')
    })
})

describe('LLM', () => {
    const call = (extra: Partial<Timing>): Timing => ({at: '', kind: 'llm', name: 'm', seconds: 1, ...extra})
    test('output length of the step ÷ tokens per second of the model', () => {
        const timings = [call({step: 'story', completionTokens: 1000, tokensPerSecond: 40}), call({step: 'story', completionTokens: 3000, tokensPerSecond: 60}), call({step: 'other', completionTokens: 9, tokensPerSecond: 50})]
        expect(predictLlmSeconds(timings, 'm', 'story')).toBe(2000 / 50)
    })
    test('no reported numbers, no prediction', () => {
        expect(predictLlmSeconds([call({step: 'story'})], 'm', 'story')).toBeUndefined()
    })
    test('token sums only count what was reported, per key; retries count, failures do not', () => {
        const timings = [
            call({step: 'a', project: 'p1', promptTokens: 10, completionTokens: 20, reasoningTokens: 5, cachedTokens: 2}),
            call({step: 'a', project: 'p2', promptTokens: 1, completionTokens: 2, outcome: 'retry'}),
            call({step: 'a', outcome: 'failed'}),
            call({step: 'b'}),
        ]
        const sums = sumTokens(timings, t => t.step ?? '')
        expect(sums.get('a')).toEqual({calls: 2, prompt: 11, completion: 22, reasoning: 5, cached: 2})
        expect(sums.get('b')).toEqual({calls: 1, prompt: 0, completion: 0, reasoning: 0, cached: 0})
    })
    test('cost needs a price', () => {
        const sum = {calls: 1, prompt: 1_000_000, completion: 500_000, reasoning: 0, cached: 0}
        expect(cost(sum, {inputPerMillion: 2, outputPerMillion: 4})).toBe(4)
        expect(cost(sum, undefined)).toBeUndefined()
    })
})
