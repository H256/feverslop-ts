import {expect, test} from 'bun:test';
import {buildReport, parseSince} from './stats-report.ts';
import {formatRows} from './stats.ts';
import {formatReport} from './stats-view.ts';
import type {Timing} from './timings.ts';

const now = Date.parse('2026-10-21T12:00:00Z')
const clip = (seconds: number, extra: Partial<Timing> = {}): Timing => ({at: '2026-10-21T10:00:00Z', kind: 'clip', project: 'demo', name: 'h3', seconds, variant: 'v1', gpu: 'A', frames: 121, pixels: 1000000, ...extra})

test('inclusive warm p90 retains the slow tail; benchmark metrics remain separate', () => {
    const report = buildReport([90, 100, 105, 110, 1000].map(s => clip(s)), {})
    expect(report.renders[0]).toMatchObject({n: 4, warmN: 5, median: 102.5, outliers: 1})
    expect(report.renders[0]!.warmP90).toBeCloseTo(644)
    expect(report.summary.successful).toBe(5)
})

test('filters apply to overview, token totals and every table', () => {
    const timings = [clip(10), clip(20, {project: 'other'}), clip(1, {at: '2026-10-01T00:00:00Z'}), clip(2, {kind: 'llm', promptTokens: 100, completionTokens: 10})]
    const report = buildReport(timings, {kind: 'clip', project: 'demo', since: now - 86400000})
    expect(report.summary.measurements).toBe(1)
    expect(report.llm).toEqual([])
    expect(report.tokens.model).toEqual([])
    expect(parseSince('7d', now)).toBe(now - 7 * 86400000)
    expect(() => parseSince('yesterday-ish', now)).toThrow()
})

test('costs cover only complete reported usage, retain currencies and do not double-count reasoning', () => {
    const timings = [
        clip(1, {kind: 'llm', name: 'm', promptTokens: 100, completionTokens: 20, reasoningTokens: 10}),
        clip(1, {kind: 'llm', name: 'm'}),
        clip(1, {kind: 'llm', name: 'm', promptTokens: 50}),
        clip(1, {kind: 'llm', name: 'n', promptTokens: 0, completionTokens: 0}),
        clip(1, {kind: 'llm', name: 'm', outcome: 'retry', promptTokens: 100, completionTokens: 20}),
    ]
    const report = buildReport(timings, {}, {m: {inputPerMillion: 1, outputPerMillion: 2, currency: 'EUR'}, n: {inputPerMillion: 1, outputPerMillion: 1, currency: 'USD'}})
    expect(report.summary.usage).toMatchObject({calls: 5, complete: 3, partial: 1, missing: 1, prompt: 250, completion: 40, reasoning: 10})
    expect(report.summary.costs).toEqual([{currency: 'EUR', amount: 0.00028, calls: 2}, {currency: 'USD', amount: 0, calls: 1}])
})

test('baseline is selected before top/sort; mixed workloads get no misleading percentage', () => {
    const timings = [clip(100), clip(50, {gpu: 'B'}), clip(25, {gpu: 'C', pixels: 2000000})]
    const report = buildReport(timings, {compare: true, baseline: 'A', sort: 'median', top: 1})
    expect(report.renders[0]).toMatchObject({key: 'h3 #v1 · A', changePercent: 0})
    const all = buildReport(timings, {compare: true, baseline: 'A'})
    expect(all.renders.find(r => r.key.endsWith('B'))?.changePercent).toBe(-50)
    expect(all.renders.find(r => r.key.endsWith('C'))?.changePercent).toBeUndefined()
    expect(() => buildReport(timings, {baseline: 'missing'})).toThrow('baseline')
})

test('queue and phases report coverage, not fabricated wall time', () => {
    const report = buildReport([clip(10, {queueSeconds: 0, phases: {sampling: 8}}), clip(12), clip(3, {outcome: 'failed'})], {})
    expect(report.summary.queue).toEqual({samples: 1, seconds: 0})
    expect(report.summary.phases).toEqual([{name: 'sampling', samples: 1, seconds: 8}])
    expect(report.summary).toMatchObject({successful: 2, failed: 1})
})

test('stats rows fit a narrow terminal and retain named latency metrics', () => {
    const report = buildReport([clip(42, {gpu: 'A very long GPU name'})], {})
    const text = formatRows('Render duration', report.renders, undefined, {width: 42})
    expect(text.split('\n').every(line => Bun.stringWidth(line) <= 42)).toBe(true)
    expect(text).toContain('p90 warm')
    expect(text).toContain('small sample')
})

test('the whole report fits narrow windows including detail tables', () => {
    const report = buildReport([clip(42, {gpu: 'A very long GPU name'}), clip(1, {kind: 'llm', name: 'long-model-name', promptTokens: 10, completionTokens: 5})], {})
    for (const width of [20, 42, 80, 120]) {
        expect(formatReport(report, {width, details: true}).split('\n').every(line => Bun.stringWidth(line) <= width)).toBe(true)
    }
})

test('automatic baselines skip cold-only groups and unknown workloads are not compared', () => {
    const report = buildReport([clip(400, {gpu: 'A', cold: true}), clip(100, {gpu: 'B'}), clip(50, {gpu: 'C'}), clip(20, {gpu: 'D', pixels: undefined})], {dimensions: ['gpu'], compare: true})
    expect(report.renders.find(r => r.key === 'C')).toMatchObject({baseline: 'B', changePercent: -50})
    expect(report.renders.find(r => r.key === 'D')?.changePercent).toBeUndefined()
})
