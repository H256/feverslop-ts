import {existsSync, readdirSync, readFileSync, statSync} from "node:fs";
import {isAbsolute, join, relative} from "node:path";
import {probeVideo} from "../assemble.ts";
import {boundaryFrameAsset, type ClipRequest} from "../compose.ts";
import {loadProjectConfig} from "../config.ts";
import {FPS, secondsAt} from "../frames.ts";
import type {Project} from "../project.ts";
import {type Freshness, freshness} from "../provenance.ts";
import {plainText} from "../refs.ts";
import {clipFingerprint, pictureFingerprint, type PictureJob} from "../render.ts";
import {type FinalState, finalStateOf, readClipRequests, readPictureJobs} from "../render-state.ts";
import {lastRun, type RunState, runState} from "../run-record.ts";
import {explainFailure, type Explained} from "./progress.ts";
import {asBeatShots} from "../shot-plan.ts";
import type {FilmClipRequest} from "../film/compose.ts";
import {loadFilmConfig} from "../film/config.ts";
import {filmRenderConfig, placeViewFrame} from "../film/pictures.ts";
import {filmClipFingerprint, filmClipFreshness, filmClipSpans} from "../film/render.ts";
import type {FilmProject} from "../film/types.ts";
import {withExtraViews} from "../film/views.ts";
import {clipRequestFile, clipRequestsDir} from "../previous-output.ts";

// What the workspace shows of one music video or film, in one shape for both: read from the project folder at every request,
// nothing kept. The fast part (/api/project) only looks at which files are there; whether they are stale means hashing every
// reference picture, so that comes separately (/api/freshness) and fills in once the page is up.

export type EditorKind = 'music' | 'film'
export type EditorPerson = { name: string, text: string }
export type EditorShot = { label: string, at: number, framing: string, camera: string, subjects: string[], action?: string, people: EditorPerson[] }
// a sung or spoken line: seconds from the clip's start
export type EditorLine = { at: number, end?: number, text: string, who: string }
export type EditorPicture = { id: string, label: string, file: string, kind: string, name: string, subject: string, description: string, exists: boolean, v?: number }
export type EditorMark = { kind: 'failed' | 'backdrop' | 'backdrop-attempt' | 'older-start' | 'dropped', text: string }
// a film: the views of its place the clip can be given, and the one it has
export type EditorViews = { locationId: string, chosen?: number, options: { n: number, name: string, shows: string, file: string, v?: number }[] }
export type EditorOverride = { placeView?: number, order?: string[], without?: string[] }
export type EditorClip = {
    id: string,
    frameStart: number,
    frames: number,
    start: number,              // seconds on the whole video's timeline
    end: number,
    group: string,              // the section of a song, the scene of a film
    context: { label: string, text?: string, staging?: string },    // the beat or scene it comes from
    startsFrom?: string,
    next?: string,              // the clip that goes on from this one
    prompt: string,
    shots: EditorShot[],
    lines: EditorLine[],
    pictures: EditorPicture[],
    audio: { label: string, stem?: string, songStart: number, songEnd: number }[],
    dropped: string[],
    video?: { file: string, v: number, workflow?: string, size?: string, seed?: number, renderedFrames?: number },
    firstFrame?: { file: string, v: number },
    lastFrame?: { file: string, v: number },
    marks: EditorMark[],
    views?: EditorViews,
    override?: EditorOverride,
    preview?: { file: string, v: number, approximate?: boolean },
    refined: { variant: string, file: string, v: number, size?: string, seed?: number, denoise?: number }[],     // larger versions of it (bun run refinish)
}
export type EditorGroup = { id: string, label: string, start: number, end: number }
export type EditorProject = {
    id: string,
    kind: EditorKind,
    title: string,
    fps: number,
    seconds: number,
    bpm?: number,
    song?: { file: string, v: number },     // what plays under the whole video: only when the final video has it too
    groups: EditorGroup[],
    clips: EditorClip[],
    pictures: { id: string, kind: string, name: string, file: string, exists: boolean, v?: number }[],
    final: { state: FinalState, file?: string, v?: number },
    previewVideo?: { file: string, v: number },
    refinedVariants: string[],
    finals: EditorFinal[],      // every finished video there is of it: the final one, finished, at another frame rate
    lastRun?: { state: RunState, command: string, startedAt: string, failures: string[], explained: Explained[] },
    command: string,            // how this project is run, for the commands the page shows
}

export type EditorFinal = { file: string, v: number, label: string, state: FinalState, preview: boolean, width?: number, height?: number, fps?: number }

