import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {dirname, relative} from 'node:path'
import {clipVersions, pictureVersions, restoreClipVersion, restorePictureVersion} from '../archive.ts'
import {withProjectLock} from '../lock.ts'
import {clipRequestFile} from '../previous-output.ts'
import {readPictureJobs} from '../render-state.ts'
import {type EditorOverride, type EditorTarget, overrideFile} from './project.ts'
import {picturesFile, sheetOf} from './references.ts'
import {CLIP_ID} from './runs.ts'

// The choices made by hand on a rendered project, as the workspace makes them and the commands do (CLI first, #549): an older
// version of a clip or picture made the current one again, and a film clip's own choice of view and references. Nothing is
// rendered: what is current now is put away and stays selectable.

/** A clip or picture of the project by its id: a clip has a request, a picture is in the list of pictures. */
export async function versionTarget(
    target: EditorTarget,
    id: string,
): Promise<{kind: 'clip'} | {kind: 'picture'; job: Awaited<ReturnType<typeof readPictureJobs>>[number]} | undefined> {
    if (CLIP_ID.test(id) && existsSync(clipRequestFile(target.dir, id))) return {kind: 'clip'}
    const job = (await readPictureJobs(picturesFile(target))).find(p => p.id === id)
    return job ? {kind: 'picture', job} : undefined
}

/** The versions put away of a clip or picture, the newest first - undefined when there is no such clip or picture. */
export async function readVersions(target: EditorTarget, id: string) {
    const found = await versionTarget(target, id)
    if (!found) return undefined
    return found.kind === 'clip'
        ? {kind: 'clip' as const, versions: clipVersions(target.dir, id)}
        : {kind: 'picture' as const, versions: pictureVersions(target.dir, found.job)}
}

/** An older version made the current one: what is there now is put away (returned, relative to the project, with /). */
export async function pickVersion(target: EditorTarget, id: string, version: string): Promise<{picked: string; putAway: string}> {
    const found = await versionTarget(target, id)
    if (!found) throw new Error(`no clip or picture ${id}`)
    const result = await withProjectLock(target.dir, target.id, () =>
        found.kind === 'clip' ? restoreClipVersion(target.dir, id, version) : restorePictureVersion(target.dir, found.job, version, sheetOf(found.job)),
    )
    return {picked: version, putAway: relative(target.dir, result.putAway).replace(/\\/g, '/')}
}

/** A film clip's own choice: in clip-overrides/<clip>.json, read by the next plan run. */
export function readOverride(target: EditorTarget, clipId: string): EditorOverride | undefined {
    const file = overrideFile(target.dir, clipId)
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as EditorOverride) : undefined
}

/** A film clip's own choice written, or taken away (null, or nothing in it): it applies from the next plan run on. */
export async function writeOverride(target: EditorTarget, clipId: string, override: EditorOverride | null) {
    if (target.kind !== 'film') throw new Error('a choice per clip is for films so far')
    if (!CLIP_ID.test(clipId) || !existsSync(clipRequestFile(target.dir, clipId))) throw new Error(`no clip ${clipId}`)
    const file = overrideFile(target.dir, clipId)
    await withProjectLock(target.dir, target.id, () => {
        if (!override || (override.placeView === undefined && !override.order?.length && !override.without?.length)) rmSync(file, {force: true})
        else {
            mkdirSync(dirname(file), {recursive: true})
            writeFileSync(file, JSON.stringify(override, null, 2) + '\n')
        }
    })
}
