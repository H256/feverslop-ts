import {existsSync, readdirSync, statSync} from "node:fs";
import {join} from "node:path";
import type {ClipRequest} from "./compose.ts";
import type {ProjectConfig, RenderConfig} from "./config.ts";
import {describePrediction, predictJobs, type RenderJob} from "./predict.ts";
import {freshness} from "./provenance.ts";
import {clipFingerprint, type PictureJob, renderedFrames, workflowHash} from "./render.ts";
import {SEQUENCE_FRAMES} from "./sequenceSheet.ts";
import {readTimings} from "./timings.ts";

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
export async function clipEstimate(clips: { frames: number, startsFrom?: string }[], config: Pick<RenderConfig, 'videoWorkflow' | 'videoResolution' | 'contextFrames'>, servers: string[]) {
    const hash = await workflowHash(config.videoWorkflow).catch(() => undefined)
    const jobs: RenderJob[] = await Promise.all(clips.map(async c => ({kind: 'clip' as const, name: config.videoWorkflow, workflowHash: hash, frames: await renderedFrames(c, config).catch(() => c.frames), resolution: config.videoResolution})))
    return describePrediction('clip', predictJobs(readTimings(), jobs, servers))
}
