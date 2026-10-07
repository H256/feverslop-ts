import {existsSync, readFileSync} from "node:fs";
import {join} from "node:path";
import type {FilmConfig} from "./config.ts";
import {defaults, type RenderConfig} from "../config.ts";
import {log} from "../log.ts";
import type {PictureJob} from "../render.ts";
import type {FilmCast, FilmProject} from "./types.ts";

// the same place the music-video pipeline keeps its reference pictures, inside films/<id>/
export const filmPictureAsset = (kind: 'character' | 'location', id: string) => `assets/${kind}s/${id}.png`

/** A character in another look has the picture of its own: <character id>--<state id>. */
export const statePictureId = (characterId: string, stateId: string) => `${characterId}--${stateId}`

// baseId: the character this picture is another look of - drawn with the seed of the normal picture, which keeps the face
export type FilmPictureJob = PictureJob & { baseId?: string }

/** The reference pictures of a film: every location, and every character who is ever seen (not a narrator's voice). */
export function filmPictures(cast: FilmCast, data: Pick<FilmProject, 'characterLooks' | 'characterDescriptions' | 'locationLooks' | 'locationDescriptions'>): FilmPictureJob[] {
    return [
        ...cast.locations.map(l => ({
            kind: 'location' as const, id: l.id, file: filmPictureAsset('location', l.id), name: l.name,
            prompt: data.locationLooks?.[l.id] ?? '', description: data.locationDescriptions?.[l.id] ?? '',
        })),
        ...cast.characters.filter(c => !c.voiceOnly).map(c => ({
            kind: 'character' as const, id: c.id, file: filmPictureAsset('character', c.id), name: c.name,
            prompt: data.characterLooks?.[c.id] ?? '', description: data.characterDescriptions?.[c.id] ?? '',
        })),
        ...cast.characters.filter(c => !c.voiceOnly).flatMap(c => (c.states ?? []).map(s => ({
            kind: 'character' as const, id: statePictureId(c.id, s.id), baseId: c.id, file: filmPictureAsset('character', statePictureId(c.id, s.id)), name: `${c.name} (${s.name})`,
            prompt: data.characterLooks?.[statePictureId(c.id, s.id)] ?? '', description: data.characterDescriptions?.[statePictureId(c.id, s.id)] ?? '',
        }))),
    ]
}

/** The seed the normal picture of a character was drawn with (read from what was saved next to it) - undefined while it is not rendered. */
export function pictureSeed(projectDir: string, characterId: string): number | undefined {
    for (const file of [`assets/characters/${characterId}.png.json`, `assets/sequence/characters/${characterId}/anchor.png.json`]) {
        const path = join(projectDir, file)
        if (existsSync(path)) {
            const seed = JSON.parse(readFileSync(path, 'utf8')).seed
            if (Number.isInteger(seed)) return seed
        }
    }
}

// What lib/render.ts's Renderer reads - the film's own settings on top of the shared defaults (workflows, sequence sheets)
export function filmRenderConfig(config: FilmConfig): RenderConfig {
    // the film has its own video workflow: no audio goes in (comfy/workflows/h3-ref2video-film.ts)
    return {...defaults, videoWorkflow: 'h3-ref2video-film', seed: config.seed, imageResolution: config.imageResolution, videoResolution: config.videoResolution, sequenceSheets: config.sequenceSheets}
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
