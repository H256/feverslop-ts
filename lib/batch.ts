import {log} from "./log.ts";
import {noteRunFailures, runCommand} from "./run-record.ts";

/**
 * Runs all renders and lets the others finish when one fails - their jobs are on the servers already.
 * Throws afterwards if any failed.
 */
export async function renderAll<T>(items: T[], renderOne: (item: T) => Promise<unknown>) {
    const results = await Promise.allSettled(items.map(renderOne))
    const errors = results.flatMap(r => r.status === 'rejected' ? [r.reason instanceof Error ? r.reason.message : String(r.reason)] : [])
    if (!errors.length) return
    // e.g. "no server reachable" arrives once per render
    const unique = [...new Set(errors)]
    const short = unique.map(error => error.split('\n')[0]!.trim().slice(0, 200))
    noteRunFailures(short)
    if (unique.length === 1) throw new Error(errors.length > 1 ? `${unique[0]} (${errors.length} renders)` : unique[0])
    for (const error of unique) log.warn(error)
    throw new Error([`${errors.length} of ${items.length} renders failed:`, ...short, ...(runCommand() ? [`Again: ${runCommand()}`] : [])].join('\n'))
}

/** Runs of clips where each one starts on the last frame of the one before (startsFrom), in order. */
export function clipChains<T extends { id: string, startsFrom?: string }>(clips: T[]): T[][] {
    const chains: T[][] = []
    for (const clip of clips) {
        const chain = clip.startsFrom ? chains.find(c => c.at(-1)!.id === clip.startsFrom) : undefined
        if (chain) chain.push(clip)
        else chains.push([clip])
    }
    return chains
}
