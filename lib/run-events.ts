import {appendFileSync} from 'node:fs'
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
