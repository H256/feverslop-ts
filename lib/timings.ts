import {appendFileSync, existsSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {formatDuration} from "./log.ts";

// Every measured duration, one JSON line each in <project>/timings.jsonl - append-only, only read for statistics and
// the remaining-time estimate, never part of a fingerprint.
export type Timing = {
    at: string
    kind: 'llm' | 'picture' | 'clip'
    name: string              // the workflow (renders) or the model (LLM calls)
    seconds: number
    tokensPerSecond?: number
    resolution?: string        // e.g. "1280x720"
    frames?: number
}

const FILE = 'timings.jsonl'
let projectDir: string | undefined

/** Where recordTiming writes - without it (scripts, tests) measurements are simply not kept. */
export const keepTimingsIn = (dir: string | undefined) => {
    projectDir = dir
}

export function recordTiming(timing: Omit<Timing, 'at'>) {
    if (!projectDir) return
    try {
        appendFileSync(join(projectDir, FILE), JSON.stringify({at: new Date().toISOString(), ...timing}) + '\n')
    } catch {
        // statistics are a nicety - never fail a render over them
    }
}

export function readTimings(dir: string): Timing[] {
    const file = join(dir, FILE)
    if (!existsSync(file)) return []
    return readFileSync(file, 'utf8').split('\n').flatMap(line => {
        try {
            return line.trim() ? [JSON.parse(line) as Timing] : []
        } catch {
            return []
        }
    })
}

export const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b)
    const mid = sorted.length >> 1
    return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/** Rough time for `count` more jobs at the median of the earlier ones with the same kind and name, spread over `servers`. */
export function estimateRemaining(timings: Timing[], kind: Timing['kind'], name: string, count: number, servers = 1) {
    const earlier = timings.filter(t => t.kind === kind && t.name === name)
    if (!count || !earlier.length) return undefined
    const perJob = median(earlier.map(t => t.seconds))
    return {seconds: perJob * count / Math.max(1, servers), perJob, samples: earlier.length}
}

/** "12 clips left, about 1h 40m at the median of 31 earlier clips (estimate)" */
export function describeEstimate(noun: string, count: number, estimate: ReturnType<typeof estimateRemaining>) {
    const left = `${count} ${noun}${count === 1 ? '' : 's'} left`
    if (!estimate) return left
    return `${left}, about ${formatDuration(estimate.seconds * 1000)} at the median of ${estimate.samples} earlier ${noun}${estimate.samples === 1 ? '' : 's'} (estimate)`
}
