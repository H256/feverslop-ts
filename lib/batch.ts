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

/** A clip that is rendered again with a fixed seed comes out the same (--again). */
export function warnFixedSeed(seed: number) {
    if (seed !== -1) log.warn(`"seed" is ${seed} in config.json - the same seed gives the same clip again; -1 gives a new one every time`)
}

/** The clips not among the selected ones that go on, directly or through others, from the last frame of a selected one. */
export function clipsGoingOn<T extends { id: string, startsFrom?: string }>(selected: T[], all: T[]): string[] {
    const later = new Set<string>()
    for (const clip of selected) {
        for (let next = all.find(c => c.startsFrom === clip.id); next; next = all.find(c => c.startsFrom === next!.id)) if (!selected.includes(next)) later.add(next.id)
    }
    return [...later]
}

/** A clip that goes on from the last frame of a clip rendered again starts on a picture that is gone (--again). */
export function warnClipsGoingOn<T extends { id: string, startsFrom?: string }>(selected: T[], all: T[]) {
    const later = clipsGoingOn(selected, all)
    if (later.length) log.warn(`${later.join(', ')} start on the last frame of a clip rendered again and are not - render them again too (--again) if the picture should go on from the new one`)
}
