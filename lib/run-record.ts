import {mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {basename, dirname, join} from 'node:path'
import {processAlive} from './lock.ts'
import {runLogFile, runResult} from './log.ts'
import {notePastRun} from './run-queue.ts'
import {ownProcessIdentity, sameProcess} from './process-identity.ts'

// What the last run of a project did, in <project>/logs/last-run.json: the command, and how it ended. A run that is
// killed writes no end, so the next run and `status` can tell it apart from one that finished. Replaced by every run.
export type RunRecord = {
    command: string
    pid: number
    identity?: string
    startedAt: string
    endedAt?: string
    exitCode?: number
    error?: string
    failures?: string[] // the renders that failed: "clip slot-046: HIP out of memory..."
    cancelled?: boolean
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
    return argv
        .map((arg, n) =>
            arg.startsWith('--llm-key=') ? '--llm-key=…' : argv[n - 1] === '--llm-key' ? '…' : /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg,
        )
        .join(' ')
}

export function lastRun(dir: string): RunRecord | undefined {
    try {
        return JSON.parse(readFileSync(join(dir, FILE), 'utf8'))
    } catch {
        return undefined
    }
}

export function runState(run: RunRecord, alive: (pid: number) => boolean = pid => processAlive(pid) && sameProcess(pid, run.identity)): RunState {
    if (run.endedAt === undefined) return alive(run.pid) ? 'running' : 'stopped'
    if (run.error || run.failures?.length) return 'failed'
    return run.exitCode || run.cancelled ? 'stopped' : 'finished'
}

/** Starts the record of this run, ended when the process exits. Returns the run before it. */
export function startRunRecord(dir: string, command: string): RunRecord | undefined {
    const previous = lastRun(dir)
    const file = join(dir, FILE)
    const record: RunRecord = {command, pid: process.pid, identity: ownProcessIdentity(), startedAt: new Date().toISOString()}
    current = record
    save(file, record)
    process.on('exit', code => {
        const ended: RunRecord = {...record, endedAt: new Date().toISOString(), exitCode: code, ...(runResult().cancelled ? {cancelled: true} : {})}
        save(file, ended)
        endInHistory(dir, ended)
    })
    return previous
}

export const runCommand = () => current?.command
/** "bun index.ts my-project " - how this run was started, for a command a message advises: whole, to be pasted (#819). Empty outside a run. */
export const commandStart = () => (current ? `${current.command.split(' ').slice(0, 3).join(' ')} ` : '')

export function noteRunFailures(failures: string[]) {
    if (current) current.failures = [...(current.failures ?? []), ...failures]
}

export function noteRunError(message: string) {
    if (current) current.error = message
}

/** This run in the history of the project's runs (logs/runs.jsonl, lib/run-queue.ts): how it ended, and its log (#837). */
function endInHistory(dir: string, record: RunRecord) {
    const log = runLogFile()
    const failure = record.failures?.[0] ?? record.error
    notePastRun(dir, {
        command: record.command,
        startedAt: record.startedAt,
        endedAt: record.endedAt,
        state: runState(record),
        ...(log ? {log: basename(log)} : {}),
        ...(failure ? {failure} : {}),
    })
}
