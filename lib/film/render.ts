import {existsSync, mkdirSync, readFileSync, statSync} from "node:fs";
import {dirname, join} from "node:path";
import {type RecommendedResolution, type RenderFrames, resolveSeed} from "../../comfy/helpers.ts";
import type {FilmVideoWorkflowOptions} from "../../comfy/workflows/h3-ref2video-film.ts";
import {extractFrame, probeVideo, trimHead} from "../assemble.ts";
import {sceneScores} from "../interpolate.ts";
import {log, styles} from "../log.ts";
import {CONTEXT_SETTLE} from "../compose.ts";
import {Renderer, type RenderWhat} from "../render.ts";
import {renderStateOf} from "../render-state.ts";
import {type Freshness, freshness} from "../provenance.ts";
import {filmClipSpec, specId} from "../render-spec.ts";
import {workflowDir} from "../config.ts";
import {type FilmClipRequest, filmBoundaryFrame} from "./compose.ts";

/** What a clip was rendered from - the film refuses to use a clip made from another prompt or length. */
export const promptHash = (clip: { prompt: string, frames: number }) => Bun.hash(`${clip.frames}
${clip.prompt}`).toString(16)

type FilmVideoConfig = { videoWorkflow: string, videoResolution: string | number, videoAspect?: string, pinStartFrame?: boolean }

/** The id of the request a film clip is rendered from (lib/render-spec.ts) - what its sidecar records and the film compares. */
export const filmClipFingerprint = (clip: FilmClipRequest, projectDir: string, config: FilmVideoConfig) =>
    specId(filmClipSpec({...clip, promptHash: promptHash(clip)}, projectDir, config))

/**
 * Is the rendered clip made from the request planned now? A clip rendered before fingerprints existed only has its prompt
 * hash: that still decides (a clip from another prompt is stale), nothing else can be told of it.
 */
export function filmClipFreshness(clip: FilmClipRequest, projectDir: string, config: FilmVideoConfig): Freshness {
    const file = join(projectDir, `videos/${clip.id}.mp4`)
    const sidecar = existsSync(`${file}.json`) ? (() => { try { return JSON.parse(readFileSync(`${file}.json`, 'utf8')) as Record<string, unknown> } catch { return {} } })() : undefined
    if (sidecar && sidecar.fingerprint === undefined && typeof sidecar.promptHash === 'string' && sidecar.source !== 'user' && sidecar.pinned !== true) {
        return sidecar.promptHash === promptHash(clip) ? 'current' : 'stale'
    }
    return freshness(file, filmClipFingerprint(clip, projectDir, config))
}

/** The frames a rendered clip's file has, as its sidecar records them - undefined when it has none. */
function renderedFramesOf(projectDir: string, id: string): number | undefined {
    const sidecar = join(projectDir, `videos/${id}.mp4.json`)
    if (!existsSync(sidecar)) return undefined
    try {
        const frames = JSON.parse(readFileSync(sidecar, 'utf8')).renderedFrames
        return Number.isInteger(frames) ? frames : undefined
    } catch {
        return undefined
    }
}

/**
 * Is the clip's first frame a new one, not the last frame of the clip before again - rendered with context frames, or cut in
 * (its lead-in cut off)? The film then keeps it.
 */
export function startedOnContext(projectDir: string, id: string): boolean {
    const sidecar = join(projectDir, `videos/${id}.mp4.json`)
    if (!existsSync(sidecar)) return false
    try {
        const recorded = JSON.parse(readFileSync(sidecar, 'utf8'))
        return Number.isInteger(recorded.contextFrames) || Number.isInteger(recorded.cutIn)
    } catch {
        return false
    }
}

// how far the model's cut into the first shot may come from where the lead-in planned it, in frames
const CUT_SEARCH = 10
// a scene score from this on is a cut (lib/interpolate.ts takes the same for a planned one)
const CUT_SCORE = 0.2

/**
 * The frame a clip that cuts in really cuts on: the highest scene score within CUT_SEARCH frames of the planned one, if it is a
 * cut - else the planned frame (the model held the picture or faded).
 */
export function cutInFrame(scores: number[], planned: number): number {
    let best = planned
    for (let f = Math.max(1, planned - CUT_SEARCH); f <= planned + CUT_SEARCH && f < scores.length; f++) if ((scores[f] ?? 0) > (scores[best] ?? 0)) best = f
    return (scores[best] ?? 0) >= CUT_SCORE ? best : planned
}

