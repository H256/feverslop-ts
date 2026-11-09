import {copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, statSync, utimesSync, writeFileSync} from 'node:fs'
import {basename, dirname, join, relative} from 'node:path'
import {boundaryFrameAsset} from './compose.ts'
import {SHEET_ANCHOR, SHEET_VIDEO, sheetAnchor, sheetFrames, sheetVideo} from './sequenceSheet.ts'

/**
 * Puts files of a project away in <project>/old/attempts/<name>/ - for something that is rendered again (--again) and whose old version
 * is still wanted: to compare, or to put back (restoreVersion). Files that do not exist are skipped.
 */
export function archiveFiles(projectDir: string, name: string, files: string[]) {
    // two put-aways within one second (the time in the name) each get a folder of their own - a folder moved onto one that
    // is already there fails on Windows
    let keep = join(projectDir, 'old', 'attempts', name)
    for (let n = 2; existsSync(keep); n++) keep = join(projectDir, 'old', 'attempts', `${name}-${n}`)
    mkdirSync(keep, {recursive: true})
    for (const file of files) {
        const from = join(projectDir, file)
        if (existsSync(from)) renameSync(from, join(keep, basename(file)))
    }
    return keep
}

/** Archives every file below the given project-relative trees while preserving its directory structure. */
export function archiveTrees(projectDir: string, name: string, roots: string[]): string {
    const files = roots.flatMap(root => {
        const absolute = join(projectDir, root)
        if (!existsSync(absolute)) return []
        if (!statSync(absolute).isDirectory()) return [root]
        return (readdirSync(absolute, {recursive: true}) as string[])
            .map(file => join(absolute, file))
            .filter(file => existsSync(file) && statSync(file).isFile())
            .map(file => relative(projectDir, file))
    })
    if (!files.length) return ''
    let keep = join(projectDir, 'old', 'attempts', name)
    for (let n = 2; existsSync(keep); n++) keep = join(projectDir, 'old', 'attempts', `${name}-${n}`)
    for (const file of files) {
        const from = join(projectDir, file)
        const to = join(keep, file)
        mkdirSync(dirname(to), {recursive: true})
        renameSync(from, to)
    }
    return keep
}

/** A label for a version that is put away: the time, sortable and safe in a file name. */
export const versionStamp = () => new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')

const escapeId = (id: string) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const STAMP = '\\d{8}-\\d{6}'

/** The folder a version is in, relative to the project, with / also on Windows. */
const attempt = (folder: string) => `old/attempts/${folder}`

function readRecord(file: string): Record<string, unknown> {
    try {
        const parsed = JSON.parse(readFileSync(file, 'utf8'))
        return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
        return {}
    }
}

export type ClipVersion = {
    id: string // what to ask for it by: its place, relative to the project
    video: string
    firstFrame?: string
    lastFrame?: string
    source: 'again' | 'stale' | 'leak' | 'size' // includes takes rejected for an unexpected output size
    made: number // when it was rendered: the time of its file
    seed?: number
    workflow?: string
    size?: string
    fingerprint?: string
}

/**
 * Everything of a clip that is put away, the newest first. Three kinds of place, under different names:
 * old/attempts/<clip>-<time>[-n]/ from --again, old/attempts/stale-<time>-videos-<clip>.mp4[-n]/ from --refresh=clips,
 * old/leaks/<clip>-seed-<seed>.mp4 from the backdrop check.
 */
