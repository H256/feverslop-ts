import {existsSync, readFileSync, statSync} from "node:fs";
import {isAbsolute, join, relative} from "node:path";
import {boundaryFrameAsset, type ClipRequest} from "../compose.ts";
import {loadProjectConfig} from "../config.ts";
import {FPS, secondsAt} from "../frames.ts";
import type {Project} from "../project.ts";
import {type Freshness, freshness} from "../provenance.ts";
import {plainText} from "../refs.ts";
import {clipFingerprint, pictureFingerprint, type PictureJob} from "../render.ts";
import {type FinalState, finalStateOf, readClipRequests, readPictureJobs} from "../render-state.ts";
import {lastRun, type RunState, runState} from "../run-record.ts";
import {asBeatShots} from "../shot-plan.ts";
import type {FilmClipRequest} from "../film/compose.ts";
import {loadFilmConfig} from "../film/config.ts";
import {filmRenderConfig} from "../film/pictures.ts";
import {filmClipFreshness} from "../film/render.ts";
import type {FilmProject} from "../film/types.ts";

// What the workspace shows of one music video or film, in one shape for both: read from the project folder at every request,
// nothing kept. The fast part (/api/project) only looks at which files are there; whether they are stale means hashing every
// reference picture, so that comes separately (/api/freshness) and fills in once the page is up.

export type EditorKind = 'music' | 'film'
export type EditorPerson = { name: string, text: string }
export type EditorShot = { label: string, at: number, framing: string, camera: string, subjects: string[], action?: string, people: EditorPerson[] }
// a sung or spoken line: seconds from the clip's start
export type EditorLine = { at: number, end?: number, text: string, who: string }
export type EditorPicture = { label: string, file: string, kind: string, name: string, subject: string, description: string, exists: boolean, v?: number }
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
    lastRun?: { state: RunState, command: string, startedAt: string, failures: string[] },
    command: string,            // how this project is run, for the commands the page shows
}

export type EditorTarget = { id: string, dir: string, kind: EditorKind }

/** The modification time of a file: part of its address, so that the page shows a file that changed - nothing else depends on it. */
const versionOf = (file: string) => Math.round(statSync(file).mtimeMs)
const media = (dir: string, file: string) => existsSync(join(dir, file)) ? {file, v: versionOf(join(dir, file))} : undefined

const readJson = <T>(file: string): T | undefined => existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as T : undefined

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

const pictureOf = (dir: string) => (p: { label: string, file: string, kind: string, name: string, subject: string, description: string }): EditorPicture => {
    const found = media(dir, p.file)
    return {label: p.label, file: p.file, kind: p.kind, name: p.name, subject: p.subject, description: p.description, exists: !!found, ...(found ? {v: found.v} : {})}
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

const finalOf = (dir: string, id: string, clips: { id: string }[]): EditorProject['final'] => {
    const state = finalStateOf(dir, join(dir, `${id}.mp4`), clips)
    return {state, ...(media(dir, `${id}.mp4`) ?? {})}
}

const lastRunOf = (dir: string): EditorProject['lastRun'] => {
    const run = lastRun(dir)
    return run ? {state: runState(run), command: run.command, startedAt: run.startedAt, failures: run.failures ?? (run.error ? [run.error] : [])} : undefined
}

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
        lastRun: lastRunOf(dir),
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
    const clips = requests.map((clip): EditorClip => {
        const coverage = data.coverage?.find(c => c.sceneId === clip.sceneId)
        const offset = shotsDone.get(clip.sceneId) ?? 0
        shotsDone.set(clip.sceneId, offset + clip.shots.length)
        const start = secondsAt(clip.frameStart)
        const seconds = secondsAt(clip.frames)
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
            firstFrame: media(dir, `assets/clips/${clip.id}_ff.png`),
            lastFrame: media(dir, `assets/clips/${clip.id}_lf.png`),
        }
    })
    return {
        id, kind: 'film', title: data.screenplay?.title ?? data.brief?.title ?? id, fps: FPS,
        seconds: clips.at(-1)?.end ?? 0,
        groups: groupsOf(clips, sceneLabel),
        clips: withNext(clips),
        pictures: picturesOf(dir, await readPictureJobs(join(dir, 'assets.json'))),
        final: finalOf(dir, id, requests),
        lastRun: lastRunOf(dir),
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

/** What the waveform lane shows: the song, or for a film the finished video - none before that. */
export const waveformSource = (project: EditorProject) => project.song?.file ?? project.final.file
