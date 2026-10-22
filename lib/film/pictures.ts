import {existsSync, readFileSync} from "node:fs";
import {join} from "node:path";
import type {FilmConfig} from "./config.ts";
import {defaults, type RenderConfig} from "../config.ts";
import {log} from "../log.ts";
import type {PictureJob} from "../render.ts";
import type {FilmCast, FilmProject} from "./types.ts";

// the same place the music-video pipeline keeps its reference pictures, inside films/<id>/
export const filmPictureAsset = (kind: 'character' | 'location', id: string) => `assets/${kind}s/${id}.png`

/** One view of a location's reference sheet as a picture of its own (view 1..5 = frame 0..4 of the sheet video) - the video model gets the one view, not the grid. */
export const locationViewAsset = (id: string, view: number) => `assets/sequence/locations/${id}/frames/frame_${String(view - 1).padStart(2, '0')}.png`

/** A character in another look has the picture of its own: <character id>--<state id>. */
export const statePictureId = (characterId: string, stateId: string) => `${characterId}--${stateId}`

// baseId: the character this picture is another look of - drawn with the seed of the normal picture, which keeps the face
export type FilmPictureJob = PictureJob & { baseId?: string }

/** The reference pictures of a film: every location, and every character who is ever seen (not a narrator's voice). */
export function filmPictures(cast: FilmCast, data: Pick<FilmProject, 'characterLooks' | 'characterDescriptions' | 'locationLooks' | 'locationDescriptions'> & Pick<Partial<FilmProject>, 'locationViews'>): FilmPictureJob[] {
    return [
        ...cast.locations.map(l => ({
            kind: 'location' as const, id: l.id, file: filmPictureAsset('location', l.id), name: l.name,
            prompt: data.locationLooks?.[l.id] ?? '', description: data.locationDescriptions?.[l.id] ?? '',
            // the four views after the first, as the sheet's video is asked to cut to them
            ...(data.locationViews?.[l.id]?.length === 5 ? {views: data.locationViews[l.id]!.slice(1).map(v => v.shows)} : {}),
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

// What lib/render.ts's Renderer reads - the film's own settings on top of the shared defaults (sequence sheets' workflow)
export function filmRenderConfig(config: FilmConfig): RenderConfig {
    return {...defaults, imageWorkflow: config.imageWorkflow, videoWorkflow: config.videoWorkflow, seed: config.seed, imageResolution: config.imageResolution, videoResolution: config.videoResolution, videoAspect: config.videoAspect, sequenceSheets: config.sequenceSheets, contextFrames: config.contextFrames, leakRetries: config.leakRetries, finalFps: config.finalFps, interpolationModel: config.interpolationModel, finish: config.finish}
}

export {renderAll} from "../batch.ts"
