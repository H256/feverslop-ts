import {existsSync, readdirSync, statSync} from "node:fs";
import {join} from "node:path";
import type {ClipRequest} from "./compose.ts";
import type {ProjectConfig, RenderConfig} from "./config.ts";
import {describePrediction, predictJobs, type RenderJob} from "./predict.ts";
import {freshness} from "./provenance.ts";
import {clipFingerprint, type PictureJob, renderedFrames, workflowHash} from "./render.ts";
import {SEQUENCE_FRAMES} from "./sequenceSheet.ts";
import {readTimings, type Timing} from "./timings.ts";

// What is rendered of a project, read from the requests of its last plan run (output/) - for bun run status and --dry-run.

export type RenderState<C = ClipRequest> = {
    pictures: PictureJob[], missingPictures: PictureJob[],
    clips: C[], missingClips: C[], staleClips: C[],
    finalVideo: string, finalState: 'missing' | 'current' | 'older',
}

export async function renderState(projectDir: string, projectId: string, config: ProjectConfig): Promise<RenderState> {
    return renderStateOf<ClipRequest>(projectDir, join(projectDir, 'output', 'assets.json'), join(projectDir, `${projectId}.mp4`),
        (clip, video) => freshness(video, clipFingerprint(clip, projectDir, config)) === 'stale')
}

/**
 * The render state of a music video's or a film's project: the pictures in `picturesFile` (the jobs of the last plan
 * run), the clip requests in output/clips/, their videos in videos/ - `stale` says whether a rendered clip was made from
 * another request - and the final video.
 */
export async function renderStateOf<C extends { id: string }>(projectDir: string, picturesFile: string, finalVideo: string, stale: (clip: C, video: string) => boolean): Promise<RenderState<C>> {
    const pictures: PictureJob[] = existsSync(picturesFile) ? await Bun.file(picturesFile).json() : []
    const clipsDir = join(projectDir, 'output', 'clips')
    const clips: C[] = existsSync(clipsDir)
        ? await Promise.all(readdirSync(clipsDir).filter(f => f.endsWith('.json')).sort().map(f => Bun.file(join(clipsDir, f)).json()))
        : []
    const videoOf = (clip: C) => join(projectDir, 'videos', `${clip.id}.mp4`)
    const finalAge = existsSync(finalVideo) ? statSync(finalVideo).mtimeMs : undefined
    return {
        pictures,
        missingPictures: pictures.filter(p => !existsSync(join(projectDir, p.file))),
        clips,
        missingClips: clips.filter(c => !existsSync(videoOf(c))),
        staleClips: clips.filter(c => existsSync(videoOf(c)) && stale(c, videoOf(c))),
        finalVideo,
        finalState: finalAge === undefined ? 'missing'
            : clips.length && clips.every(c => existsSync(videoOf(c)) && statSync(videoOf(c)).mtimeMs <= finalAge) ? 'current' : 'older',
    }
}

/** The time estimate of rendering these pictures, from the measured timings. */
export async function pictureEstimate(count: number, config: Pick<RenderConfig, 'sequenceSheets' | 'sequenceWorkflow' | 'imageWorkflow' | 'imageResolution'>, servers: string[]) {
    const workflow = config.sequenceSheets ? config.sequenceWorkflow : config.imageWorkflow
    const hash = await workflowHash(workflow).catch(() => undefined)
    const jobs: RenderJob[] = Array.from({length: count}, () => ({kind: 'picture', name: workflow, workflowHash: hash, ...(config.sequenceSheets ? {frames: SEQUENCE_FRAMES} : {resolution: config.imageResolution})}))
    return describePrediction(config.sequenceSheets ? 'sheet video' : 'picture', predictJobs(readTimings(), jobs, servers))
}

/** The time estimate of rendering these clips - from the frames their jobs render, context frames included, as their timings count them. */
// clips over this many frames fail far more often on a server short of memory: 17 of 43 against 3 of 36 on the R9700
const LONG_CLIP_FRAMES = 150
const RISK_WINDOW_DAYS = 14
const RISK_MIN_FAILED = 3
const RISK_MIN_SHARE = 0.2

/**
 * What the measurements say about the clips of this run: per server and clip length, how many failed lately - when that is
 * a lot. Only says so: which settings to run with stays the user's choice.
 */
export function clipFailureRisks(timings: Timing[], clips: { frames: number }[], workflow: string, servers: string[], now = Date.now()) {
    const since = now - RISK_WINDOW_DAYS * 24 * 60 * 60 * 1000
    const isLong = (frames: number) => frames > LONG_CLIP_FRAMES
    return servers.flatMap(server => [false, true].flatMap(long => {
        const count = clips.filter(c => isLong(c.frames) === long).length
        if (!count) return []
        const jobs = timings.filter(t => t.kind === 'clip' && t.name === workflow && t.server === server && t.frames !== undefined
            && isLong(t.frames) === long && Date.parse(t.at) >= since && (!t.outcome || t.outcome === 'failed'))
        const failed = jobs.filter(t => t.outcome === 'failed')
        if (failed.length < RISK_MIN_FAILED || failed.length / jobs.length < RISK_MIN_SHARE) return []
        const lost = Math.round(failed.reduce((sum, t) => sum + t.seconds, 0) / 60)
        return [`${server}: ${failed.length} of ${jobs.length} clips ${long ? 'over' : 'up to'} ${LONG_CLIP_FRAMES} frames failed in the last ${RISK_WINDOW_DAYS} days (${lost} min of GPU time) - ${count} clip(s) of this run are that long`]
    }))
}

export async function clipEstimate(clips: { frames: number, startsFrom?: string }[], config: Pick<RenderConfig, 'videoWorkflow' | 'videoResolution' | 'contextFrames'>, servers: string[]) {
    const hash = await workflowHash(config.videoWorkflow).catch(() => undefined)
    const jobs: RenderJob[] = await Promise.all(clips.map(async c => ({kind: 'clip' as const, name: config.videoWorkflow, workflowHash: hash, frames: await renderedFrames(c, config).catch(() => c.frames), resolution: config.videoResolution})))
    return describePrediction('clip', predictJobs(readTimings(), jobs, servers))
}
