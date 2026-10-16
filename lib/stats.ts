import {formatDuration} from "./log.ts";
import {median, percentile} from "./predict.ts";
import type {Timing} from "./timings.ts";

export type Row = { key: string, n: number, median: number, p90: number, cold: number, outliers: number, retries: number, failed: number }

// a warm run that took more than this many times the median is an outlier (something else used the GPU, a swap, …)
const OUTLIER_FACTOR = 2
const MIN_FOR_OUTLIERS = 4

/**
 * Groups the successful jobs: n, median and p90 of the warm, normal ones - cold starts (first job after a model
 * change) and outliers are counted apart and stay out of the numbers; retries and failures are counted per group.
 */
export function groupRows(timings: Timing[], key: (t: Timing) => string | undefined): Row[] {
    const groups = new Map<string, Timing[]>()
    for (const t of timings) {
        const k = key(t)
        if (k !== undefined) groups.set(k, [...groups.get(k) ?? [], t])
    }
    return [...groups].map(([k, all]) => {
        const done = all.filter(t => !t.outcome)
        const warm = done.filter(t => !t.cold).map(t => t.seconds)
        const m = median(warm)
        const outliers = warm.length >= MIN_FOR_OUTLIERS ? warm.filter(s => s > m * OUTLIER_FACTOR).length : 0
        const normal = warm.length >= MIN_FOR_OUTLIERS ? warm.filter(s => s <= m * OUTLIER_FACTOR) : warm
        return {
            key: k, n: normal.length, median: median(normal), p90: percentile(normal, 0.9), cold: done.length - warm.length, outliers,
            retries: all.filter(t => t.outcome === 'retry' || t.outcome === 'again').length, failed: all.filter(t => t.outcome === 'failed').length,
        }
    }).sort((a, b) => a.key.localeCompare(b.key))
}

/** B against A in percent of A's median: +12% = B is slower. undefined when one of them has no numbers. */
export function percentChange(a: Row, b: Row) {
    return a.n && b.n && a.median > 0 ? Math.round((b.median - a.median) / a.median * 100) : undefined
}

export const by = {
    workflow: (t: Timing) => t.kind === 'llm' ? undefined : t.name,
    variant: (t: Timing) => t.kind === 'llm' ? undefined : `${t.name} #${t.variant ?? 'unknown'}`,
    resolution: (t: Timing) => t.kind === 'llm' ? undefined : `${t.name} ${t.variant ? `#${t.variant} ` : ''}${t.frames && t.frames > 1 ? `${t.frames} frames ` : ''}${t.pixels ? `${(t.pixels / 1e6).toFixed(2)} MP` : String(t.resolution ?? '?')}`,
    server: (t: Timing) => t.kind === 'llm' ? undefined : t.server ? `${t.server}${t.gpu ? ` (${t.gpu})` : ''}` : 'unknown server',
    model: (t: Timing) => t.kind === 'llm' ? t.name : undefined,
    step: (t: Timing) => t.kind === 'llm' ? t.step ?? 'unknown step' : undefined,
} satisfies Record<string, (t: Timing) => string | undefined>

export function formatRows(title: string, rows: Row[], reference?: Row) {
    if (!rows.length) return ''
    const width = Math.max(...rows.map(r => r.key.length), 5)
    const lines = [title, `  ${'group'.padEnd(width)}  ${'n'.padStart(4)}  ${'median'.padStart(8)}  ${'p90'.padStart(8)}  apart${reference ? '  vs first' : ''}`]
    for (const r of rows) {
        const apart = [r.cold && `${r.cold} cold`, r.outliers && `${r.outliers} outlier`, r.retries && `${r.retries} retry`, r.failed && `${r.failed} failed`].filter(Boolean).join(', ')
        const change = reference && r !== reference ? percentChange(reference, r) : undefined
        lines.push(`  ${r.key.padEnd(width)}  ${String(r.n).padStart(4)}  ${(r.n ? formatDuration(r.median * 1000) : '-').padStart(8)}  ${(r.n ? formatDuration(r.p90 * 1000) : '-').padStart(8)}  ${apart || '-'}${reference ? `  ${change === undefined ? '' : `${change > 0 ? '+' : ''}${change}%`}` : ''}`)
    }
    return lines.join('\n')
}
