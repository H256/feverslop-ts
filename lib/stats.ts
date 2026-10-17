import {stripVTControlCharacters} from "node:util";
import {formatDuration, styles} from "./log.ts";
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
 * against the reference (green = faster, red = slower) and for what is counted apart. The widths are taken from the
 * plain text, so the colours never shift a column.
 */
export function formatRows(title: string, rows: Row[], reference?: Row) {
    if (!rows.length) return ''
    const slowest = Math.max(...rows.map(r => r.median), 0)
    const width = Math.max(...rows.map(r => r.key.length), 5)
    const cell = (text: string, w: number, right = false) => right ? text.padStart(w) : text.padEnd(w)
    const head = [cell('group', width), cell('n', 4, true), cell('median', 8, true), cell('p90', 8, true), ' '.repeat(BAR_WIDTH), cell('apart', 22)]
    if (reference) head.push('vs first')
    const lines = [`${styles.label('▌')} ${styles.name(title)}`, `  ${styles.muted(head.join('  '))}`, `  ${styles.border('─'.repeat(stripVTControlCharacters(head.join('  ')).length))}`]
    for (const r of rows) {
        const apart = [r.cold && `${r.cold} cold`, r.outliers && `${r.outliers} outlier`, r.retries && `${r.retries} retry`, r.failed && `${r.failed} failed`].filter(Boolean).join(', ')
        const change = reference && r !== reference ? percentChange(reference, r) : undefined
        const changeText = change === undefined ? '' : `${change > 0 ? '+' : ''}${change}%`
        const paint = change === undefined || change === 0 ? styles.muted : change > 0 ? styles.warning : styles.answer
        const cells = [
            cell(r.key, width), cell(String(r.n), 4, true),
            cell(r.n ? formatDuration(r.median * 1000) : '-', 8, true), cell(r.n ? formatDuration(r.p90 * 1000) : '-', 8, true),
            styles.label(bar(slowest ? r.median / slowest : 0)),
            cell(apart || '-', 22),
        ]
        const failing = r.failed > 0
        lines.push(`  ${cells.map((c, i) => i === 0 ? styles.name(c) : i === 5 ? (apart ? (failing ? styles.warning : styles.muted)(c) : styles.muted(c)) : c).join('  ')}${reference ? `  ${paint(changeText)}` : ''}`)
    }
    return lines.join('\n')
}