export function clipVersions(projectDir: string, clipId: string): ClipVersion[] {
    const versions: ClipVersion[] = []
    const again = new RegExp(`^${escapeId(clipId)}-${STAMP}(-\\d+)?$`)
    const stale = new RegExp(`^stale-${STAMP}-videos-${escapeId(clipId)}\\.mp4(-\\d+)?$`)
    const size = new RegExp(`^size-${STAMP}-videos-${escapeId(clipId)}\\.mp4(-\\d+)?$`)
    const attempts = join(projectDir, 'old', 'attempts')
    for (const folder of existsSync(attempts) ? readdirSync(attempts) : []) {
        const source = again.test(folder) ? 'again' : stale.test(folder) ? 'stale' : size.test(folder) ? 'size' : undefined
        const video = `${clipId}.mp4`
        if (!source || !existsSync(join(attempts, folder, video))) continue
        const record = readRecord(join(attempts, folder, `${video}.json`))
        const inFolder = (file: string) => (existsSync(join(attempts, folder, file)) ? `${attempt(folder)}/${file}` : undefined)
        versions.push({
            id: attempt(folder),
            video: `${attempt(folder)}/${video}`,
            firstFrame: inFolder(basename(boundaryFrameAsset(clipId, 'ff'))),
            lastFrame: inFolder(basename(boundaryFrameAsset(clipId, 'lf'))),
            source,
            made: statSync(join(attempts, folder, video)).mtimeMs,
            seed: typeof record.seed === 'number' ? record.seed : undefined,
            workflow: typeof record.workflow === 'string' ? record.workflow : undefined,
            size: typeof record.size === 'string' ? record.size : undefined,
            fingerprint: typeof record.fingerprint === 'string' ? record.fingerprint : undefined,
        })
    }
    const leaks = join(projectDir, 'old', 'leaks')
    const leak = new RegExp(`^${escapeId(clipId)}-seed-(\\d+)\\.mp4$`)
    for (const file of existsSync(leaks) ? readdirSync(leaks) : []) {
        const match = leak.exec(file)
        if (match)
            versions.push({
                id: `old/leaks/${file}`,
                video: `old/leaks/${file}`,
                source: 'leak',
                made: statSync(join(leaks, file)).mtimeMs,
                seed: Number(match[1]),
            })
    }
    return versions.sort((a, b) => b.made - a.made)
}

/** A file that goes back now counts as made now: what compares times (is the final video older than its clips?) would not see it otherwise. */
function putBack(from: string, to: string, now: Date) {
    mkdirSync(dirname(to), {recursive: true})
    renameSync(from, to)
    utimesSync(to, now, now)
}

/**
 * Makes a version the clip's current one: what is there now is put away first, the version's video, sidecar and first and last frame
 * go back together. A version from the backdrop check has only its video: its frames are made by the next run, and it has a sidecar
 * with its seed and nothing more - it was not compared with any plan.
 */
export function restoreClipVersion(projectDir: string, clipId: string, versionId: string): {putAway: string} {
    const version = clipVersions(projectDir, clipId).find(v => v.id === versionId)
    if (!version) throw new Error(`${clipId} has no version ${versionId}`)
    const video = `videos/${clipId}.mp4`
    const frames = [boundaryFrameAsset(clipId, 'ff'), boundaryFrameAsset(clipId, 'lf')]
    const putAway = archiveFiles(projectDir, `${clipId}-${versionStamp()}`, [video, `${video}.json`, ...frames])
    const now = new Date()
    if (version.source === 'leak') {
        putBack(join(projectDir, version.video), join(projectDir, video), now)
        writeFileSync(join(projectDir, `${video}.json`), JSON.stringify({seed: version.seed, restoredFrom: version.id}, null, 2))
        return {putAway}
    }
    const folder = join(projectDir, version.id)
    putBack(join(projectDir, version.video), join(projectDir, video), now)
    if (existsSync(join(folder, `${clipId}.mp4.json`))) putBack(join(folder, `${clipId}.mp4.json`), join(projectDir, `${video}.json`), now)
    else writeFileSync(join(projectDir, `${video}.json`), JSON.stringify({source: 'user', pinned: true, restoredFrom: version.id}, null, 2))
    for (const frame of frames) if (existsSync(join(folder, basename(frame)))) putBack(join(folder, basename(frame)), join(projectDir, frame), now)
    if (!readdirSync(folder).length) rmdirSync(folder)
    return {putAway}
}

export type PictureVersion = {
    id: string
    picture: string
    anchor?: string
    video?: string
    source: 'again' | 'stale' | 'library'
    made: number
    seed?: number
    prompt?: string
    fingerprint?: string
}

