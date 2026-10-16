// Statistics over every measured picture, clip and LLM call of all projects (the central timings file, see
// lib/timings.ts): medians, p90, cold starts and outliers apart, token sums, optional prices from the settings file.
// usage: bun run stats [--by=workflow|variant|resolution|server] [--kind=clip|picture|song] [--project=<id>] [--compare]
//   --compare  the first row of every table is the reference, the others show the change against it in percent
import {existsSync, readdirSync} from "node:fs";
import {join} from "node:path";
import {parseArgs} from "node:util";
import {printBanner, styles} from "../lib/log.ts";
import {cost, type Price, sumTokens} from "../lib/predict.ts";
import {by, formatRows, groupRows} from "../lib/stats.ts";
import {readSettingsFile} from "../lib/settings.ts";
import {migrateProjectTimings, readTimings, timingsFile} from "../lib/timings.ts";

const {values} = parseArgs({args: Bun.argv.slice(2), options: {by: {type: 'string'}, kind: {type: 'string'}, project: {type: 'string'}, compare: {type: 'boolean'}}})
const dimension = values.by ?? 'variant'
if (!(dimension in by) || ['model', 'step'].includes(dimension)) {
    console.error(`usage: bun run stats [--by=workflow|variant|resolution|server] [--kind=clip|picture|song] [--project=<id>] [--compare]`)
    process.exit(1)
}

// timings of the first format, still in the project folders, join the central file first
if (existsSync('projects')) for (const d of readdirSync('projects', {withFileTypes: true})) if (d.isDirectory()) migrateProjectTimings(join('projects', d.name))

let timings = readTimings()
if (values.project) timings = timings.filter(t => t.project === values.project)
if (!timings.length) {
    console.log(`No measurements yet (${timingsFile()}) - they are written while pictures, clips and LLM calls run.`)
    process.exit(0)
}
printBanner()
console.log(styles.muted(`${timings.length} measurements from ${new Set(timings.map(t => t.project)).size} project(s) in ${timingsFile()} - medians of warm jobs; cold starts and outliers are counted apart, never mixed in\n`))

const renders = timings.filter(t => t.kind !== 'llm' && (!values.kind || t.kind === values.kind))
const table = (title: string, rows: ReturnType<typeof groupRows>) => {
    const text = formatRows(title, rows, values.compare ? rows[0] : undefined)
    if (text) console.log(text + '\n')
}
table(`Renders by ${dimension}`, groupRows(renders, by[dimension as 'variant']))
table('LLM calls by model', groupRows(timings.filter(t => t.kind === 'llm'), by.model))

const prices = (await readSettingsFile()).prices ?? {}
const tokenTable = (title: string, key: (t: (typeof timings)[number]) => string) => {
    const sums = sumTokens(timings, key)
    if (!sums.size) return
    console.log(title)
    for (const [name, sum] of [...sums].sort((a, b) => a[0].localeCompare(b[0]))) {
        // calls without usage have no token numbers - the sums only cover the ones that reported them
        const money = cost(sum, prices[name] as Price | undefined)
        console.log(`  ${name.padEnd(28)} ${String(sum.calls).padStart(4)} calls  ${sum.prompt} in (${sum.cached} cached)  ${sum.completion} out (${sum.reasoning} reasoning)${money === undefined ? '' : `  ≈ ${money.toFixed(2)} ${(prices[name] as Price).currency ?? ''}`}`)
    }
    console.log()
}
tokenTable('Tokens per step (as reported by the endpoint)', t => t.step ?? 'unknown step')
tokenTable('Tokens per project', t => t.project ?? 'unknown project')
tokenTable('Tokens per model', t => t.name)
if (!Object.keys(prices).length) console.log(styles.muted('Prices: add "prices": {"<model id>": {"inputPerMillion": 0.5, "outputPerMillion": 1.5, "currency": "EUR"}} to the settings file to see costs.'))