export type EditorTarget = { id: string, dir: string, kind: EditorKind }

/** The modification time of a file: part of its address, so that the page shows a file that changed - nothing else depends on it. */
const versionOf = (file: string) => Math.round(statSync(file).mtimeMs)
const media = (dir: string, file: string) => existsSync(join(dir, file)) ? {file, v: versionOf(join(dir, file))} : undefined

const readJson = <T>(file: string): T | undefined => existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as T : undefined

type VideoInfo = Awaited<ReturnType<typeof probeVideo>>
type Sidecar = { workflow?: string, size?: string, seed?: number, renderedFrames?: number }
const videoOf = (dir: string, id: string): EditorClip['video'] => {
    const file = `videos/${id}.mp4`
    const found = media(dir, file)
    if (!found) return undefined
    const {workflow, size, seed, renderedFrames} = (() => {
        try {
            return readJson<Sidecar>(join(dir, `${file}.json`)) ?? {}
        } catch {
            return {}       // a run is just writing it
        }
    })()
    return {...found, workflow, size, seed, renderedFrames}
}

const pictureOf = (dir: string) => (p: { id: string, label: string, file: string, kind: string, name: string, subject: string, description: string }): EditorPicture => {
    const found = media(dir, p.file)
    return {id: p.id, label: p.label, file: p.file, kind: p.kind, name: p.name, subject: p.subject, description: p.description, exists: !!found, ...(found ? {v: found.v} : {})}
}

const picturesOf = (dir: string, jobs: PictureJob[]) => jobs.map(p => {
    const found = media(dir, p.file)
    return {id: p.id, kind: p.kind, name: p.name, file: p.file, exists: !!found, ...(found ? {v: found.v} : {})}
})

/** Runs of clips of one section or scene, as they follow each other on the timeline. */
export function groupsOf(clips: EditorClip[], label: (id: string) => string): EditorGroup[] {
    const groups: EditorGroup[] = []
    for (const clip of clips) {
        const last = groups.at(-1)
        if (last?.id === clip.group) last.end = clip.end
        else groups.push({id: clip.group, label: label(clip.group), start: clip.start, end: clip.end})
    }
    return groups
}

const probed = new Map<string, Promise<VideoInfo | undefined>>()
/** What a video is, asked of ffprobe once per version of the file. */
const probedVideo = (file: string, v: number) => {
    const key = `${file}:${v}`
    if (!probed.has(key)) probed.set(key, probeVideo(file).catch(() => undefined))
    return probed.get(key)!
}

/** <id>.mp4, <id>-48fps.mp4, <id>-finished.mp4, <id>-48fps-finished.mp4, <id>-preview.mp4: what name a video has says what it is. Partial try-outs do not lie on the timeline. */
export function finalLabel(id: string, name: string): { label: string, preview: boolean, order: number } | undefined {
    if (!name.startsWith(id) || !name.endsWith('.mp4')) return undefined
    // <id>--<variant>[-48fps][-finished].mp4: bun run refinish
    const match = /^(?:--([a-z0-9.-]+?))?(-preview)?(?:-(\d+)fps)?(-finished)?$/.exec(name.slice(id.length, -'.mp4'.length))
    if (!match) return undefined
    const variant = match[1]
    const preview = !!match[2]
    const fps = match[3] ? Number(match[3]) : 0
    const label = preview ? 'Preview video' : [variant ? (variant === 'original' ? 'Refinish' : `Refinish ${variant}`) : 'Final', fps ? `${fps} fps` : '', match[4] ? 'finished' : ''].filter(Boolean).join(' ')
    return {label, preview, order: (preview ? 20000 : variant ? 10000 : 0) + fps * 2 + (match[4] ? 1 : 0)}
}

async function finalsOf(dir: string, id: string, clips: { id: string }[]): Promise<EditorFinal[]> {
    const found = readdirSync(dir).flatMap(name => {
        const about = finalLabel(id, name)
        return about && statSync(join(dir, name)).isFile() ? [{name, ...about}] : []
    }).sort((a, b) => a.order - b.order)
    return Promise.all(found.map(async ({name, label, preview}) => {
        const {file, v} = media(dir, name)!
        const info = await probedVideo(join(dir, name), v)
        return {file, v, label, preview, state: finalStateOf(dir, join(dir, name), clips), ...(info ? {width: info.width, height: info.height, fps: info.fps} : {})}
    }))
}

const previewVideoOf = (dir: string, id: string) => media(dir, `${id}-preview.mp4`)

