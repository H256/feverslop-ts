import {existsSync, readdirSync, statSync} from "node:fs";
import {join} from "node:path";
import {pictureVersions} from "../archive.ts";
import {readCastingFile} from "../casting.ts";
import type {PictureJob} from "../render.ts";
import {readClipRequests, readPictureJobs} from "../render-state.ts";
import type {EditorTarget} from "./project.ts";
import {sequenceSheetDir, sheetAnchor, sheetFrames, sheetVideo} from "../sequenceSheet.ts";

// Every reference picture of a project: its prompt, its files, its older versions and the clips that use it.

const versioned = (dir: string, file: string) => existsSync(join(dir, file)) ? {file, v: Math.round(statSync(join(dir, file)).mtimeMs)} : undefined

export type EditorReference = {
    id: string, kind: PictureJob['kind'], name: string, prompt: string, description: string,
    file: string, picture?: { file: string, v: number }, anchor?: { file: string, v: number }, video?: { file: string, v: number },
    frames: { file: string, v: number }[],
    hasSheet: boolean,
    look?: { base: string, change: string },
    looks: string[],            // its other looks: drawn from its anchor, so a new anchor makes them stale
    library?: string,           // played by this asset of the library (casting.json): it is not rendered here
    clips: string[],
    versions: { id: string, picture: { file: string, v: number }, anchor?: { file: string, v: number }, video?: { file: string, v: number }, source: string, made: number, seed?: number, prompt?: string, fingerprint?: string }[],
    readsViews: boolean,        // a film's place without designed views: a new sheet is read again by the vision model
}

export const picturesFile = ({dir, kind}: EditorTarget) => kind === 'film' ? join(dir, 'assets.json') : join(dir, 'output', 'assets.json')
export const sheetOf = (picture: { kind: string, id: string }) => picture.kind === 'prop' ? undefined : sequenceSheetDir(picture.kind, picture.id)

export async function readReferences(target: EditorTarget): Promise<EditorReference[]> {
    const {dir, kind} = target
    const jobs = await readPictureJobs(picturesFile(target))
    const clips = await readClipRequests<{ id: string, assets: { pictures: { file: string }[] } }>(dir)
    let casting: { characters?: Record<string, string>, locations?: Record<string, string> } = {}
    try {
        casting = readCastingFile(dir)
    } catch {}
    return jobs.map(job => {
        const sheet = sheetOf(job)
        const framesDir = sheet ? join(dir, sheetFrames(sheet)) : undefined
        const entry = job.kind === 'character' ? casting.characters?.[job.id] : job.kind === 'location' ? casting.locations?.[job.id] : undefined
        return {
            id: job.id, kind: job.kind, name: job.name, prompt: job.prompt, description: job.description, file: job.file,
            picture: versioned(dir, job.file),
            anchor: sheet ? versioned(dir, sheetAnchor(sheet)) : undefined,
            video: sheet ? versioned(dir, sheetVideo(sheet)) : undefined,
            frames: framesDir && existsSync(framesDir) ? readdirSync(framesDir).filter(f => f.endsWith('.png')).sort().flatMap(f => versioned(dir, `${sheetFrames(sheet!)}/${f}`) ?? []) : [],
            hasSheet: !!sheet && existsSync(join(dir, sheet)),
            look: job.look,
            looks: jobs.filter(other => other.look?.base === job.id).map(other => other.id),
            library: entry?.startsWith('library:') ? entry.slice('library:'.length) : undefined,
            clips: clips.filter(clip => clip.assets.pictures.some(p => p.file === job.file || (sheet && p.file.startsWith(`${sheet}/`)))).map(clip => clip.id),
            versions: pictureVersions(dir, job).map(version => ({
                id: version.id, picture: versioned(dir, version.picture)!,
                anchor: version.anchor ? versioned(dir, version.anchor) : undefined,
                video: version.video ? versioned(dir, version.video) : undefined,
                source: version.source, made: version.made, seed: version.seed, prompt: version.prompt, fingerprint: version.fingerprint,
            })),
            readsViews: kind === 'film' && job.kind === 'location',
        }
    })
}
