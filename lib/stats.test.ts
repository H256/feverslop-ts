import {expect, test} from "bun:test";
import {bar, by, byAll, formatRows, groupRows, percentChange, referenceOf} from "./stats.ts";
import type {Timing} from "./timings.ts";

const clip = (seconds: number, extra: Partial<Timing> = {}): Timing => ({at: '', kind: 'clip', name: 'wan', seconds, variant: 'v1', server: 'gpu1', ...extra})

test('median and p90 of the warm jobs; cold starts, outliers, retries and failures are counted apart', () => {
    const rows = groupRows([clip(100), clip(110), clip(90), clip(105), clip(1000), clip(400, {cold: true}), clip(0, {outcome: 'retry'}), clip(3, {outcome: 'failed'})], by.variant)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({key: 'wan #v1', n: 4, median: 102.5, cold: 1, outliers: 1, retries: 1, failed: 1})
})

test('groups by variant and leaves LLM calls out of the render tables', () => {
    const rows = groupRows([clip(100), clip(50, {variant: 'v2'}), {at: '', kind: 'llm', name: 'm', seconds: 3}], by.variant)
    expect(rows.map(r => r.key)).toEqual(['wan #v1', 'wan #v2'])
})

test('A against B in percent', () => {
    const [a, b] = groupRows([clip(100), clip(150, {variant: 'v2'})], by.variant)
    expect(percentChange(a!, b!)).toBe(50)
    expect(percentChange(b!, a!)).toBe(-33)
})

test('the table shows the change against the first row', () => {
    const rows = groupRows([clip(100), clip(150, {variant: 'v2'})], by.variant)
    expect(formatRows('Renders', rows, rows[0])).toContain('+50%')
    expect(formatRows('Renders', [])).toBe('')
})

test('by variant and gpu: a row per card, each compared with the first card of the same variant', () => {
    const nvidia = {gpu: 'NVIDIA GeForce RTX 5090', server: 'a'}, amd = {gpu: 'AMD Radeon AI PRO R9700', server: 'b'}
    const rows = groupRows([clip(100, nvidia), clip(300, amd), clip(50, {...nvidia, variant: 'v2'}), clip(100, {...amd, variant: 'v2'}), clip(60, {variant: 'v2', gpu: undefined, server: 'old'})], byAll(['variant', 'gpu']))
    expect(rows.map(r => r.key)).toEqual(['wan #v1 · AMD Radeon AI PRO R9700', 'wan #v1 · NVIDIA GeForce RTX 5090', 'wan #v2 · AMD Radeon AI PRO R9700', 'wan #v2 · NVIDIA GeForce RTX 5090', 'wan #v2 · old'])
    const reference = referenceOf(rows, 2)
    expect(rows.map(r => percentChange(reference(r)!, r))).toEqual([0, -67, 0, -50, -40])
    expect(formatRows('Renders', rows, reference)).toContain('-67%')
    expect(byAll(['variant', 'gpu'])({at: '', kind: 'llm', name: 'm', seconds: 1})).toBeUndefined()
    // a card with only a cold start has no numbers: the first card with warm jobs is the reference
    const [cold, warm] = groupRows([clip(400, {...amd, cold: true}), clip(100, nvidia)], byAll(['variant', 'gpu']))
    expect(referenceOf([cold!, warm!], 2)(cold!)).toBe(warm)
})

test('a bar is as long as the share of the slowest, with eighth blocks, and always the same width', () => {
    expect(bar(1, 4)).toBe('████')
    expect(bar(0.5, 4)).toBe('██  ')
    expect(bar(0.375, 4)).toBe('█▌  ')
    expect(bar(0, 4)).toBe('    ')
    expect(bar(2, 4)).toBe('████')
})