const finalOf = (dir: string, id: string, clips: { id: string }[]): EditorProject['final'] => {
    const state = finalStateOf(dir, join(dir, `${id}.mp4`), clips)
    return {state, ...(media(dir, `${id}.mp4`) ?? {})}
}

const lastRunOf = (dir: string): EditorProject['lastRun'] => {
    const run = lastRun(dir)
    if (!run) return undefined
    const failures = run.failures ?? (run.error ? [run.error] : [])
    // one explanation of each kind: forty clips out of memory are one thing to do
    const explained = [...new Map(failures.flatMap(failure => explainFailure(failure) ?? []).map(found => [found.text, found])).values()]
    return {state: runState(run), command: run.command, startedAt: run.startedAt, failures, explained}
}

type Scan = { clips?: Record<string, { video: number, from: number, to: number, samples: number }> }

/** What is known against a clip, read from what is on disk - nothing here starts a scan or asks a model. */
function marksOf(dir: string, clip: { id: string, startsFrom?: string, dropped?: string[] }, run: EditorProject['lastRun'], scan: Scan): EditorMark[] {
    const marks: EditorMark[] = []
    const video = join(dir, 'videos', `${clip.id}.mp4`)
    const rendered = existsSync(video)
    if (run?.state === 'failed') for (const failure of run.failures) if (failure.includes(`clip ${clip.id}:`)) marks.push({kind: 'failed', text: failure})
    // found in this very file - a scan of an older version says nothing about this one
    const found = scan.clips?.[clip.id]
    if (found && rendered && found.video === Math.round(statSync(video).mtimeMs)) marks.push({kind: 'backdrop', text: `Grey studio backdrop, ${found.from.toFixed(1)} - ${found.to.toFixed(1)} s`})
    const leaks = join(dir, 'old', 'leaks')
    const attempts = existsSync(leaks) ? readdirSync(leaks).filter(f => f.startsWith(`${clip.id}-seed-`)).length : 0
    if (attempts) marks.push({kind: 'backdrop-attempt', text: `${attempts} earlier attempt${attempts > 1 ? 's' : ''} had a grey backdrop and ${attempts > 1 ? 'were' : 'was'} rendered again`})
    if (clip.startsFrom && rendered) {
        const frame = join(dir, boundaryFrameAsset(clip.startsFrom, 'lf'))
        if (existsSync(frame) && statSync(frame).mtimeMs > statSync(video).mtimeMs) marks.push({kind: 'older-start', text: `Starts on an older version of the last frame of ${clip.startsFrom}`})
    }
    if (clip.dropped?.length) marks.push({kind: 'dropped', text: `No picture for lack of room: ${clip.dropped.join(', ')}`})
    return marks
}

const readScan = (dir: string): Scan => {
    try {
        return readJson<Scan>(join(dir, 'output', 'leak-scan.json')) ?? {}
    } catch {
        return {}
    }
}

/** A clip's choice of the view of its place and its references: a small file per clip, only there when something was chosen. */
export const overrideFile = (dir: string, clipId: string) => join(dir, 'clip-overrides', `${clipId}.json`)
const overrideOf = (dir: string, clipId: string): EditorOverride | undefined => {
    try {
        return readJson<EditorOverride>(overrideFile(dir, clipId))
    } catch {
        return undefined
    }
}

const previewOf = (dir: string, clipId: string): EditorClip['preview'] => {
    const found = media(dir, `previews/${clipId}.mp4`)
    if (!found) return undefined
    try {
        return {...found, approximate: readJson<{ approximate?: boolean }>(join(dir, `previews/${clipId}.mp4.json`))?.approximate}
    } catch {
        return found
    }
}

const refinedVariantsOf = (dir: string) => {
    const folder = join(dir, 'videos', 'refined')
    return existsSync(folder) ? readdirSync(folder).filter(name => statSync(join(folder, name)).isDirectory()).sort() : []
}
const refinedOf = (dir: string, clipId: string, variants: string[]): EditorClip['refined'] => variants.flatMap(variant => {
    const found = media(dir, `videos/refined/${variant}/${clipId}.mp4`)
    if (!found) return []
    const record = (() => {
        try {
            return readJson<{ size?: string, seed?: number, denoise?: number }>(join(dir, `${found.file}.json`)) ?? {}
        } catch {
            return {}
        }
    })()
    return [{variant, ...found, size: record.size, seed: record.seed, denoise: record.denoise}]
})

