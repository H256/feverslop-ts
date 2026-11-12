import type {StatsRow, StatsView} from '../../shared/workspace.ts'
import {readSettingsFile} from '../settings.ts'
import type {Row} from '../stats.ts'
import {buildReport, parseSince, type ReportOptions} from '../stats-report.ts'
import {readTimings} from '../timings.ts'

// The measured times of this machine as the Stats page shows them (#836): what `bun run stats --json` reports - the same
// buildReport over the same timings file - with the fields a table needs.

const KINDS = ['clip', 'picture', 'song', 'interpolation', 'llm'] as const

const rowOf = (row: Row): StatsRow => ({
    key: row.key,
    n: row.n,
    median: row.median,
    p90: row.p90,
    cold: row.cold,
    retries: row.retries,
    failed: row.failed,
})

/** The report for these filters of the page: `since` as the command takes it (7d, 24h), `kind` one of its kinds. */
export async function statsView(asked: {since?: string; kind?: string}): Promise<StatsView> {
    const options: ReportOptions = {dimensions: ['variant', 'gpu'], sort: 'name'}
    if (asked.since) options.since = parseSince(asked.since)
    if (asked.kind) {
        if (!(KINDS as readonly string[]).includes(asked.kind)) throw new Error(`no such kind "${asked.kind}" - ${KINDS.join(', ')}`)
        options.kind = asked.kind as ReportOptions['kind']
    }
    const report = buildReport(readTimings(), options, (await readSettingsFile()).prices ?? {})
    const {summary} = report
    return {
        summary: {
            measurements: summary.measurements,
            projects: summary.projects,
            successful: summary.successful,
            failed: summary.failed,
            retries: summary.retries,
            again: summary.again,
            jobHours: summary.summedJobSeconds / 3600,
        },
        renders: report.renders.map(rowOf),
        llm: report.llm.map(rowOf),
    }
}
