import {fitLine, formatDuration, styles} from "./log.ts";
import {median, percentile} from "./predict.ts";
import type {Timing} from "./timings.ts";

export type Row = {
    key: string, n: number, median: number, p90: number, cold: number, outliers: number, retries: number, failed: number,
    warmN: number, warmP90: number, workloads: string[], unknownWorkload: boolean,
    baseline?: string, changePercent?: number, comparison?: string,
}

// a warm run that took more than this many times the median is an outlier (something else used the GPU, a swap, …)
const OUTLIER_FACTOR = 2
const MIN_FOR_OUTLIERS = 4

/**
 * Groups the successful jobs: n, median and p90 of the warm, normal ones - cold starts (first job after a model
 * change) and outliers are counted apart. warmN/warmP90 include warm outliers; retries and failures are counted per group.
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
            warmN: warm.length, warmP90: percentile(warm, 0.9),
            workloads: [...new Set(done.map(t => JSON.stringify([t.kind, t.name, t.variant, t.workflowHash, t.frames, t.pixels ?? t.resolution, t.endpoint])))],
            unknownWorkload: done.some(t => t.kind !== 'llm' && (!t.variant || !t.pixels || (t.kind === 'clip' && !t.frames))),
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
    // the card a job ran on - two servers with the same card are one row; a server that did not report it by its name
    gpu: (t: Timing) => t.kind === 'llm' ? undefined : t.gpu ?? t.server ?? 'unknown gpu',
    model: (t: Timing) => t.kind === 'llm' ? t.name : undefined,
    step: (t: Timing) => t.kind === 'llm' ? t.step ?? 'unknown step' : undefined,
} satisfies Record<string, (t: Timing) => string | undefined>

export type Dimension = keyof typeof by
const JOIN = ' · '

/** A key of several dimensions ("variant,gpu"): a row per combination, the parts joined - none when one part has none. */
export function byAll(dimensions: Dimension[]) {
    return (t: Timing) => {
        const parts = dimensions.map(d => by[d](t))
        return parts.some(p => p === undefined) ? undefined : parts.join(JOIN)
    }
}

/**
 * The reference row for --compare: grouped by one dimension the first row with samples; by several, the first row with
 * the same first part that has numbers - so with "variant,gpu" every card is compared with the first card of the same
 * variant that has warm jobs.
 */
export function referenceOf(rows: Row[], dimensions: number): (row: Row) => Row | undefined {
    if (dimensions < 2) return () => rows.find(r => r.n > 0)
    const head = (r: Row) => r.key.split(JOIN)[0]
    return row => rows.find(r => r.n > 0 && head(r) === head(row))
}

const BAR_WIDTH = 14
const EIGHTHS = ' ▏▎▍▌▋▊▉█'

/** A bar of `fraction` (0-1) of BAR_WIDTH cells, with eighth blocks for the remainder. */
export function bar(fraction: number, width = BAR_WIDTH) {
    const eighths = Math.round(Math.min(Math.max(fraction, 0), 1) * width * 8)
    const full = Math.floor(eighths / 8)
    return ('█'.repeat(full) + (eighths % 8 ? EIGHTHS[eighths % 8] : '')).padEnd(width)
}

/**
 * One table of a stats group: a bar per row for the median (the slowest median is a full bar), colours for the change
 * against the reference (green = faster, yellow = slower) and for what is counted apart. The widths are taken from the
 * plain text, so the colours never shift a column.
 */
export function formatRows(title: string, rows: Row[], reference?: Row | ((row: Row) => Row | undefined), options: {width?: number, details?: boolean} = {}) {
    if (!rows.length) return ''
    const terminalWidth = Math.max(1, options.width ?? process.stdout.columns ?? 100)
    const labelWidth = Math.max(5, ...rows.map(r => Bun.stringWidth(r.key)))
    const compact = labelWidth + 71 > terminalWidth
    const against = typeof reference === 'function' ? reference : () => reference
    const slowest = Math.max(...rows.map(r => r.median), 0)
    const lines = [styles.name(fitLine(title, terminalWidth)), fitLine('Benchmark median · warm p90 includes slow jobs', terminalWidth)]
    if (!compact) lines.push(styles.muted(`${'group'.padEnd(labelWidth)}  ${'n'.padStart(4)}  ${'median'.padStart(8)}  ${'p90 warm'.padStart(8)}  ${'warm n'.padStart(6)}  duration (shorter = faster)`))
    for (const r of rows) {
        const base = against(r)
        const change = r.changePercent ?? (base && r !== base ? percentChange(base, r) : undefined)
        const delta = change === undefined ? '' : (change < 0 ? styles.answer : change > 0 ? styles.warning : styles.muted)(`${change > 0 ? '+' : ''}${change}%`)
        const duration = r.n ? formatDuration(r.median * 1000) : '—'
        const tail = r.warmN ? formatDuration(r.warmP90 * 1000) : '—'
        const apart = [r.cold && `${r.cold} cold`, r.outliers && `${r.outliers} outlier`, r.retries && `${r.retries} retry/again`, r.failed && `${r.failed} failed`, r.n < 5 && 'small sample', r.workloads.length > 1 && 'mixed workloads', r.unknownWorkload && 'unknown workload', r.comparison].filter(Boolean).join(' · ')
        if (compact) {
            lines.push(styles.name(fitLine(r.key, terminalWidth)))
            lines.push(`  median ${duration} · n=${r.n}${delta ? ` · ${delta}` : ''}`, `  p90 warm ${tail} · n=${r.warmN}`)
        } else {
            const key = r.key + ' '.repeat(labelWidth - Bun.stringWidth(r.key))
            lines.push(`${styles.name(key)}  ${String(r.n).padStart(4)}  ${duration.padStart(8)}  ${tail.padStart(8)}  ${String(r.warmN).padStart(6)}  ${styles.label(bar(slowest ? r.median / slowest : 0))}${delta ? `  ${delta}` : ''}`)
        }
        if (apart) lines.push((r.failed ? styles.warning : styles.muted)(`  ${apart}`))
        if (options.details) lines.push(`  p90 clean ${r.n ? formatDuration(r.p90 * 1000) : '—'} · excludes cold starts and outliers`)
        if (r.baseline && options.details) lines.push(`  baseline: ${r.baseline}`)
    }
    return lines.map(line => fitLine(line, terminalWidth)).join('\n')
}
