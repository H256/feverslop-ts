import {appendFileSync, existsSync, readdirSync, readFileSync, statSync} from 'node:fs'
import {join} from 'node:path'
import type {RunEvent} from '../shared/workspace.ts'

/**
 * The events of this run as data (#829): one JSON line each, in a file next to its log - `<stamp>.log` and `<stamp>.events.jsonl`.
 * The workspace reads these instead of the wording of the log. A run that keeps no log writes none.
 */
let file: string | undefined

/** The events file that belongs to a log file. */
export const eventsFileOf = (logFile: string) => logFile.replace(/\.log$/, '') + '.events.jsonl'

export function keepEventsNextTo(logFile: string) {
    file = eventsFileOf(logFile)
}

type WithoutAt<E> = E extends unknown ? Omit<E, 'at'> : never
export function runEvent(event: WithoutAt<RunEvent>) {
    if (!file) return
    try {
        appendFileSync(file, `${JSON.stringify({at: Date.now(), ...event})}\n`)
    } catch {
        // events that cannot be written are no reason to stop a run
    }
}

/** A step title as the CLI prints it ("11b · BLOCKING THE BEATS") as a person reads it: "11b · Blocking the beats". */
export function stepTitle(title: string) {
    const [number, ...words] = title.split(' · ')
    const name = words.join(' · ')
    if (!name) return title.charAt(0) + title.slice(1).toLowerCase()
    return `${number} · ${name.charAt(0)}${name.slice(1).toLowerCase()}`
}

/** The newest log of a project - the run going on, or the last one. */
export function newestLog(dir: string): string | undefined {
    const logs = join(dir, 'logs')
    if (!existsSync(logs)) return undefined
    const files = readdirSync(logs)
        .filter(f => f.endsWith('.log'))
        .map(f => join(logs, f))
    return files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
}

/** The events of the newest run of a project: the file next to its newest log - `file` names it, so a follower sees another run begin. */
export function newestRunEvents(dir: string): {file?: string; events: RunEvent[]} {
    const log = newestLog(dir)
    if (!log) return {events: []}
    const file = eventsFileOf(log)
    if (!existsSync(file)) return {file, events: []}
    const events: RunEvent[] = []
    // only whole lines: a line still being written is read when it is complete
    for (const line of readFileSync(file, 'utf8').split('\n').slice(0, -1)) {
        try {
            events.push(JSON.parse(line) as RunEvent)
        } catch {
            // a line that is not an event is skipped, not the run
        }
    }
    return {file, events}
}

export type RunSummary = {
    step?: string
    warnings: number
    firstWarnings: string[]
    failure?: {message: string; advice?: string}
    done?: {output?: string; next?: string}
    asking?: string
    jobs?: {total: number; done: number; failed: string[]}
}
/** What a run's events say, for bun run status --json (#829): the step it is or was at, its warnings, its failure, its jobs. */
export function runSummary(events: RunEvent[]): RunSummary {
    const summary: RunSummary = {warnings: 0, firstWarnings: []}
    const jobs = new Map<string, string>()
    for (const event of events) {
        if (event.type === 'step' && event.state !== 'done') summary.step = event.title
        if (event.type === 'warning') {
            summary.warnings++
            if (summary.firstWarnings.length < 5) summary.firstWarnings.push(event.message)
        }
        if (event.type === 'failed') summary.failure = {message: event.message, ...(event.advice ? {advice: event.advice} : {})}
        if (event.type === 'done') summary.done = {output: event.output, next: event.next}
        // a question of a review gate stands until the next step begins or the run ends
        if (event.type === 'ask') summary.asking = event.message
        else if (event.type === 'step' || event.type === 'done' || event.type === 'failed') delete summary.asking
        if (event.type === 'jobs') for (const id of event.ids) if (!jobs.has(id)) jobs.set(id, 'waiting')
        if (event.type === 'job' && jobs.has(event.id)) jobs.set(event.id, event.state)
    }
    if (jobs.size)
        summary.jobs = {
            total: jobs.size,
            done: [...jobs.values()].filter(state => state === 'done').length,
            failed: [...jobs].filter(([, state]) => state === 'failed').map(([id]) => id),
        }
    return summary
}
