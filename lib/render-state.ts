import {existsSync, readdirSync, statSync} from "node:fs";
import {join} from "node:path";
import type {ClipRequest} from "./compose.ts";
import type {ProjectConfig} from "./config.ts";
import {describePrediction, predictJobs, type RenderJob, resolutionPixels} from "./predict.ts";
import {freshness} from "./provenance.ts";
import {clipFingerprint, type PictureJob, workflowHash} from "./render.ts";
import {SEQUENCE_FRAMES} from "./sequenceSheet.ts";
import {readTimings} from "./timings.ts";

// What is rendered of a project, read from the requests of its last plan run (output/) - for bun run status and --dry-run.

export type RenderState = {
    pictures: PictureJob[], missingPictures: PictureJob[],
    clips: ClipRequest[], missingClips: ClipRequest[], staleClips: ClipRequest[],
    finalVideo: string, finalState: 'missing' | 'current' | 'older',
}

export async function renderState(projectDir: string, projectId: string, config: ProjectConfig): Promise<RenderState> {
    const outputDir = join(projectDir, 'output')
    const pictures: PictureJob[] = existsSync(join(outputDir, 'assets.json')) ? await Bun.file(join(outputDir, 'assets.json')).json() : []
    const clipsDir = join(outputDir, 'clips')
    const clips: ClipRequest[] = existsSync(clipsDir)
        ? await Promise.all(readdirSync(clipsDir).filter(f => f.endsWith('.json')).sort().map(f => Bun.file(join(clipsDir, f)).json()))
        : []
    const videoOf = (clip: ClipRequest) => join(projectDir, 'videos', `${clip.id}.mp4`)
    const finalVideo = join(projectDir, `${projectId}.mp4`)
    const finalAge = existsSync(finalVideo) ? statSync(finalVideo).mtimeMs : undefined
    return {
        pictures,
        missingPictures: pictures.filter(p => !existsSync(join(projectDir, p.file))),
        clips,
        missingClips: clips.filter(c => !existsSync(videoOf(c))),
        staleClips: clips.filter(c => existsSync(videoOf(c)) && freshness(videoOf(c), clipFingerprint(c, projectDir, config)) === 'stale'),
        finalVideo,
        finalState: finalAge === undefined ? 'missing'
            : clips.length && clips.every(c => existsSync(videoOf(c)) && statSync(videoOf(c)).mtimeMs <= finalAge) ? 'current' : 'older',
    }
}

/** The time estimate of rendering these pictures, from the measured timings. */
export async function pictureEstimate(count: number, config: ProjectConfig, servers: string[]) {
    const workflow = config.sequenceSheets ? config.sequenceWorkflow : config.imageWorkflow
    const hash = await workflowHash(workflow).catch(() => undefined)
    const jobs: RenderJob[] = Array.from({length: count}, () => ({kind: 'picture', name: workflow, workflowHash: hash, ...(config.sequenceSheets ? {frames: SEQUENCE_FRAMES} : {pixels: resolutionPixels(config.imageResolution)})}))
    return describePrediction(config.sequenceSheets ? 'sheet video' : 'picture', predictJobs(readTimings(), jobs, servers))
}

/** The time estimate of rendering these clips - from their own frames (the workflow rounds them up a little). */
export async function clipEstimate(clips: ClipRequest[], config: ProjectConfig, servers: string[]) {
    const hash = await workflowHash(config.videoWorkflow).catch(() => undefined)
    const jobs: RenderJob[] = clips.map(c => ({kind: 'clip', name: config.videoWorkflow, workflowHash: hash, frames: c.frames, pixels: resolutionPixels(config.videoResolution)}))
    return describePrediction('clip', predictJobs(readTimings(), jobs, servers))
}
