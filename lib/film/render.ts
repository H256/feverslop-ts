import {existsSync, mkdirSync, readFileSync, statSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {clipSeed, type RecommendedResolution, type RenderFrames} from '../../comfy/helpers.ts'
import type {FilmVideoWorkflowOptions} from '../../comfy/workflows/h3-ref2video-film.ts'
import {probeVideo} from '../assemble.ts'
import {secondsAt} from '../frames.ts'
import {log, styles} from '../log.ts'
import {boundaryFrameAsset, CONTEXT_SETTLE} from '../compose.ts'
import type {pictureFingerprint} from '../render.ts'
import {Renderer, RETAKE_LEAD, type RenderWhat} from '../render.ts'
import type {RetakeAsk} from '../retake.ts'
import type {RenderSpec} from '../render-spec.ts'
import {renderStateOf} from '../render-state.ts'
import {type Freshness, freshness, recordedContextFrames} from '../provenance.ts'
import {filmClipSpec, specId} from '../render-spec.ts'
import {workflowDir} from '../config.ts'
import type {FilmClipRequest} from './compose.ts'
import {clipRequestRef} from '../previous-output.ts'

/** What a clip was rendered from - the film refuses to use a clip made from another prompt or length. */
export const promptHash = (clip: {prompt: string; frames: number}) =>
    Bun.hash(
        `${clip.frames}
${clip.prompt}`,
    ).toString(16)

type FilmVideoConfig = {videoWorkflow: string; videoResolution: string | number; videoAspect?: string; pinStartFrame?: boolean}

/** The id of the request a film clip is rendered from (lib/render-spec.ts) - what its sidecar records and the film compares. */
export const filmClipFingerprint = (clip: FilmClipRequest, projectDir: string, config: FilmVideoConfig) =>
    specId(filmClipSpec({...clip, promptHash: promptHash(clip)}, projectDir, config))

/**
 * Is the rendered clip made from the request planned now? A clip rendered before fingerprints existed only has its prompt
 * hash: that still decides (a clip from another prompt is stale), nothing else can be told of it.
 */
export function filmClipFreshness(clip: FilmClipRequest, projectDir: string, config: FilmVideoConfig): Freshness {
    const file = join(projectDir, `videos/${clip.id}.mp4`)
    const sidecar = existsSync(`${file}.json`)
        ? (() => {
              try {
                  return JSON.parse(readFileSync(`${file}.json`, 'utf8')) as Record<string, unknown>
              } catch {
                  return {}
              }
          })()
        : undefined
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
 * The clips as assembleFilm takes them, in the order they are joined: a clip with dialogue keeps all the frames the model rendered
 * (its last word can fall behind the planned end), a clip that starts on the last frame of the one right before it leaves that frame
 * out - unless it was rendered on context frames, whose first frame is a new one.
 */
export const filmAssemblyClips = (projectDir: string, clips: FilmClipRequest[]) =>
    clips.map((r, i) => ({
        id: r.id,
        frames: r.frames,
        useRendered: r.dialogue.length > 0,
        continuesPrevious: r.startsFrom !== undefined && r.startsFrom === clips[i - 1]?.id && !startedOnContext(projectDir, r.id),
    }))

/** Was the clip rendered with context frames (its first frame is a new one, not the last frame of the clip before)? */
export function startedOnContext(projectDir: string, id: string): boolean {
    return recordedContextFrames(join(projectDir, 'videos', `${id}.mp4`)) !== undefined
}

/**
 * Where each clip is in the film as it is assembled, in frames - not always where the plan has it: a clip with dialogue is used with
 * every frame the model rendered, a clip that goes on from the one before leaves out the first frame, which is that one's last.
 */
export function filmClipSpans(
    projectDir: string,
    requests: {id: string; frames: number; dialogue: unknown[]; startsFrom?: string}[],
): {start: number; frames: number}[] {
    let cursor = 0
    return requests.map((clip, n) => {
        const used = clip.dialogue.length ? (renderedFramesOf(projectDir, clip.id) ?? clip.frames) : clip.frames
        const skipped = clip.startsFrom !== undefined && clip.startsFrom === requests[n - 1]?.id && !startedOnContext(projectDir, clip.id) ? 1 : 0
        const span = {start: cursor, frames: used - skipped}
        cursor += span.frames
        return span
    })
}

/**
 * The music-video renderer, plus the film's clips: the same server handling, resumable jobs and downloads (Renderer.render),
 * with the film workflow - pictures only, no audio goes in, the model speaks the dialogue itself.
 */
export class FilmRenderer extends Renderer {
    private filmJob(
        clip: FilmClipRequest,
        job: {
            prompt: string
            frames: number
            seed: number
            startClip?: string
            startFrame?: string
            endFrame?: {image: string; at: number}
            preview?: {scale: number; steps: number}
            filenamePrefix: string
            extraUploads?: {from: string; to: string}[]
        },
        module: {default: (opts: FilmVideoWorkflowOptions) => ReturnType<typeof import('../../comfy/workflows/h3-ref2video-film.ts').default>},
    ) {
        const uploads = [
            ...clip.assets.pictures.filter(p => p.kind !== 'frame').map(p => ({from: join(this.projectDir, p.file), to: `${this.remoteDir}/${p.file}`})),
            ...(job.extraUploads ?? []),
        ]
        const result = module.default({
            prompt: job.prompt,
            pictures: clip.assets.pictures.filter(p => p.kind !== 'frame').map(p => `${this.remoteDir}/${p.file}`),
            ...(job.startClip ? {startClip: job.startClip} : job.startFrame ? {startFrame: job.startFrame} : {}),
            ...(job.endFrame ? {endFrame: job.endFrame} : {}),
            ...(job.preview ? {preview: job.preview} : {}),
            frames: job.frames,
            seed: job.seed,
            resolution: this.config.videoResolution,
            aspect: this.config.videoAspect,
            filenamePrefix: job.filenamePrefix,
        })
        return {result, uploads, meta: {seed: job.seed}}
    }

    private filmWorkflow() {
        return import(join(workflowDir, `${this.config.videoWorkflow}.ts`)) as Promise<{
            default: (opts: FilmVideoWorkflowOptions) => ReturnType<typeof import('../../comfy/workflows/h3-ref2video-film.ts').default>
            renderFrames?: RenderFrames
            recommendedResolution?: RecommendedResolution
        }>
    }

    /** A clip as a cheap render into previews/ (--preview), with the model's own sound: see Renderer.renderClipPreview. */
    async renderFilmPreview(clip: FilmClipRequest) {
        const file = `previews/${clip.id}.mp4`
        const target = join(this.projectDir, file)
        if (existsSync(target)) return log.step('Exists', styles.muted(file))
        const missing = clip.assets.pictures.filter(p => p.kind !== 'frame' && !existsSync(join(this.projectDir, p.file)))
        if (missing.length) return log.warn(`${clip.id}: no preview - missing pictures: ${missing.map(p => p.file).join(', ')} - run --render=images`)
        const start = clip.startsFrom ? await this.previewStart(clip.startsFrom) : undefined
        if (clip.startsFrom && !start)
            return log.warn(`${clip.id}: no preview - it goes on from ${clip.startsFrom}, which has neither a preview nor a render yet`)
        const preview = this.config.preview
        const spec: RenderSpec = {kind: 'clip', id: clip.id, parts: ['preview', preview, clip.prompt, clip.frames, this.config.videoWorkflow, start ?? '']}
        const what: RenderWhat = {label: `preview ${clip.id}`, spec, kind: 'clip', workflow: this.config.videoWorkflow, resolution: `preview ${preview.scale}`}
        mkdirSync(dirname(target), {recursive: true})
        const {seed} = await this.render(what, target, '.mp4', async () => {
            const module = await this.filmWorkflow()
            this.noteResolution(module.recommendedResolution)
            const remote = start && `${this.remoteDir}/${start}`
            return this.filmJob(
                clip,
                {
                    prompt: clip.prompt,
                    frames: module.renderFrames?.(clip.frames) ?? clip.frames,
                    seed: clipSeed(this.config.seed, clip.id),
                    preview,
                    filenamePrefix: `${this.remoteDir}/previews/${clip.id}`,
                    ...(start ? {startFrame: remote, extraUploads: [{from: join(this.projectDir, start), to: remote!}]} : {}),
                },
                module,
            )
        })
        await this.savePreviewRecord(clip, target, seed)
    }

    /** A part of a film clip rendered again. The sound stays the clip's: a part with dialogue is refused, its words would no longer fit the mouth. */
    async renderFilmRetake(clip: FilmClipRequest, ask: RetakeAsk) {
        const seconds = secondsAt(clip.frames)
        const range =
            ask.seconds ??
            (() => {
                const shot = clip.shots[(ask.shot ?? 1) - 1]
                return shot ? ([shot.at, clip.shots[ask.shot ?? 1]?.at ?? seconds] as [number, number]) : undefined
            })()
        const spoken = range && clip.dialogue.some((line, n) => line.at < range[1] && (clip.dialogue[n + 1]?.at ?? seconds) > range[0])
        if (spoken)
            throw new Error(
                `${clip.id}: that part has dialogue in it. The sound of a film comes with the picture: the old words would stay under new lips, so such a part is not rendered on its own yet - render the whole clip again`,
            )
        const module = await this.filmWorkflow()
        this.noteResolution(module.recommendedResolution)
        await this.retake(
            clip,
            ask,
            RETAKE_LEAD,
            async (plan, guides) =>
                this.filmJob(
                    clip,
                    {
                        prompt: guides.prompt,
                        frames: plan.render,
                        seed: guides.seed,
                        filenamePrefix: guides.filenamePrefix,
                        startClip: guides.startClip,
                        startFrame: guides.startFrame,
                        endFrame: guides.endFrame,
                        extraUploads: guides.uploads,
                    },
                    module,
                ),
            frames => module.renderFrames?.(frames) ?? frames,
        )
    }

    // previous: the clip this one goes on from (clip.startsFrom) - for context frames
    async renderFilmClip(clip: FilmClipRequest, previous?: FilmClipRequest) {
        const file = `videos/${clip.id}.mp4`
        const target = join(this.projectDir, file)
        const spec = filmClipSpec({...clip, promptHash: promptHash(clip)}, this.projectDir, this.config)
        const request = specId(spec)
        if (
            existsSync(target) &&
            !this.staleFile('clips', file, request, [file, `${file}.json`, boundaryFrameAsset(clip.id, 'ff'), boundaryFrameAsset(clip.id, 'lf')])
        ) {
            log.step('Exists', styles.muted(file))
            const meta = `${target}.json`
            const renderedFrom = existsSync(meta) ? (await Bun.file(meta).json()).promptHash : undefined
            if (renderedFrom !== undefined && renderedFrom !== promptHash(clip))
                log.warn(`${file} was rendered from another prompt than the plan has now - delete it (and its .json) to render it again`)
            // it starts on the last frame of the clip before - rendered again since, that frame is another one
            const startFrame = clip.startsFrom ? join(this.projectDir, boundaryFrameAsset(clip.startsFrom, 'lf')) : undefined
            if (startFrame && existsSync(startFrame) && statSync(startFrame).mtimeMs > statSync(target).mtimeMs) {
                log.warn(`${file} starts on an older version of ${clip.startsFrom}'s last frame - delete it to render it again`)
            }
            // clips rendered before the boundary frames existed get them now
            return this.saveBoundaryFrames(clip, target)
        }

        const missing = clip.assets.pictures.filter(p => !existsSync(join(this.projectDir, p.file)))
        if (missing.some(p => p.kind === 'frame'))
            return log.warn(
                `${clip.id} skipped - it starts on the last frame of ${clip.startsFrom}, which is not rendered yet (${missing.find(p => p.kind === 'frame')!.file})`,
            )
        if (missing.length) return log.warn(`${clip.id} skipped - missing pictures: ${missing.map(p => p.file).join(', ')} - run --render=images`)

        // context frames (config.contextFrames): the end of the clip before as the film shows it - a clip with dialogue with
        // every frame it has (assembleFilm useRendered)
        const shown = previous?.dialogue.length ? renderedFramesOf(this.projectDir, previous.id) : undefined
        const context = clip.startsFrom && this.config.contextFrames > 0 ? await this.contextOf(clip.startsFrom, this.config.contextFrames, shown) : undefined
        // a seed given: a take again with a derived one (checkTakes), else the clip's own
        const prepare = async (forced?: number) => {
            const uploads = clip.assets.pictures.map(p => ({from: join(this.projectDir, p.file), to: `${this.remoteDir}/${p.file}`}))
            const seed = forced ?? clipSeed(this.config.seed, clip.id)
            const module = (await import(join(workflowDir, `${this.config.videoWorkflow}.ts`))) as {
                default: (opts: FilmVideoWorkflowOptions) => ReturnType<typeof import('../../comfy/workflows/h3-ref2video-film.ts').default>
                renderFrames?: RenderFrames
                recommendedResolution?: RecommendedResolution
            }
            this.noteResolution(module.recommendedResolution)

            // Rendered at least as long as the clip needs, in a length the model accepts - the frames after the clip's own
            // are cut off again when the film is assembled. With context frames the render begins that much earlier
            const lead = context ? context.frames + CONTEXT_SETTLE : 0
            const frames = module.renderFrames?.(clip.frames + lead) ?? clip.frames + lead
            if (frames < clip.frames + lead) throw new Error(`${this.config.videoWorkflow}: renderFrames(${clip.frames + lead}) returned only ${frames} frames`)
            if (context) uploads.push({from: context.file, to: `${this.remoteDir}/${context.asset}`})
            const result = module.default({
                prompt: clip.prompt,
                pictures: clip.assets.pictures.filter(p => p.kind !== 'frame').map(p => `${this.remoteDir}/${p.file}`),
                ...(context
                    ? {startClip: `${this.remoteDir}/${context.asset}`}
                    : this.config.pinStartFrame && clip.startsFrom
                      ? {startFrame: `${this.remoteDir}/${boundaryFrameAsset(clip.startsFrom, 'lf')}`}
                      : {}),
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
        seed = await this.checkTakes(clip.id, file, seed, clip, async derived => {
            const taken = (await this.render(what, target, '.mp4', () => prepare(derived))).seed
            if (context) await this.joinContext(target, clip.id, clip.startsFrom!, context)
            return taken
        })

        const rendered = await probeVideo(target)
        if (rendered.frames < clip.frames) log.warn(`${file} has ${rendered.frames} frames, the clip needs ${clip.frames} - delete it and render again`)
        if (!rendered.hasAudio) log.warn(`${file} has no audio track - the film needs the sound the model makes`)
        await Bun.write(
            `${target}.json`,
            JSON.stringify(
                {
                    workflow: this.config.videoWorkflow,
                    seed,
                    resolution: this.config.videoResolution,
                    ...(this.config.videoAspect !== '16:9' ? {aspect: this.config.videoAspect} : {}),
                    ...(clip.startsFrom ? {startsFrom: clip.startsFrom} : {}),
                    // started on the last frames of the clip before, its head cut off: its first frame is a new one (assembleFilm)
                    ...(context ? {contextFrames: context.frames} : {}),
                    frameStart: clip.frameStart,
                    frames: clip.frames, // used in the final film
                    promptHash: promptHash(clip), // a clip rendered from another prompt than the plan has now is stale
                    fingerprint: request, // the same for everything it is made from (lib/provenance.ts)
                    renderedFrames: rendered.frames,
                    size: `${rendered.width}x${rendered.height}`,
                    request: clipRequestRef(clip.id),
                },
                null,
                2,
            ),
        )
        log.step('Saved', `${file} ${styles.muted(`${rendered.frames} frames, ${clip.frames} used${rendered.hasAudio ? ', with audio' : ''}`)}`)
        await this.saveBoundaryFrames(clip, target, rendered.frames)
    }

    // a clip with dialogue is used with every frame the model rendered (assembleFilm useRendered)
    protected override framesUsed(clip: {frames: number}, available: number) {
        return (clip as FilmClipRequest).dialogue.length ? available : super.framesUsed(clip, available)
    }
}

/** What is rendered of a film, from the requests of its last plan run - for --dry-run and bun run status --film. */
export const filmRenderState = (projectDir: string, filmId: string, config: FilmVideoConfig & Parameters<typeof pictureFingerprint>[2]) =>
    renderStateOf<FilmClipRequest>(
        projectDir,
        join(projectDir, 'assets.json'),
        join(projectDir, `${filmId}.mp4`),
        config,
        clip => filmClipFreshness(clip, projectDir, config) === 'stale',
    )
