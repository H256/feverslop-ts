// Compact performance report over the central timing store. See docs/stats.md for metric definitions.
import {parseArgs} from 'node:util';
import {existsSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {cli} from '../lib/cli.ts';
import {log} from '../lib/log.ts';
import {buildReport, parseSince, type ReportOptions} from '../lib/stats-report.ts';
import {formatReport} from '../lib/stats-view.ts';
import {migrateProjectTimings, readTimings, timingsFile} from '../lib/timings.ts';
import {readSettingsFile} from '../lib/settings.ts';
import type {Dimension} from '../lib/stats.ts';

cli('stats')
const usage = 'bun run stats [--by=variant,gpu] [--kind=clip|picture|song|interpolation|llm] [--project=id] [--since=7d] [--sort=name|median|p90|n|failed] [--top=10] [--compare] [--baseline="GPU or group"] [--details] [--json]'
const values = (() => {
    try {
        return parseArgs({args: Bun.argv.slice(2), options: {
            by: {type: 'string'}, kind: {type: 'string'}, project: {type: 'string'}, since: {type: 'string'},
            sort: {type: 'string'}, top: {type: 'string'}, baseline: {type: 'string'}, compare: {type: 'boolean'},
            details: {type: 'boolean'}, json: {type: 'boolean'},
        }}).values
    } catch (error) { return log.usageError((error as Error).message, usage) }
})()
const options: ReportOptions = {
    dimensions: (values.by ?? 'variant,gpu').split(',').map(d => d.trim()) as Dimension[],
    kind: values.kind as ReportOptions['kind'], project: values.project,
    sort: values.sort as ReportOptions['sort'], top: values.top === undefined ? (values.details || values.json ? undefined : 8) : Number(values.top),
    compare: values.compare, baseline: values.baseline,
}
// Validate options before migrating old files or reading settings.
try {
    options.since = values.since === undefined ? undefined : parseSince(values.since)
    buildReport([], {...options, baseline: undefined})
    if (values.baseline === '') throw new Error('--baseline: specify a GPU or exact group name')
} catch (error) { log.usageError((error as Error).message, usage) }

if (existsSync('projects')) for (const d of readdirSync('projects', {withFileTypes: true})) {
    if (d.isDirectory()) migrateProjectTimings(join('projects', d.name))
}
const timings = readTimings()
const prices = (await readSettingsFile()).prices ?? {}
const report = (() => {
    try { return buildReport(timings, options, prices) }
    catch (error) { return log.usageError((error as Error).message, usage) }
})()
if (values.json) log.json(report)
else {
    log.info(formatReport(report, {details: values.details}))
    if (!report.summary.measurements) log.info(`No measurements match. Adjust --project, --kind or --since. Source: ${timingsFile()}`)
    if (!values.details) log.next('bun run stats --details   # add the same filters to expand this selection')
}
