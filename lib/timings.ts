import {appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync} from "node:fs";
import {AsyncLocalStorage} from "node:async_hooks";
import {basename, dirname, join} from "node:path";
import type {GraphSetup, Phase} from "./graph.ts";
import {settingsPath} from "./settings.ts";
import {processAlive} from './lock.ts';
import {log} from './log.ts';

// Every measured duration, one JSON line each, in ONE file for all projects (next to the settings file, outside the
// repo) so projects can be compared - override with FEVERSLOP_TIMINGS. Append-only; numbers and names only, never a
// prompt, an answer or a picture. Never part of a fingerprint. Lines of the first format (per project, in
// <project>/timings.jsonl, without "v" and "project") are moved in on the next run and still read the same:
// every field beyond at/kind/name/seconds is optional.
export type Timing = {
    v?: 2
    at: string
    project?: string
    kind: 'llm' | 'picture' | 'clip' | 'song' | 'interpolation'
    name: string              // the workflow (renders) or the model (LLM calls)
    seconds: number           // of one job / one call
    outcome?: 'retry' | 'failed' | 'again' | 'resumed' // resumed: only this run's wait/fetch time, never a complete render duration
    reason?: string           // short, a fixed word or an error class - no text of the prompt or the answer
    migration?: string        // idempotency key for a legacy row copied into the central store
    step?: string             // the pipeline step an LLM call belongs to

    // renders - what the ComfyUI graph said and where it ran
    variant?: string
    workflowHash?: string     // of the workflow file: an edited workflow is unknown until it ran once
    setup?: GraphSetup
    server?: string
    gpu?: string
    vramGb?: number
    versions?: string
    cold?: boolean            // the first job on that server after another set of models
    queueSeconds?: number     // waiting in ComfyUI's queue, not computing
    phases?: Partial<Record<Phase, number>>
    resolution?: number | string
    frames?: number
    pixels?: number

    // LLM calls - only what the endpoint reported (usage), nothing estimated
    endpoint?: string
    promptTokens?: number
    completionTokens?: number
    reasoningTokens?: number
    cachedTokens?: number
    thinkingWords?: number
    tokensPerSecond?: number
}

const FILE = 'timings.jsonl'
const HISTORY_MONTHS = 24
let project: string | undefined

const currentMonth = () => new Date().toISOString().slice(0, 7)
const monthFile = (dir: string, month = currentMonth()) => join(dir, `timings-${month}.jsonl`)
export const timingsFile = () => process.env.FEVERSLOP_TIMINGS || monthFile(dirname(settingsPath()))

function pruneTimingHistory(file: string) {
    if (process.env.FEVERSLOP_TIMINGS) return
    const dir = dirname(file)
    const [year, month] = currentMonth().split('-').map(Number) as [number, number]
    const cutoff = new Date(year!, month! - HISTORY_MONTHS, 1).toISOString().slice(0, 7)
    for (const name of readdirSync(dir)) {
        const match = /^timings-(\d{4}-\d{2})\.jsonl$/.exec(name)
        if (match && match[1]! < cutoff) rmSync(join(dir, name), {force: true})
    }
}

function timingFiles(file: string): string[] {
    if (process.env.FEVERSLOP_TIMINGS) return [file]
    const dir = dirname(file)
    const [year, month] = currentMonth().split('-').map(Number) as [number, number]
    const cutoff = new Date(year!, month! - HISTORY_MONTHS, 1).toISOString().slice(0, 7)
    const monthly = readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
        const match = entry.isFile() && /^timings-(\d{4}-\d{2})\.jsonl$/.exec(entry.name)
        return match && match[1]! >= cutoff && match[1]! <= currentMonth() ? [join(dir, entry.name)] : []
    })
    const legacy = join(dir, FILE)
    if (existsSync(legacy)) monthly.push(legacy)
    return monthly.sort()
}