const firstFrame = (clipId: string) => filmBoundaryFrame(clipId).replace(/_lf\.png$/, '_ff.png')

/**
 * The music-video renderer, plus the film's clips: the same server handling, resumable jobs and downloads (Renderer.render),
 * with the film workflow - pictures only, no audio goes in, the model speaks the dialogue itself.
 */
export class FilmRenderer extends Renderer {
    // previous: the clip this one goes on from (clip.startsFrom) - for context frames
    async renderFilmClip(clip: FilmClipRequest, previous?: FilmClipRequest) {
        const file = `videos/${clip.id}.mp4`
        const target = join(this.projectDir, file)
        const spec = filmClipSpec({...clip, promptHash: promptHash(clip)}, this.projectDir, this.config)
        const request = specId(spec)
        if (existsSync(target) && !this.staleFile('clips', file, request, [file, `${file}.json`, firstFrame(clip.id), filmBoundaryFrame(clip.id)])) {
            log.step('Exists', styles.muted(file))
            const meta = `${target}.json`
            const renderedFrom = existsSync(meta) ? (await Bun.file(meta).json()).promptHash : undefined
            if (renderedFrom !== undefined && renderedFrom !== promptHash(clip)) log.warn(`${file} was rendered from another prompt than the plan has now - delete it (and its .json) to render it again`)
            // it starts on the last frame of the clip before - rendered again since, that frame is another one
            const startFrame = clip.startsFrom ? join(this.projectDir, filmBoundaryFrame(clip.startsFrom)) : undefined
            if (startFrame && existsSync(startFrame) && statSync(startFrame).mtimeMs > statSync(target).mtimeMs) {
                log.warn(`${file} starts on an older version of ${clip.startsFrom}'s last frame - delete it to render it again`)
            }
            // clips rendered before the boundary frames existed get them now
            return this.saveFrames(clip, target)
        }

        const missing = clip.assets.pictures.filter(p => !existsSync(join(this.projectDir, p.file)))
        if (missing.some(p => p.kind === 'frame')) return log.warn(`${clip.id} skipped - it starts on the last frame of ${clip.startsFrom}, which is not rendered yet (${missing.find(p => p.kind === 'frame')!.file})`)
        if (missing.length) return log.warn(`${clip.id} skipped - missing pictures: ${missing.map(p => p.file).join(', ')} - run --render=images`)

        // context frames (config.contextFrames): the end of the clip before as the film shows it - a clip with dialogue with
        // every frame it has (assembleFilm useRendered)
        const shown = previous?.dialogue.length ? renderedFramesOf(this.projectDir, previous.id) : undefined
        const context = clip.startsFrom && this.config.contextFrames > 0 ? await this.contextOf(clip.startsFrom, this.config.contextFrames, shown) : undefined
        const prepare = async () => {
            const uploads = clip.assets.pictures.map(p => ({from: join(this.projectDir, p.file), to: `${this.remoteDir}/${p.file}`}))
            const seed = resolveSeed(this.config.seed)
            const module = await import(join(workflowDir, `${this.config.videoWorkflow}.ts`)) as { default: (opts: FilmVideoWorkflowOptions) => ReturnType<typeof import("../../comfy/workflows/h3-ref2video-film.ts").default>, renderFrames?: RenderFrames, recommendedResolution?: RecommendedResolution }
            this.noteResolution(module.recommendedResolution)

            // Rendered at least as long as the clip needs, in a length the model accepts - the frames after the clip's own
            // are cut off again when the film is assembled. With context frames the render begins that much earlier
            // a clip that cuts in renders its lead-in too, with room for the model's cut to come a little late
            const lead = (context ? context.frames + CONTEXT_SETTLE : 0) + (clip.cutIn ? clip.cutIn + CUT_SEARCH : 0)
            const frames = module.renderFrames?.(clip.frames + lead) ?? clip.frames + lead
            if (frames < clip.frames + lead) throw new Error(`${this.config.videoWorkflow}: renderFrames(${clip.frames + lead}) returned only ${frames} frames`)
            if (context) uploads.push({from: context.file, to: `${this.remoteDir}/${context.asset}`})
            const result = module.default({
                prompt: clip.prompt,
                pictures: clip.assets.pictures.filter(p => p.kind !== 'frame').map(p => `${this.remoteDir}/${p.file}`),
                ...(context ? {startClip: `${this.remoteDir}/${context.asset}`} : this.config.pinStartFrame && clip.startsFrom ? {startFrame: `${this.remoteDir}/${filmBoundaryFrame(clip.startsFrom)}`} : {}),
                frames,
                seed,
                resolution: this.config.videoResolution,
                aspect: this.config.videoAspect,
                filenamePrefix: `${this.remoteDir}/videos/${clip.id}`,
            })
            return {result, uploads, meta: {seed}}
        }
        const what: RenderWhat = {label: `clip ${clip.id}`, spec, kind: 'clip', workflow: this.config.videoWorkflow, resolution: this.config.videoResolution}
        let {seed} = await this.render(what, target, '.mp4', prepare)
        seed = await this.retryLeaks(what, clip.id, file, seed, prepare, `render it again with --render=videos --again --only=${clip.id}`)
        // the head - the clip before again - cut off, the colors matched to it: as in the music video
        if (context) await this.joinContext(target, clip.id, clip.startsFrom!, context)
        // a clip that cuts in: everything before its hard cut - the lead-in on the picture of the clip before - is cut off too
        const cut = clip.cutIn ? cutInFrame(await sceneScores(target), clip.cutIn) : undefined
        if (cut !== undefined) {
            await trimHead(target, cut)
            log.line(styles.muted(`        · ${clip.id}: cut in at frame ${cut} of the lead-in (planned ${clip.cutIn}) - what comes before is cut off`))
        }

        const rendered = await probeVideo(target)
        if (rendered.frames < clip.frames) log.warn(`${file} has ${rendered.frames} frames, the clip needs ${clip.frames} - delete it and render again`)
        if (!rendered.hasAudio) log.warn(`${file} has no audio track - the film needs the sound the model makes`)
        await Bun.write(`${target}.json`, JSON.stringify({
            workflow: this.config.videoWorkflow,
            seed,
            resolution: this.config.videoResolution,
            ...(this.config.videoAspect !== '16:9' ? {aspect: this.config.videoAspect} : {}),
            ...(clip.startsFrom ? {startsFrom: clip.startsFrom} : {}),
            // started on the last frames of the clip before, its head cut off: its first frame is a new one (assembleFilm)
            ...(context ? {contextFrames: context.frames} : {}),
            ...(cut !== undefined ? {cutIn: cut} : {}),
            frameStart: clip.frameStart,
            frames: clip.frames,            // used in the final film
            promptHash: promptHash(clip),   // a clip rendered from another prompt than the plan has now is stale
            fingerprint: request,           // the same for everything it is made from (lib/provenance.ts)
            renderedFrames: rendered.frames,
            size: `${rendered.width}x${rendered.height}`,
            request: `output/clips/${clip.id}.json`,
        }, null, 2))
        log.step('Saved', `${file} ${styles.muted(`${rendered.frames} frames, ${clip.frames} used${rendered.hasAudio ? ', with audio' : ''}`)}`)
        await this.saveFrames(clip, target, rendered.frames)
    }

