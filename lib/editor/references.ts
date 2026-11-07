import {existsSync, readdirSync, statSync} from "node:fs";
import {join} from "node:path";
import {pictureVersions} from "../archive.ts";
import {readCastingFile} from "../casting.ts";
import {isOwnFile, recordedEditedPrompt} from "../provenance.ts";
import type {PictureJob} from "../render.ts";
import {readClipRequests, readPictureJobs} from "../render-state.ts";
import type {EditorTarget} from "./project.ts";
import {sequenceSheetDir, sheetAnchor, sheetFrames, sheetVideo} from "../sequenceSheet.ts";
import type {EditorReference} from '../../shared/workspace.ts';
export type {EditorReference} from '../../shared/workspace.ts';

// Every reference picture of a project: its prompt, its files, its older versions and the clips that use it.

const versioned = (dir: string, file: string) => existsSync(join(dir, file)) ? {file, v: Math.round(statSync(join(dir, file)).mtimeMs)} : undefined


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
        const anchorFile = sheet ? join(dir, sheetAnchor(sheet)) : undefined
        const entry = job.kind === 'character' ? casting.characters?.[job.id] : job.kind === 'location' ? casting.locations?.[job.id] : undefined
        return {
            id: job.id, kind: job.kind, name: job.name, prompt: job.prompt, description: job.description, file: job.file,
            picture: versioned(dir, job.file),
            anchor: sheet ? versioned(dir, sheetAnchor(sheet)) : undefined,
            video: sheet ? versioned(dir, sheetVideo(sheet)) : undefined,
            frames: framesDir && existsSync(framesDir) ? readdirSync(framesDir).filter(f => f.endsWith('.png')).sort().flatMap(f => versioned(dir, `${sheetFrames(sheet!)}/${f}`) ?? []) : [],
            hasSheet: !!sheet && existsSync(join(dir, sheet)),
            editedPrompt: recordedEditedPrompt(join(dir, job.file)) ?? (anchorFile && recordedEditedPrompt(anchorFile)),
            ownPicture: isOwnFile(join(dir, job.file)),
            ownAnchor: !!anchorFile && isOwnFile(anchorFile),
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
