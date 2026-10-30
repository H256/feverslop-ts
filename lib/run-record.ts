import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {processAlive} from "./lock.ts";

// What the last run of a project did, in <project>/logs/last-run.json: the command, and how it ended. A run that is
// killed writes no end, so the next run and `status` can tell it apart from one that finished. Replaced by every run.
export type RunRecord = {
    command: string
    pid: number
    startedAt: string
    endedAt?: string
    exitCode?: number
    error?: string
    failures?: string[]     // the renders that failed: "clip slot-046: HIP out of memory..."
}
export type RunState = 'running' | 'stopped' | 'failed' | 'finished'

const FILE = join('logs', 'last-run.json')
let current: RunRecord | undefined

const save = (file: string, record: RunRecord) => {
    mkdirSync(dirname(file), {recursive: true})
    writeFileSync(file, JSON.stringify(record, null, 2))
}

/** The command as it can be typed again - with the key left out, this file and the log stay on disk. */
export function commandLine(argv: string[]) {
    return argv.map(arg => arg.startsWith('--llm-key=') ? '--llm-key=…' : /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg).join(' ')
}

export function lastRun(dir: string): RunRecord | undefined {
    try {
        return JSON.parse(readFileSync(join(dir, FILE), 'utf8'))
    } catch {
        return undefined
    }
}

export function runState(run: RunRecord, alive: (pid: number) => boolean = processAlive): RunState {
    if (run.endedAt === undefined) return alive(run.pid) ? 'running' : 'stopped'
    if (run.error || run.failures?.length) return 'failed'
    return run.exitCode ? 'stopped' : 'finished'
}

/** Starts the record of this run, ended when the process exits. Returns the run before it. */
export function startRunRecord(dir: string, command: string): RunRecord | undefined {
    const previous = lastRun(dir)
    const file = join(dir, FILE)
    const record: RunRecord = {command, pid: process.pid, startedAt: new Date().toISOString()}
    current = record
    save(file, record)
    process.on('exit', code => save(file, {...record, endedAt: new Date().toISOString(), exitCode: code}))
    return previous
}

export const runCommand = () => current?.command

export function noteRunFailures(failures: string[]) {
    if (current) current.failures = [...current.failures ?? [], ...failures]
}

export function noteRunError(message: string) {
    if (current) current.error = message
}