    // The first and last frame the clip contributes to the film: frame 0 and frame `clip.frames - 1` - not the file's last
    // frame, the ones after it are only padding for the model's lengths. renderedFrames: set for a clip just rendered -
    // its frames are always rewritten; without, only missing ones are made
    private async saveFrames(clip: FilmClipRequest, video: string, renderedFrames?: number) {
        const first = firstFrame(clip.id)
        const last = filmBoundaryFrame(clip.id)
        if (renderedFrames === undefined && existsSync(join(this.projectDir, first)) && existsSync(join(this.projectDir, last))) return
        mkdirSync(join(this.projectDir, dirname(first)), {recursive: true})
        // the last frame of the film's part of the clip: a clip with dialogue is used with every frame the model rendered (assembleFilm useRendered)
        const available = renderedFrames ?? (await probeVideo(video)).frames
        const frames = clip.dialogue.length ? available : Math.min(clip.frames, available)
        await extractFrame(video, 0, join(this.projectDir, first))
        await extractFrame(video, frames - 1, join(this.projectDir, last))
        log.step('Saved', `${first}, ${last} ${styles.muted(`frames 0 and ${frames - 1}`)}`)
    }
}

/** What is rendered of a film, from the requests of its last plan run - for --dry-run and bun run status --film. */
export const filmRenderState = (projectDir: string, filmId: string, config: FilmVideoConfig) =>
    renderStateOf<FilmClipRequest>(projectDir, join(projectDir, 'assets.json'), join(projectDir, `${filmId}.mp4`), clip => filmClipFreshness(clip, projectDir, config) === 'stale')
