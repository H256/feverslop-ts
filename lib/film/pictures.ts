import type {FilmConfig} from "./config.ts";
import {defaults, type RenderConfig} from "../config.ts";
import {log} from "../log.ts";
import type {PictureJob} from "../render.ts";
import type {FilmCast, FilmProject} from "./types.ts";

// the same place the music-video pipeline keeps its reference pictures, inside films/<id>/
export const filmPictureAsset = (kind: 'character' | 'location', id: string) => `assets/${kind}s/${id}.png`

/** The reference pictures of a film: every location, and every character who is ever seen (not a narrator's voice). */
export function filmPictures(cast: FilmCast, data: Pick<FilmProject, 'characterLooks' | 'characterDescriptions' | 'locationLooks' | 'locationDescriptions'>): PictureJob[] {
    return [
        ...cast.locations.map(l => ({
            kind: 'location' as const, id: l.id, file: filmPictureAsset('location', l.id), name: l.name,
            prompt: data.locationLooks?.[l.id] ?? '', description: data.locationDescriptions?.[l.id] ?? '',
        })),
        ...cast.characters.filter(c => !c.voiceOnly).map(c => ({
            kind: 'character' as const, id: c.id, file: filmPictureAsset('character', c.id), name: c.name,
            prompt: data.characterLooks?.[c.id] ?? '', description: data.characterDescriptions?.[c.id] ?? '',
        })),
    ]
}

// What lib/render.ts's Renderer reads - the film's own settings on top of the shared defaults (workflows, sequence sheets)
export function filmRenderConfig(config: FilmConfig): RenderConfig {
    return {...defaults, seed: config.seed, imageResolution: config.imageResolution, videoResolution: config.videoResolution, sequenceSheets: config.sequenceSheets}
}

/** Runs every render at once (the renderer queues them, one job per server) and throws afterwards if any failed. */
export async function renderAll<T>(items: T[], renderOne: (item: T) => Promise<unknown>) {
    const results = await Promise.allSettled(items.map(renderOne))
    const errors = results.flatMap(r => r.status === 'rejected' ? [r.reason instanceof Error ? r.reason.message : String(r.reason)] : [])
    if (!errors.length) return
    // e.g. "no server reachable" arrives once per render
    const unique = [...new Set(errors)]
    if (unique.length === 1) throw new Error(errors.length > 1 ? `${unique[0]} (${errors.length} renders)` : unique[0])
    for (const error of unique) log.warn(error)
    throw new Error(`${errors.length} of ${items.length} renders failed - see the warnings above`)
}