/** Starts keeping measurements for this project - and moves the lines of the old per-project file into the central one. */
export function keepTimingsIn(dir: string | undefined) {
    project = dir ? basename(dir) : undefined
    if (dir) migrateProjectTimings(dir)
}

function append(timing: Timing) {
    try {
        const file = timingsFile()
        mkdirSync(dirname(file), {recursive: true})
        appendFileSync(file, JSON.stringify(timing) + '\n')
        pruneTimingHistory(file)
    } catch {
        // statistics are a nicety - never fail a render over them
    }
}

// the measurements of this run, for its summary at the end
const thisRun: Omit<Timing, 'at' | 'v' | 'project'>[] = []
export const runTimings = () => [...thisRun]

export function recordTiming(timing: Omit<Timing, 'at' | 'v' | 'project'>) {
    thisRun.push(timing)
    if (!project) return
    append({v: 2, at: new Date().toISOString(), project, ...timing})
}

const parseLines = (text: string) => text.split('\n').flatMap(line => {
    try {
        return line.trim() ? [JSON.parse(line) as Timing] : []
    } catch {
        return []
    }
})

const parsedFiles = new Map<string, {stamp: string, rows: Timing[]}>()
export function readTimings(file?: string): Timing[] {
    const target = file ?? timingsFile()
    const sources = (!file && !process.env.FEVERSLOP_TIMINGS ? timingFiles(target) : [target]).filter(existsSync)
    if (!sources.length) { parsedFiles.delete(target); return [] }
    const stamp = sources.map(source => {
        const stat = statSync(source)
        return `${source}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`
    }).join('|')
    const cached = parsedFiles.get(target)
    if (cached?.stamp === stamp) return [...cached.rows]
    const rows = sources.flatMap(source => parseLines(readFileSync(source, 'utf8'))).map(row => Object.freeze(row))
    parsedFiles.delete(target)
    parsedFiles.set(target, {stamp, rows})
    if (parsedFiles.size > 4) parsedFiles.delete(parsedFiles.keys().next().value!)
    return [...rows]
}

/** The per-project file of the first format → the central file (every line gets its project); the old file is kept as .migrated. */
export function migrateProjectTimings(dir: string) {
    const legacy = join(dir, FILE)
    if (!existsSync(legacy)) return 0
    const lock = `${legacy}.migration.lock`
    let fd: number
    try {
        if (existsSync(lock)) {
            const pid = Number(readFileSync(lock, 'utf8'))
            if (processAlive(pid) || Date.now() - statSync(lock).mtimeMs < 300000) return 0
            rmSync(lock, {force: true})
        }
        fd = openSync(lock, 'wx')
    } catch { return 0 }
    try {
        writeFileSync(fd, String(process.pid))
        if (!existsSync(legacy)) return 0
        const text = readFileSync(legacy, 'utf8')
        const id = Bun.hash(`${legacy}\n${text}`).toString(16)
        const lines = parseLines(text).map((line, n) => ({project: basename(dir), ...line, migration: `${id}:${n}`}))
        const copied = new Set(readTimings().map(row => row.migration).filter(Boolean))
        const missing = lines.filter(line => !copied.has(line.migration))
        mkdirSync(dirname(timingsFile()), {recursive: true})
        // One append under the source lock; a retry after an interrupted append skips complete copied rows.
        if (missing.length) appendFileSync(timingsFile(), '\n' + missing.map(line => JSON.stringify(line)).join('\n') + '\n')
        renameSync(legacy, `${legacy}.migrated`)
        return lines.length
    } catch {
        log.warn(`Could not migrate ${legacy}; the source is retained and will be retried`)
        return 0
    } finally { closeSync(fd); rmSync(lock, {force: true}) }
}

// the pipeline step an LLM call belongs to - set where a step runs (lib/project.ts), read where the call is recorded
const stepName = new AsyncLocalStorage<string>()
export const withStep = <T>(name: string, run: () => T): T => stepName.run(name, run)
export const currentStep = () => stepName.getStore()