const withNext = (clips: EditorClip[]) => clips.map(clip => {
    const next = clips.find(c => c.startsFrom === clip.id)?.id
    return next ? {...clip, next} : clip
})

/** The file the song is in, relative to the project - only inside it: the page is served nothing else. */
function songFileOf(dir: string, song: string | undefined) {
    if (!song) return undefined
    const inside = relative(dir, song.replace(/\\/g, '/')).replace(/\\/g, '/')
    return inside.startsWith('..') || isAbsolute(inside) ? undefined : media(dir, inside)
}

async function musicProject({id, dir}: EditorTarget): Promise<EditorProject> {
    const requests = await readClipRequests<ClipRequest>(dir)
    const data = readJson<Project>(join(dir, 'project.json')) ?? {}
    const config = await loadProjectConfig(dir)
    const timeline = readJson<{ song?: string, bpm?: number, durationSec?: number }>(join(dir, 'output', 'timeline.json')) ?? {}
    const characters = data.cast?.characters ?? []
    const plain = (text: string) => plainText(text, characters)
    const nameOf = (characterId: string) => characters.find(c => c.id === characterId)?.name ?? characterId
    // the clips of a beat follow each other: the shots of its clips before this one come first
    const shotsDone = new Map<string, number>()
    const run = lastRunOf(dir)
    const scan = readScan(dir)
    const variants = refinedVariantsOf(dir)
    const clips = requests.map((clip): EditorClip => {
        const beat = data.beats?.find(b => b.id === clip.beatId)
        const plan = data.shotMoments?.[clip.beatId] && asBeatShots(data.shotMoments[clip.beatId]!)
        const offset = shotsDone.get(clip.beatId) ?? 0
        shotsDone.set(clip.beatId, offset + clip.shots.length)
        const start = secondsAt(clip.frameStart)
        return {
            id: clip.id,
            frameStart: clip.frameStart,
            frames: clip.frames,
            start,
            end: start + secondsAt(clip.frames),
            group: clip.section,
            context: {label: clip.beatId, text: beat?.summary && plain(beat.summary), staging: plan?.staging && plain(plan.staging)},
            startsFrom: clip.startsFrom,
            prompt: clip.prompt,
            shots: clip.shots.map((shot, n) => {
                const planned = plan?.shots[offset + n]
                return {
                    label: shot.label, at: shot.at, framing: planned?.framing ?? shot.framing, camera: shot.camera, subjects: shot.subjects,
                    action: planned?.action && plain(planned.action),
                    people: Object.entries(planned?.people ?? {}).map(([person, p]) => ({name: nameOf(person), text: [p.state, p.frame, p.motion].filter(Boolean).join(' · ')})),
                }
            }),
            lines: (clip.vocals ?? []).map(v => ({at: v.at, end: v.end, text: v.text, who: v.singers.map(s => s.subject).join(', ')})),
            pictures: clip.assets.pictures.map(pictureOf(dir)),
            audio: clip.assets.audio.map(a => ({label: a.label, stem: a.stem, songStart: a.songStart, songEnd: a.songEnd})),
            dropped: clip.dropped ?? [],
            video: videoOf(dir, clip.id),
            firstFrame: media(dir, boundaryFrameAsset(clip.id, 'ff')),
            lastFrame: media(dir, boundaryFrameAsset(clip.id, 'lf')),
            marks: marksOf(dir, clip, run, scan),
            preview: previewOf(dir, clip.id),
            refined: refinedOf(dir, clip.id, variants),
        }
    })
    const end = clips.at(-1)?.end ?? 0
    return {
        id, kind: 'music', title: id, fps: FPS,
        seconds: Math.max(timeline.durationSec ?? 0, end),
        bpm: timeline.bpm,
        // with "songAudio": false the final video has the clips' own sound, and so has this
        ...(config.songAudio ? {song: songFileOf(dir, timeline.song)} : {}),
        groups: groupsOf(clips, group => group),
        clips: withNext(clips),
        pictures: picturesOf(dir, await readPictureJobs(join(dir, 'output', 'assets.json'))),
        final: finalOf(dir, id, requests),
        previewVideo: previewVideoOf(dir, id),
        refinedVariants: variants,
        finals: existsSync(dir) ? await finalsOf(dir, id, requests) : [],
        lastRun: run,
        command: `bun index.ts ${id}`,
    }
}

