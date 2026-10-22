import {join} from "node:path";
import {renderAll} from "./batch.ts";
import type {Span} from "./colormatch.ts";
import {type Finish, finishFilter, finishVideo} from "./finish.ts";
import {multiplierFor} from "./interpolate.ts";
import {log, styles} from "./log.ts";
import type {Renderer} from "./render.ts";

// The passes after the clips are joined, the same for the music video (index.ts) and the film (film.ts): the finished copy
// of a final video (lib/finish.ts) and the clips with more frames for a second final video at another frame rate
// (lib/interpolate.ts). Each pipeline joins the clips itself - its sound differs.

/** The light grade and sharpen ("finish"): a copy next to the video, which itself stays as it is. `spans`: where each clip is in it. */
export async function finishCopy(video: string, finishing: Finish, spans: Span[]): Promise<string> {
    const done = await finishVideo(video, finishing, spans)
    log.step('Finished', `${done.file} ${styles.muted(finishing.colorMatch > 0 ? `${finishFilter(finishing)}, ${spans.length} clips matched ${finishing.colorMatch} of the way to ${finishing.colorReference || 'their median'}` : done.filter)}`)
    return done.file
}

/**
 * Every clip with more frames for a final video at `fps`, shot by shot on ComfyUI - a job per clip, kept in
 * videos/interpolated/ and made again only when the clip, its cuts or the model change. `frames`: the frames of the clip
 * the final video uses, from its first one.
 */
export async function interpolateClips(renderer: Renderer, clips: { id: string, frames: number, shots?: { at: number }[] }[], model: string, fps: number): Promise<{ files: string[], multiplier: number }> {
    const multiplier = multiplierFor(fps)!
    log.step('Frame rate', `${fps} fps - ${model}, x${multiplier} per shot`)
    const files = clips.map(c => join(renderer.projectDir, 'videos', 'interpolated', `${c.id}.mp4`))
    await renderAll(clips.map((clip, i) => ({clip, file: files[i]!})), ({clip, file}) => renderer.renderInterpolation(clip, model, multiplier, file))
    return {files, multiplier}
}
