import {formatSlotRanges} from './assemble.ts'
import {log} from './log.ts'
import {readClipRequests, readPictureJobs} from './render-state.ts'
import {noteRunFailures, runCommand} from './run-record.ts'

/**
 * Runs all renders and lets the others finish when one fails - their jobs are on the servers already.
 * Throws afterwards if any failed.
 */
export async function renderAll<T>(items: T[], renderOne: (item: T) => Promise<unknown>) {
    const results = await Promise.allSettled(items.map(renderOne))
    const errors = results.flatMap(r => (r.status === 'rejected' ? [r.reason instanceof Error ? r.reason.message : String(r.reason)] : []))
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
export function clipChains<T extends {id: string; startsFrom?: string}>(clips: T[]): T[][] {
    const chains: T[][] = []
    for (const clip of clips) {
        const chain = clip.startsFrom ? chains.find(c => c.at(-1)!.id === clip.startsFrom) : undefined
        if (chain) chain.push(clip)
        else chains.push([clip])
    }
    return chains
}

/**
 * The clips --only names, or all when it names none. Every name has to be a clip: a typo must not pass as "none of them" -
 * film.ts, index.ts and refinish ask the same way.
 */
export function onlyClips<T extends {id: string}>(clips: T[], only: Set<string>): T[] {
    const unknown = [...only].filter(id => !clips.some(c => c.id === id))
    if (unknown.length) throw new Error(`--only: no clip ${unknown.join(', ')} - the clips are ${formatSlotRanges(clips.map(c => c.id))}`)
    return clips.filter(c => !only.size || only.has(c.id))
}

/**
 * What is wrong with the ids of --only and --retake, said before the first step (#818): a typo in an id was found only at
 * the render, after every cached step had been replayed. Checked against the requests and pictures of the last plan run -
 * undefined when the ids are known, or when there is no plan yet to check them against (the render checks them then).
 */
export async function unknownIds(
    projectDir: string,
    picturesFile: string,
    asked: {only: string[]; retake?: string; pictures: boolean; clips: boolean},
): Promise<string | undefined> {
    const clips = (await readClipRequests<{id: string}>(projectDir)).map(c => c.id)
    if (!clips.length) return undefined
    const pictures = (await readPictureJobs(picturesFile)).map(p => p.id)
    const known = [...(asked.clips ? clips : []), ...(asked.pictures ? pictures : [])]
    const there = [
        ...(asked.clips ? [`the clips are ${formatSlotRanges(clips)}`] : []),
        ...(asked.pictures && pictures.length ? [`the pictures are ${pictures.join(', ')}`] : []),
    ].join('; ')
    if (asked.retake && !clips.includes(asked.retake)) return `--retake: no clip ${asked.retake} in the last plan - the clips are ${formatSlotRanges(clips)}`
    const unknown = asked.only.filter(id => !known.includes(id))
    if (!unknown.length || !known.length) return undefined
    const what = asked.clips && asked.pictures ? 'clip or picture' : asked.clips ? 'clip' : 'picture'
    return `--only: no ${what} ${unknown.join(', ')} in the last plan - ${there}`
}

/** A clip that is rendered again with a fixed seed comes out the same (--again). */
export function warnFixedSeed(seed: number) {
    if (seed !== -1)
        log.warn(
            `"seed" is ${seed} in config.json - each clip gets its own seed from it, and the same one again: the same clip comes out; -1 gives a new one every time`,
        )
}

/** The clips not among the selected ones that go on, directly or through others, from the last frame of a selected one. */
export function clipsGoingOn<T extends {id: string; startsFrom?: string}>(selected: T[], all: T[]): string[] {
    const later = new Set<string>()
    for (const clip of selected) {
        for (let next = all.find(c => c.startsFrom === clip.id); next; next = all.find(c => c.startsFrom === next!.id))
            if (!selected.includes(next)) later.add(next.id)
    }
    return [...later]
}

/** A clip that goes on from the last frame of a clip rendered again starts on a picture that is gone (--again). */
export function warnClipsGoingOn<T extends {id: string; startsFrom?: string}>(selected: T[], all: T[]) {
    const later = clipsGoingOn(selected, all)
    if (later.length)
        log.warn(
            `${later.join(', ')} start on the last frame of a clip rendered again and are not - render them again too (--again) if the picture should go on from the new one`,
        )
}