async function filmProject({id, dir}: EditorTarget): Promise<EditorProject> {
    const requests = await readClipRequests<FilmClipRequest>(dir)
    const data = readJson<FilmProject>(join(dir, 'project.json')) ?? {}
    const characters = data.cast?.characters ?? []
    const nameOf = (characterId: string) => characters.find(c => c.id === characterId)?.name ?? characterId
    const sceneOf = (sceneId: string) => data.screenplay?.scenes.find(s => s.id === sceneId)
    const sceneLabel = (sceneId: string) => {
        const scene = sceneOf(sceneId)
        return scene ? `${sceneId} · ${scene.location}` : sceneId
    }
    const shotsDone = new Map<string, number>()
    const run = lastRunOf(dir)
    const scan = readScan(dir)
    const variants = refinedVariantsOf(dir)
    const viewsOf = (clip: FilmClipRequest): EditorViews | undefined => {
        const location = clip.assets.pictures.find(p => p.kind === 'location')
        if (!location) return undefined
        const known = data.locationViews?.[location.id] ?? data.sheetViews?.[location.id]?.views
        if (!known?.length) return undefined
        const options = withExtraViews(dir, {[location.id]: known})[location.id]!.map((view, n) => {
            const file = 'file' in view ? view.file : placeViewFrame(location.id, n + 1)
            return {n: n + 1, name: view.name, shows: view.shows, file, v: media(dir, file)?.v}
        })
        return {locationId: location.id, chosen: options.find(o => o.file === location.file)?.n, options}
    }
    // on the timeline a clip is where the film has it: the final video and the clips have to agree
    const spans = filmClipSpans(dir, requests)
    const clips = requests.map((clip, n): EditorClip => {
        const coverage = data.coverage?.find(c => c.sceneId === clip.sceneId)
        const offset = shotsDone.get(clip.sceneId) ?? 0
        shotsDone.set(clip.sceneId, offset + clip.shots.length)
        const start = secondsAt(spans[n]!.start)
        const seconds = secondsAt(spans[n]!.frames)
        const scene = sceneOf(clip.sceneId)
        return {
            id: clip.id,
            frameStart: clip.frameStart,
            frames: clip.frames,
            start,
            end: start + seconds,
            group: clip.sceneId,
            context: {label: clip.sceneId, text: scene && `${scene.setting} ${scene.location} - ${scene.time}`, staging: coverage?.staging},
            startsFrom: clip.startsFrom,
            prompt: clip.prompt,
            shots: clip.shots.map((shot, n) => {
                const planned = coverage?.shots[offset + n]
                return {
                    label: shot.label, at: shot.at, framing: planned?.framing ?? shot.framing, camera: planned?.camera ?? shot.camera, subjects: shot.subjects,
                    action: planned?.action,
                    people: Object.entries(planned?.people ?? {}).map(([person, p]) => ({name: nameOf(person), text: [p.state, p.frame, p.motion].filter(Boolean).join(' · ')})),
                }
            }),
            // a line only knows the start of its shot: it lasts until the next one, or to the end of the clip
            lines: clip.dialogue.map((line, n) => ({at: line.at, end: clip.dialogue[n + 1]?.at ?? seconds, text: line.text, who: line.speaker})),
            pictures: clip.assets.pictures.map(pictureOf(dir)),
            audio: [],
            dropped: [],
            video: videoOf(dir, clip.id),
            firstFrame: media(dir, boundaryFrameAsset(clip.id, 'ff')),
            lastFrame: media(dir, boundaryFrameAsset(clip.id, 'lf')),
            marks: marksOf(dir, clip, run, scan),
            views: viewsOf(clip),
            override: overrideOf(dir, clip.id),
            preview: previewOf(dir, clip.id),
            refined: refinedOf(dir, clip.id, variants),
        }
    })
    return {
        id, kind: 'film', title: data.screenplay?.title ?? data.brief?.title ?? id, fps: FPS,
        seconds: clips.at(-1)?.end ?? 0,
        groups: groupsOf(clips, sceneLabel),
        clips: withNext(clips),
        pictures: picturesOf(dir, await readPictureJobs(join(dir, 'assets.json'))),
        final: finalOf(dir, id, requests),
        previewVideo: previewVideoOf(dir, id),
        refinedVariants: variants,
        finals: existsSync(dir) ? await finalsOf(dir, id, requests) : [],
        lastRun: run,
        command: `bun film.ts ${id}`,
    }
}

export const readEditorProject = (target: EditorTarget) => target.kind === 'film' ? filmProject(target) : musicProject(target)

export type EditorFreshness = { clips: Record<string, Freshness>, pictures: Record<string, Freshness> }

