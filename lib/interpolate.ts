import {FPS} from "./frames.ts";
import {runProcess} from "./process.ts";

// Frame interpolation of the rendered clips (issue #291): ComfyUI's own FrameInterpolate (RIFE or FILM) makes more frames
// per shot - never across a cut, which would morph one shot into the next. Every clip starts on a cut, and the plan says
// where its shots start (`at`) - but the video model cuts near that time, not on it (slot-018: planned at frame 96, cut
// at 91). So the cuts are read from the picture: ffmpeg's scene score of every frame, the planned time only as the place
// to look.

/**
 * The interpolation for a frame rate of the final video: frames x multiplier at FPS x multiplier, every n-th of them kept -
 * the smallest multiplier up to 8 that gives the rate (60 fps: x5 = 120, every 2nd). undefined: no such multiplier.
 */
export function multiplierFor(fps: number): number | undefined {
    for (let m = 2; m <= 8; m++) if ((FPS * m) % fps === 0 && FPS * m >= fps) return m
    return undefined
}

/** How far from the planned frame a cut is looked for - half a second either way. */
const NEAR_PLAN = Math.round(FPS / 2)
/** The scene score a frame needs near a planned cut to be that cut (0-1: how much the picture changes from the frame before). */
const PLANNED_CUT_SCORE = 0.2
/** A cut the plan does not have counts from this score on - a fast movement scores far below it (slot-018: cut 0.42, a drum hit 0.14). */
const UNPLANNED_CUT_SCORE = 0.4

/** ffmpeg's scene score of every frame of a video, index = frame (frame 0 has none: 0). */
export async function sceneScores(video: string): Promise<number[]> {
    const out = await runProcess(['ffmpeg', '-v', 'error', '-i', video, '-vf', "select='gte(scene,0)',metadata=print:key=lavfi.scene_score:file=-", '-an', '-f', 'null', '-'],
        {errorMessage: err => `ffmpeg could not read the scene scores of ${video}:\n${err}`})
    const scores: number[] = []
    let frame = -1
    for (const line of out.split(/\r?\n/)) {
        const at = line.match(/^frame:(\d+)/)
        if (at) frame = Number(at[1])
        const score = line.match(/lavfi\.scene_score=([\d.]+)/)
        if (score && frame >= 0) scores[frame] = Number(score[1])
    }
    return Array.from({length: scores.length}, (_, i) => scores[i] ?? 0)
}

/**
 * The frames the shots of a clip start on, in its own frames: each planned start (`at`, seconds) moves to the frame of the
 * highest scene score within half a second, if that score says it is a cut - else it stays where the plan has it. A frame
 * the plan has no cut near counts as a cut when its score is clearly one.
 */
export function shotCuts(frames: number, shotStarts: number[], scores: number[]): number[] {
    const cuts = new Set<number>([0])
    const near = new Set<number>()
    for (const at of shotStarts) {
        const planned = Math.round(at * FPS)
        if (planned <= 0 || planned >= frames) continue
        let best = planned
        for (let f = Math.max(1, planned - NEAR_PLAN); f <= Math.min(frames - 1, planned + NEAR_PLAN); f++) {
            near.add(f)
            if ((scores[f] ?? 0) > (scores[best] ?? 0)) best = f
        }
        cuts.add((scores[best] ?? 0) >= PLANNED_CUT_SCORE ? best : planned)
    }
    for (let f = 1; f < Math.min(frames, scores.length); f++) if (!near.has(f) && scores[f]! >= UNPLANNED_CUT_SCORE) cuts.add(f)
    return [...cuts].sort((a, b) => a - b)
}

/** The shots of a clip as pieces of its frames, back to back from frame 0 to `frames` - only the frames the final video uses. */
export function shotPieces(frames: number, cuts: number[]): { start: number, frames: number }[] {
    const starts = [...new Set([0, ...cuts])].filter(f => f >= 0 && f < frames).sort((a, b) => a - b)
    return starts.map((start, i) => ({start, frames: (starts[i + 1] ?? frames) - start}))
}
