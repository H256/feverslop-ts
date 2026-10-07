import {existsSync, mkdirSync, statSync} from "node:fs";
import {dirname, join} from "node:path";
import {type RenderFrames, resolveSeed} from "../../comfy/helpers.ts";
import type {FilmVideoWorkflowOptions} from "../../comfy/workflows/h3-ref2video-film.ts";
import {extractFrame, probeVideo} from "../assemble.ts";
import {log, styles} from "../log.ts";
import {Renderer} from "../render.ts";
import {workflowDir} from "../config.ts";
import {type FilmClipRequest, filmBoundaryFrame} from "./compose.ts";

/** What a clip was rendered from - the film refuses to use a clip made from another prompt or length. */
export const promptHash = (clip: { prompt: string, frames: number }) => Bun.hash(`${clip.frames}
${clip.prompt}`).toString(16)

const firstFrame = (clipId: string) => filmBoundaryFrame(clipId).replace(/_lf\.png$/, '_ff.png')

/**
 * The music-video renderer, plus the film's clips: the same server handling, resumable jobs and downloads (Renderer.render),
 * with the film workflow - pictures only, no audio goes in, the model speaks the dialogue itself.
 */
export class FilmRenderer extends Renderer {
    async renderFilmClip(clip: FilmClipRequest) {
        const file = `videos/${clip.id}.mp4`
        const target = join(this.projectDir, file)
        if (existsSync(target)) {
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

        const {seed} = await this.render(`clip ${clip.id}`, target, '.mp4', async () => {
            const uploads = clip.assets.pictures.map(p => ({from: join(this.projectDir, p.file), to: `${this.remoteDir}/${p.file}`}))
            const seed = resolveSeed(this.config.seed)
            const module = await import(join(workflowDir, `${this.config.videoWorkflow}.ts`)) as { default: (opts: FilmVideoWorkflowOptions) => ReturnType<typeof import("../../comfy/workflows/h3-ref2video-film.ts").default>, renderFrames?: RenderFrames }

            // Rendered at least as long as the clip needs, in a length the model accepts - the frames after the clip's own
            // are cut off again when the film is assembled
            const frames = module.renderFrames?.(clip.frames) ?? clip.frames
            if (frames < clip.frames) throw new Error(`${this.config.videoWorkflow}: renderFrames(${clip.frames}) returned only ${frames} frames`)
            const result = module.default({
                prompt: clip.prompt,
                pictures: clip.assets.pictures.filter(p => p.kind !== 'frame').map(p => `${this.remoteDir}/${p.file}`),
                ...(this.config.pinStartFrame && clip.startsFrom ? {startFrame: `${this.remoteDir}/${filmBoundaryFrame(clip.startsFrom)}`} : {}),
                frames,
                seed,
                resolution: this.config.videoResolution,
                filenamePrefix: `${this.remoteDir}/videos/${clip.id}`,
            })
            return {result, uploads, meta: {seed}}
        })

        const rendered = await probeVideo(target)
        if (rendered.frames < clip.frames) log.warn(`${file} has ${rendered.frames} frames, the clip needs ${clip.frames} - delete it and render again`)
        if (!rendered.hasAudio) log.warn(`${file} has no audio track - the film needs the sound the model makes`)
        await Bun.write(`${target}.json`, JSON.stringify({
            workflow: this.config.videoWorkflow,
            seed,
            resolution: this.config.videoResolution,
            ...(clip.startsFrom ? {startsFrom: clip.startsFrom} : {}),
            frameStart: clip.frameStart,
            frames: clip.frames,            // used in the final film
            promptHash: promptHash(clip),   // a clip rendered from another prompt than the plan has now is stale
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
