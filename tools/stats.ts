import {cli} from '../lib/cli.ts';
import {log} from '../lib/log.ts';
// Statistics over every measured picture, clip and LLM call of all projects (the central timings file, see
// lib/timings.ts): medians, p90, cold starts and outliers apart, token sums, optional prices from the settings file.
// usage: bun run stats [--by=variant,gpu] [--kind=clip|picture|song] [--project=<id>] [--compare]
//   --by       workflow, variant, resolution, server or gpu - several joined with a comma, a row per combination
//              (default: variant,gpu - the same variant on every card it ran on)
//   --compare  the first row of every table is the reference, the others show the change against it in percent; by
//              several dimensions the first row with the same first part (variant,gpu: every card against the first
//              card of the same variant)
import {existsSync, readdirSync} from "node:fs";
import {join} from "node:path";
import {parseArgs} from "node:util";
import {styles} from "../lib/log.ts";
import {cost, type Price, sumTokens} from "../lib/predict.ts";
import {by, byAll, type Dimension, formatRows, groupRows, referenceOf} from "../lib/stats.ts";
import {readSettingsFile} from "../lib/settings.ts";
import {migrateProjectTimings, readTimings, timingsFile} from "../lib/timings.ts";
cli('stats')


const {values} = parseArgs({args: Bun.argv.slice(2), options: {by: {type: 'string'}, kind: {type: 'string'}, project: {type: 'string'}, compare: {type: 'boolean'}}})
const dimensions = (values.by ?? 'variant,gpu').split(',').map(d => d.trim()) as Dimension[]
if (dimensions.some(d => !(d in by) || ['model', 'step'].includes(d))) {
    log.error(`usage: bun run stats [--by=workflow|variant|resolution|server|gpu, several joined with a comma] [--kind=clip|picture|song] [--project=<id>] [--compare]`)
    process.exit(1)
}

// timings of the first format, still in the project folders, join the central file first
if (existsSync('projects')) for (const d of readdirSync('projects', {withFileTypes: true})) if (d.isDirectory()) migrateProjectTimings(join('projects', d.name))

let timings = readTimings()
if (values.project) timings = timings.filter(t => t.project === values.project)
if (!timings.length) {
    log.info(`No measurements yet (${timingsFile()}) - they are written while pictures, clips and LLM calls run.`)
    process.exit(0)
}
log.info(styles.muted(`${timings.length} measurements from ${new Set(timings.map(t => t.project)).size} project(s) in ${timingsFile()} - medians of warm jobs; cold starts and outliers are counted apart, never mixed in\n`))

const renders = timings.filter(t => t.kind !== 'llm' && (!values.kind || t.kind === values.kind))
const table = (title: string, rows: ReturnType<typeof groupRows>, dimensionCount = 1) => {
    const text = formatRows(title, rows, values.compare ? referenceOf(rows, dimensionCount) : undefined)
    if (text) log.info(text + '\n')
}
table(`Renders by ${dimensions.join(' and ')}`, groupRows(renders, byAll(dimensions)), dimensions.length)
table('LLM calls by model', groupRows(timings.filter(t => t.kind === 'llm'), by.model))

const prices = (await readSettingsFile()).prices ?? {}
const num = (n: number) => n.toLocaleString('en-US')
const tokenTable = (title: string, key: (t: (typeof timings)[number]) => string) => {
    const sums = sumTokens(timings, key)
    if (!sums.size) return
    const rows = [...sums].sort((a, b) => a[0].localeCompare(b[0]))
    const width = Math.max(...rows.map(([name]) => name.length), 5)
    const head = `${'group'.padEnd(width)}  ${'calls'.padStart(5)}  ${'in'.padStart(10)}  ${'cached'.padStart(10)}  ${'out'.padStart(10)}  ${'reasoning'.padStart(10)}`
    log.info(`${styles.label('▌')} ${styles.name(title)}`)
    log.info(`  ${styles.muted(head)}
  ${styles.border('─'.repeat(head.length))}`)
    for (const [name, sum] of rows) {
        // calls without usage have no token numbers - the sums only cover the ones that reported them
        const money = cost(sum, prices[name] as Price | undefined)
        log.info(`  ${styles.name(name.padEnd(width))}  ${String(sum.calls).padStart(5)}  ${num(sum.prompt).padStart(10)}  ${styles.muted(num(sum.cached).padStart(10))}  ${num(sum.completion).padStart(10)}  ${styles.thinking(num(sum.reasoning).padStart(10))}${money === undefined ? '' : `  ${styles.answer(`≈ ${money.toFixed(2)} ${(prices[name] as Price).currency ?? ''}`)}`}`)
    }
    log.info()
}
tokenTable('Tokens per step (as reported by the endpoint)', t => t.step ?? 'unknown step')
tokenTable('Tokens per project', t => t.project ?? 'unknown project')
tokenTable('Tokens per model', t => t.name)
if (!Object.keys(prices).length) log.info(styles.muted('Prices: add "prices": {"<model id>": {"inputPerMillion": 0.5, "outputPerMillion": 1.5, "currency": "EUR"}} to the settings file to see costs.'))
