import {by, byAll, groupRows, percentChange, referenceOf, type Dimension, type Row} from './stats.ts';
import {cost, type Price, type TokenSums} from './predict.ts';
import type {Timing} from './timings.ts';

export const kinds = ['clip', 'picture', 'song', 'interpolation', 'llm'] as const
export const sorts = ['name', 'median', 'p90', 'n', 'failed'] as const
export type ReportOptions = {
    dimensions?: Dimension[], kind?: Timing['kind'], project?: string, since?: number,
    sort?: typeof sorts[number], top?: number, compare?: boolean, baseline?: string,
}
const validNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0

/** Relative windows use the caller's clock; absolute dates must be ISO, never locale-dependent. */
export function parseSince(value: string, now = Date.now()) {
    const relative = /^(\d+(?:\.\d+)?)(h|d|w)$/.exec(value)
    if (relative) {
        const duration = Number(relative[1]) * ({h: 3600000, d: 86400000, w: 604800000}[relative[2]!]!)
        if (duration > 0 && Number.isFinite(duration)) return now - duration
    }
    if (/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) {
        const timestamp = Date.parse(value)
        const date = value.slice(0, 10)
        if (Number.isFinite(timestamp) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date) return timestamp
    }
    throw new Error('--since: use a positive window such as 24h, 7d or 2w, or an ISO date/time with timezone')
}

type Usage = TokenSums & {complete: number, partial: number, missing: number}
const emptyUsage = (): Usage => ({calls: 0, complete: 0, partial: 0, missing: 0, prompt: 0, completion: 0, reasoning: 0, cached: 0})
function addUsage(sum: Usage, t: Timing) {
    sum.calls++
    const input = validNumber(t.promptTokens), output = validNumber(t.completionTokens)
    if (input && output) sum.complete++
    else if (input || output) sum.partial++
    else sum.missing++
    if (input) sum.prompt += t.promptTokens!
    if (output) sum.completion += t.completionTokens!
    if (validNumber(t.reasoningTokens)) sum.reasoning += t.reasoningTokens
    if (validNumber(t.cachedTokens)) sum.cached += t.cachedTokens
}