/** Which rendered clips and pictures were made from another request than the plan has now. Hashes every reference picture a clip has, once. */
export async function readEditorFreshness({dir, kind}: EditorTarget): Promise<EditorFreshness> {
    const rendered = (file: string) => existsSync(join(dir, file))
    if (kind === 'film') {
        const config = filmRenderConfig(await loadFilmConfig(dir))
        const clips = await readClipRequests<FilmClipRequest>(dir)
        const pictures = await readPictureJobs(join(dir, 'assets.json'))
        return {
            clips: Object.fromEntries(clips.filter(c => rendered(`videos/${c.id}.mp4`)).map(c => [c.id, filmClipFreshness(c, dir, config)])),
            pictures: Object.fromEntries(pictures.filter(p => rendered(p.file)).map(p => [p.id, freshness(join(dir, p.file), pictureFingerprint(p, dir, config))])),
        }
    }
    const config = await loadProjectConfig(dir)
    const clips = await readClipRequests<ClipRequest>(dir)
    const pictures = await readPictureJobs(join(dir, 'output', 'assets.json'))
    return {
        clips: Object.fromEntries(clips.filter(c => rendered(`videos/${c.id}.mp4`)).map(c => [c.id, freshness(join(dir, 'videos', `${c.id}.mp4`), clipFingerprint(c, dir, config))])),
        pictures: Object.fromEntries(pictures.filter(p => rendered(p.file)).map(p => [p.id, freshness(join(dir, p.file), pictureFingerprint(p, dir, config))])),
    }
}

/** The id of the request a clip is rendered from now - a version with another one was made from another plan. */
export async function clipRequestId({dir, kind}: EditorTarget, clipId: string): Promise<string | undefined> {
    const request = readJson<ClipRequest & FilmClipRequest>(clipRequestFile(dir, clipId))
    if (!request) return undefined
    return kind === 'film' ? filmClipFingerprint(request, dir, filmRenderConfig(await loadFilmConfig(dir))) : clipFingerprint(request, dir, await loadProjectConfig(dir))
}

/**
 * Which projects are takes of one thing, from their ids alone: everything from a date on (schwarzer-flur-261026-sing-c), else a letter or number at the end (witch-test-3, -b).
 * A wrong guess only folds or unfolds a card.
 */
export function projectGroup(id: string): string {
    const dated = /^(.+?)-\d{6,}(?:-.*)?$/.exec(id)
    if (dated) return dated[1]!
    return id.replace(/-(?:\d{1,2}|[a-z]|v\d+)$/, '') || id
}

export type EditorListing = {
    group: string,
    id: string, kind: EditorKind, title: string, clips: number, rendered: number, pictures: number,
    final: FinalState, lastRun?: EditorProject['lastRun'], changed: number, thumb?: { file: string, v: number },
}

const countOf = (folder: string, pattern: RegExp) => existsSync(folder) ? readdirSync(folder).filter(f => pattern.test(f)).length : 0

/** One project on the start page, from what lies in its folder: no hashing, so that many of them stay quick. */
export function readListing({id, dir, kind}: EditorTarget): EditorListing {
    const clipsDir = clipRequestsDir(dir)
    const ids = existsSync(clipsDir) ? readdirSync(clipsDir).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort() : []
    const project = join(dir, 'project.json')
    const title = kind === 'film' ? (() => {
        try {
            const data = readJson<FilmProject>(project)
            return data?.screenplay?.title ?? data?.brief?.title ?? id
        } catch {
            return id
        }
    })() : id
    const thumb = ids.map(c => media(dir, boundaryFrameAsset(c, 'ff'))).find(Boolean)
    return {
        id, kind, title,
        group: `${kind}/${projectGroup(id)}`,
        clips: ids.length,
        rendered: ids.filter(c => existsSync(join(dir, 'videos', `${c}.mp4`))).length,
        pictures: countOf(join(dir, 'assets', 'characters'), /\.png$/) + countOf(join(dir, 'assets', 'locations'), /\.png$/) + countOf(join(dir, 'assets', 'props'), /\.png$/),
        final: finalStateOf(dir, join(dir, `${id}.mp4`), ids.map(c => ({id: c}))),
        lastRun: lastRunOf(dir),
        changed: Math.round(statSync(existsSync(project) ? project : dir).mtimeMs),
        thumb,
    }
}

/** What the waveform lane shows: the song, or for a film the finished video - none before that. */
export const waveformSource = (project: EditorProject) => project.song?.file ?? project.final.file