/** Everything of a picture that is put away, the newest first: old/attempts/<id>-<time>[-n]/, stale-<time>-assets-<kind>s-<id>.png[-n]/, <id>-library-<time>[-n]/. */
export function pictureVersions(projectDir: string, picture: {id: string; file: string}): PictureVersion[] {
    const name = basename(picture.file)
    const stale = new RegExp(`^stale-${STAMP}-${escapeId(picture.file.replace(/\//g, '-'))}(-\\d+)?$`)
    const again = new RegExp(`^${escapeId(picture.id)}-${STAMP}(-\\d+)?$`)
    const library = new RegExp(`^${escapeId(picture.id)}-library-${STAMP}(-\\d+)?$`)
    const attempts = join(projectDir, 'old', 'attempts')
    const versions: PictureVersion[] = []
    for (const folder of existsSync(attempts) ? readdirSync(attempts) : []) {
        const source = again.test(folder) ? 'again' : stale.test(folder) ? 'stale' : library.test(folder) ? 'library' : undefined
        if (!source || !existsSync(join(attempts, folder, name))) continue
        const record = readRecord(join(attempts, folder, `${name}.json`))
        const inFolder = (file: string) => (existsSync(join(attempts, folder, file)) ? `${attempt(folder)}/${file}` : undefined)
        // the sheet flat beside the picture, or - put away by an older version of the pipeline - in a folder by the picture's id
        const ofSheet = (file: string) => inFolder(file) ?? inFolder(`${picture.id}/${file}`)
        versions.push({
            id: attempt(folder),
            picture: `${attempt(folder)}/${name}`,
            anchor: ofSheet(SHEET_ANCHOR),
            video: ofSheet(SHEET_VIDEO),
            source,
            made: statSync(join(attempts, folder, name)).mtimeMs,
            seed: typeof record.seed === 'number' ? record.seed : undefined,
            prompt: typeof record.prompt === 'string' ? record.prompt : undefined,
            fingerprint: typeof record.fingerprint === 'string' ? record.fingerprint : undefined,
        })
    }
    return versions.sort((a, b) => b.made - a.made)
}

/**
 * The files of a picture as they lie in a project: the picture, and with a reference sheet in `sheet` its anchor, sequence video and
 * frames. A put-away folder has them flat, by their names.
 */
export function pictureFiles(projectDir: string, picture: {file: string}, sheet?: string): string[] {
    const files = [picture.file, `${picture.file}.json`]
    if (!sheet) return files
    files.push(sheetVideo(sheet), `${sheetVideo(sheet)}.json`, sheetAnchor(sheet), `${sheetAnchor(sheet)}.json`)
    const frames = join(projectDir, sheetFrames(sheet))
    if (existsSync(frames)) files.push(...readdirSync(frames).map(f => `${sheetFrames(sheet)}/${f}`))
    return files
}

/** Makes a version the picture's current one: all of what is there now is put away first, all of the version goes back. */
export function restorePictureVersion(projectDir: string, picture: {id: string; file: string}, versionId: string, sheet?: string): {putAway: string} {
    const version = pictureVersions(projectDir, picture).find(v => v.id === versionId)
    if (!version) throw new Error(`${picture.id} has no version ${versionId}`)
    const putAway = archiveFiles(projectDir, `${picture.id}-${versionStamp()}`, pictureFiles(projectDir, picture, sheet))
    const folder = join(projectDir, version.id)
    const now = new Date()
    const name = basename(picture.file)
    for (const file of readdirSync(folder)) {
        const from = join(folder, file)
        if (!statSync(from).isFile()) continue
        if (file === name || file === `${name}.json`) putBack(from, join(projectDir, dirname(picture.file), file), now)
        else if (sheet) putBack(from, join(projectDir, sheet, /^(sequence\.mp4|anchor\.png)(\.json)?$/.test(file) ? file : `frames/${file}`), now)
    }
    // put away by an older version of the pipeline: the sheet as a folder of its own, by the picture's id (<id>/anchor.png,
    // sequence.mp4, frames/) - it goes back as it lies
    const nested = sheet ? join(folder, picture.id) : undefined
    if (nested && existsSync(nested) && statSync(nested).isDirectory()) {
        for (const file of readdirSync(nested, {recursive: true}) as string[]) {
            if (statSync(join(nested, file)).isFile()) putBack(join(nested, file), join(projectDir, sheet!, file), now)
        }
        rmSync(nested, {recursive: true, force: true})
    }
    if (!readdirSync(folder).length) rmdirSync(folder)
    // a version put away before versions kept their anchor (a sheet made again on the same anchor) has none: the anchor that was
    // there goes back rather than none - a sheet without its anchor cannot be made again
    if (sheet)
        for (const file of [SHEET_ANCHOR, `${SHEET_ANCHOR}.json`]) {
            const target = join(projectDir, sheet, file)
            if (!existsSync(target) && existsSync(join(putAway, file))) copyFileSync(join(putAway, file), target)
        }
    return {putAway}
}
