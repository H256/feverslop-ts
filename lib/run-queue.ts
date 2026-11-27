import {renameHeld} from './previous-output.ts'
import {appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs'
import {basename, dirname, join, resolve} from 'node:path'
import type {PastRun, QueuedRun} from '../shared/workspace.ts'

// The runs of a project as files in its logs/ (#837), so the editor, a restarted editor and the terminal see the same:
// - logs/queue.json: what was asked for while a run went on, to start after it - in order. The workspace starts them; the terminal
//   lists and takes out (bun run runs).
// - logs/runs.jsonl: every run that ended, one line each - its command, how it ended and its log.

const QUEUE = join('logs', 'queue.json')
/** The history of the runs that ended - written as a run ends (lib/run-record.ts), or by the editor for a tool that keeps none. */
const RUNS = join('logs', 'runs.jsonl')

export function readQueue(dir: string): QueuedRun[] {
    try {
        const found: unknown = JSON.parse(readFileSync(join(dir, QUEUE), 'utf8'))
        return Array.isArray(found) ? (found as QueuedRun[]) : []
    } catch {
        return []
    }
}

// whole or not at all: the editor and the terminal may read it while it is written
function writeQueue(dir: string, queue: QueuedRun[]) {
    const file = join(dir, QUEUE)
    mkdirSync(join(dir, 'logs'), {recursive: true})
    writeFileSync(`${file}.tmp`, JSON.stringify(queue, null, 2))
    renameHeld(`${file}.tmp`, file)
}

// a folder moved into the project: renamed where it can be, copied across drives (the temp folder on C:, the project on E:)
function moveFolder(from: string, to: string) {
    mkdirSync(dirname(to), {recursive: true})
    try {
        renameSync(from, to)
    } catch {
        cpSync(from, to, {recursive: true})
        rmSync(from, {recursive: true, force: true})
    }
}

let counter = 0
/**
 * Puts a run behind the others; `command` is how it reads - the command line it starts. `given`: folders of what it is given for
 * itself (an edited prompt, an uploaded anchor) - moved into logs/queued/<id> with it, so they are there when its turn comes, also
 * after the editor started again; its request and command name them there. They go when it is taken out, or when its run ends.
 */
export function queueRun(dir: string, run: Omit<QueuedRun, 'id' | 'askedAt' | 'files'>, given: string[] = []): QueuedRun {
    const id = `${Date.now().toString(36)}-${(counter++).toString(36)}`
    // absolute: the run is started from wherever the editor runs, the command names the files as they are
    const kept = resolve(dir, 'logs', 'queued', id)
    let {request, command} = run
    for (const folder of given) {
        const to = join(kept, basename(folder))
        moveFolder(folder, to)
        request = Object.fromEntries(
            Object.entries(request).map(([key, value]) => [
                key,
                typeof value === 'string' && value.startsWith(folder) ? to + value.slice(folder.length) : value,
            ]),
        ) as QueuedRun['request']
        command = command.split(folder).join(to)
    }
    const queued: QueuedRun = {id, askedAt: new Date().toISOString(), ...run, request, command, ...(given.length ? {files: [kept]} : {})}
    writeQueue(dir, [...readQueue(dir), queued])
    return queued
}

/** Takes one out, with the files it was given; false when it is not (or no longer) there. */
export function unqueue(dir: string, id: string): boolean {
    const queue = readQueue(dir)
    const rest = queue.filter(q => q.id !== id)
    if (rest.length === queue.length) return false
    writeQueue(dir, rest)
    for (const folder of queue.find(q => q.id === id)?.files ?? []) rmSync(folder, {recursive: true, force: true})
    return true
}

/** The first one, taken out of the queue to be started - its files (QueuedRun.files) go to the run that starts it, which drops them as it ends. */
export function takeFirst(dir: string): QueuedRun | undefined {
    const [first, ...rest] = readQueue(dir)
    if (first) writeQueue(dir, rest)
    return first
}

export const hasQueue = (dir: string) => existsSync(join(dir, QUEUE)) && readQueue(dir).length > 0

/** One line of the history: written by a run as it ends (lib/run-record.ts), or by the editor for a tool it started that keeps none. */
export function notePastRun(dir: string, past: PastRun) {
    try {
        mkdirSync(join(dir, 'logs'), {recursive: true})
        appendFileSync(join(dir, RUNS), `${JSON.stringify(past)}\n`)
    } catch {
        // a history that cannot be written is no reason for a run to fail at its end
    }
}

/** The last runs, newest first. */
export function pastRuns(dir: string, most = 20): PastRun[] {
    try {
        return readFileSync(join(dir, RUNS), 'utf8')
            .split('\n')
            .filter(Boolean)
            .slice(-most)
            .flatMap(line => {
                try {
                    return [JSON.parse(line) as PastRun]
                } catch {
                    return []
                }
            })
            .reverse()
    } catch {
        return []
    }
}