export function buildReport(source: Timing[], options: ReportOptions, prices: Record<string, Price> = {}) {
    const dimensions = options.dimensions ?? ['variant', 'gpu']
    if (!dimensions.length || dimensions.some(d => !Object.hasOwn(by, d) || d === 'model' || d === 'step')) throw new Error('--by: use workflow, variant, resolution, server or gpu')
    if (options.kind && !kinds.includes(options.kind)) throw new Error('--kind: use ' + kinds.join(', '))
    if (options.sort && !sorts.includes(options.sort)) throw new Error('--sort: use ' + sorts.join(', '))
    if (options.top !== undefined && (!Number.isSafeInteger(options.top) || options.top < 1)) throw new Error('--top: use a positive integer')
    const timings = source.filter(t => (!options.kind || t.kind === options.kind) && (!options.project || t.project === options.project)
        && (options.since === undefined || Date.parse(t.at) >= options.since))
    const valid = timings.filter(t => validNumber(t.seconds))
    const llmCalls = valid.filter(t => t.kind === 'llm')
    const renders = valid.filter(t => t.kind !== 'llm')
    const usage = emptyUsage()
    const costs = new Map<string, {currency: string, amount: number, calls: number}>()
    const tokens: Record<'model' | 'step' | 'project', Map<string, Usage>> = {model: new Map(), step: new Map(), project: new Map()}
    for (const t of llmCalls) {
        addUsage(usage, t)
        for (const [kind, key] of [['model', t.name], ['step', t.step ?? 'unknown step'], ['project', t.project ?? 'unknown project']] as const) {
            const sum = tokens[kind].get(key) ?? emptyUsage()
            addUsage(sum, t)
            tokens[kind].set(key, sum)
        }
        const price = prices[t.name]
        if (price && validNumber(price.inputPerMillion) && validNumber(price.outputPerMillion) && validNumber(t.promptTokens) && validNumber(t.completionTokens)) {
            const currency = price.currency || 'unspecified currency'
            const sum = costs.get(currency) ?? {currency, amount: 0, calls: 0}
            sum.amount += cost({calls: 1, prompt: t.promptTokens, completion: t.completionTokens, reasoning: 0, cached: 0}, price)!
            sum.calls++
            costs.set(currency, sum)
        }
    }
    const successfulRenders = renders.filter(t => !t.outcome)
    const queue = {samples: 0, seconds: 0}
    const phases = new Map<string, {name: string, samples: number, seconds: number}>()
    for (const t of successfulRenders) {
        if (validNumber(t.queueSeconds)) { queue.samples++; queue.seconds += t.queueSeconds }
        for (const [name, seconds] of Object.entries(t.phases ?? {})) if (validNumber(seconds)) {
            const phase = phases.get(name) ?? {name, samples: 0, seconds: 0}
            phase.samples++; phase.seconds += seconds
            phases.set(name, phase)
        }
    }
    const renderRows = groupRows(renders, byAll(dimensions))
    const llmRows = groupRows(llmCalls, by.model)
    const baselineRows = options.kind === 'llm' ? llmRows : renderRows
    const matches = (r: Row) => r.key === options.baseline || r.key.split(' · ').at(-1) === options.baseline
    if (options.baseline && !baselineRows.some(matches)) throw new Error(`--baseline: no group matches "${options.baseline}" in the selected measurements`)
    const select = (rows: Row[], dims: number, explicit: boolean) => {
        const reference = referenceOf(rows, dims)
        const annotated = rows.map(row => {
            if (!options.compare && !options.baseline) return row
            const first = explicit && options.baseline
                ? rows.find(r => matches(r) && (dims < 2 || r.key.split(' · ')[0] === row.key.split(' · ')[0]))
                : reference(row)
            const comparable = first && !row.unknownWorkload && !first.unknownWorkload && row.workloads.length === 1
                && first.workloads.length === 1 && row.workloads[0] === first.workloads[0]
            return {...row, baseline: first?.key, changePercent: comparable ? percentChange(first, row) : undefined,
                comparison: !first ? 'no baseline in this group' : !first.n || !row.n ? 'no warm benchmark samples' : !comparable ? 'not comparable' : undefined}
        })
        const sort = options.sort ?? 'name'
        annotated.sort((a, b) => sort === 'name' ? a.key.localeCompare(b.key)
            : (sort === 'p90' ? b.warmP90 - a.warmP90 : b[sort] - a[sort]) || a.key.localeCompare(b.key))
        return annotated.slice(0, options.top ?? annotated.length)
    }
    return {
        filters: {...options, dimensions},
        summary: {
            measurements: timings.length, invalidDurations: timings.length - valid.length,
            projects: new Set(valid.flatMap(t => t.project ? [t.project] : [])).size,
            unknownProject: valid.filter(t => !t.project).length,
            successful: valid.filter(t => !t.outcome).length, successfulRenders: successfulRenders.length,
            failed: valid.filter(t => t.outcome === 'failed').length,
            retries: valid.filter(t => t.outcome === 'retry').length, again: valid.filter(t => t.outcome === 'again').length,
            summedJobSeconds: valid.reduce((sum, t) => sum + t.seconds, 0),
            usage, costs: [...costs.values()].sort((a, b) => a.currency.localeCompare(b.currency)), queue,
            phases: [...phases.values()].sort((a, b) => b.seconds - a.seconds),
        },
        renders: select(renderRows, dimensions.length, options.kind !== 'llm'),
        llm: select(llmRows, 1, options.kind === 'llm'),
        groups: {renders: renderRows.length, llm: llmRows.length},
        tokens: Object.fromEntries(Object.entries(tokens).map(([kind, rows]) => [kind, [...rows].sort(([a], [b]) => a.localeCompare(b)).map(([key, sum]) => ({key, ...sum}))])) as Record<'model' | 'step' | 'project', (Usage & {key: string})[]>,
    }
}

export type StatsReport = ReturnType<typeof buildReport>
