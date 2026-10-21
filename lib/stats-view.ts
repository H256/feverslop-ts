import {formatDuration, styles, wrap} from './log.ts';
import {bar, formatRows} from './stats.ts';
import type {StatsReport} from './stats-report.ts';

const number = (value: number) => value.toLocaleString('en-US')
const duration = (seconds: number) => formatDuration(seconds * 1000)

/** Pure rendering: the command sends the resulting report through the shared logger once. */
export function formatReport(report: StatsReport, options: {width?: number, details?: boolean} = {}) {
    const width = Math.max(1, options.width ?? process.stdout.columns ?? 100)
    const {summary: s, filters} = report
    const lines: string[] = []
    const line = (text = '') => lines.push(...wrap(text, width))
    const heading = (title: string) => { line(); lines.push(styles.name(title)) }
    heading('OVERVIEW')
    line(`${number(s.measurements)} measurements · ${s.projects} projects${s.unknownProject ? ` · ${s.unknownProject} without project` : ''}`)
    line(`Selection: ${filters.project ?? 'all projects'} · ${filters.kind ?? 'all kinds'} · ${filters.since === undefined ? 'all time' : `since ${new Date(filters.since).toISOString()}`}`)
    line(`Successful jobs/calls ${s.successful}  |  Failed attempts ${s.failed}`)
    line(`Retries ${s.retries}  |  Manual reruns ${s.again}`)
    line(`Measured job time ${duration(s.summedJobSeconds)} (sum; NOT elapsed wall time)`)
    if (s.invalidDurations) line(`Excluded from metrics: ${s.invalidDurations} invalid durations`)
    if (s.usage.calls) {
        line(`LLM tokens: in ${number(s.usage.prompt)} · out ${number(s.usage.completion)}`)
        line(`Usage coverage: ${s.usage.complete}/${s.usage.calls} complete · ${s.usage.partial} partial · ${s.usage.missing} missing`)
        line(`Cached input ${number(s.usage.cached)} · reasoning ${number(s.usage.reasoning)} (included in input/output, not extra tokens)`)
        if (s.costs.length) {
            for (const cost of s.costs) line(`LLM cost ≈ ${cost.amount.toFixed(4)} ${cost.currency} · ${cost.calls}/${s.usage.calls} calls priced`)
            line('Partial estimate from complete usage and configured rates; cache discounts/provider billing may differ.')
        } else line('LLM cost: unavailable (requires complete usage and configured model prices)')
    }
    const sections = [
        {title: `RENDERS · ${filters.dimensions.join(' / ')}`, rows: report.renders, total: report.groups.renders},
        {title: 'LLM · model', rows: report.llm, total: report.groups.llm},
    ]
    for (const section of sections) if (section.total) {
        line()
        lines.push(formatRows(section.title, section.rows, undefined, {width, details: options.details}))
        if (section.rows.length < section.total) line(`Showing ${section.rows.length}/${section.total} groups. Use --top=N or --details for more.`)
    }
    if (s.successfulRenders) {
        heading('QUEUE / PHASES')
        line(s.queue.samples ? `Queue: ${duration(s.queue.seconds)} summed · ${s.queue.samples}/${s.successfulRenders} successful renders measured` : 'Queue: no measurements')
        const total = s.phases.reduce((sum, p) => sum + p.seconds, 0)
        for (const phase of s.phases) {
            const share = total ? phase.seconds / total : 0
            line(`${phase.name.padEnd(12)} ${bar(share, 12)} ${Math.round(share * 100)}% · ${duration(phase.seconds)} · ${phase.samples}/${s.successfulRenders} measured`)
        }
        line(s.phases.length ? 'Shares of recorded phase time only; missing phases and queue are excluded.' : 'Phases: no measurements')
    }
    if (options.details) for (const dimension of ['model', 'step', 'project'] as const) {
        if (!report.tokens[dimension].length) continue
        heading(`Tokens per ${dimension}`)
        for (const row of report.tokens[dimension]) {
            line(row.key)
            line(`  ${row.calls} calls · ${row.complete} complete / ${row.partial} partial / ${row.missing} missing usage`)
            line(`  in ${number(row.prompt)} · out ${number(row.completion)} · cached ${number(row.cached)} · reasoning ${number(row.reasoning)}`)
        }
    }
    return lines.join('\n').trim()
}
