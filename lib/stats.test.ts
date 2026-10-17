import {expect, test} from "bun:test";
import {bar, by, formatRows, groupRows, percentChange} from "./stats.ts";
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

test('a bar is as long as the share of the slowest, with eighth blocks, and always the same width', () => {
    expect(bar(1, 4)).toBe('████')
    expect(bar(0.5, 4)).toBe('██  ')
    expect(bar(0.375, 4)).toBe('█▌  ')
    expect(bar(0, 4)).toBe('    ')
    expect(bar(2, 4)).toBe('████')
})
