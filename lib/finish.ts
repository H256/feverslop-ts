import {renameSync} from "node:fs";
import {runProcess} from "./process.ts";

// The finishing pass of the final video (issue #291): the clips come out a little milky - the darkest tenth of a frame sits at
// level ~29 instead of 16 (measured on tides-261017, turbo and two-pass alike, with and without "haze" in the prompt) - and
// soft. A light grade and a contrast-adaptive sharpen (ffmpeg cas: least halos and artifacts of the sharpeners tried) are
// done on the joined video, written next to it; the video itself stays as it is.

export type Finish = {
    blackLevel: number,     // 0-1 of the range taken as black (colorlevels *imin): 0.025 = the "mild" grade
    whiteLevel: number,     // 0-1 of the range taken as white (colorlevels *imax)
    contrast: number,       // ffmpeg eq: 1 = unchanged
    saturation: number,     // ffmpeg eq: 1 = unchanged
    sharpen: number,        // ffmpeg cas strength 0-1, 0 = off
}

/** "mild" - the strongest grade that still looked right on tides-261017 (black level, contrast, saturation, CAS 0.4). */
export const MILD_FINISH: Finish = {blackLevel: 0.025, whiteLevel: 0.98, contrast: 1.03, saturation: 1.03, sharpen: 0.4}

/** The finish of a config value: true = the mild one, an object = the mild one with its fields replaced. */
export const finishOf = (value: boolean | Partial<Finish>): Finish | undefined =>
    value === false ? undefined : value === true ? MILD_FINISH : {...MILD_FINISH, ...value}

/** What is wrong with a finish setting - ffmpeg refuses these values - or undefined. */
export function finishProblem(f: Finish): string | undefined {
    for (const key of ['blackLevel', 'whiteLevel', 'sharpen'] as const) {
        if (!Number.isFinite(f[key]) || f[key] < 0 || f[key] > 1) return `${key} must be between 0 and 1, got ${JSON.stringify(f[key])}`
    }
    if (f.blackLevel >= f.whiteLevel) return `blackLevel (${f.blackLevel}) must be below whiteLevel (${f.whiteLevel})`
    for (const key of ['contrast', 'saturation'] as const) {
        if (!Number.isFinite(f[key]) || f[key] <= 0) return `${key} must be a positive number, 1 = unchanged, got ${JSON.stringify(f[key])}`
    }
    return undefined
}

/** The ffmpeg filter chain of a finish. */
export function finishFilter(f: Finish): string {
    const lv = (k: 'imin' | 'imax', v: number) => ['r', 'g', 'b'].map(c => `${c}${k}=${v}`).join(':')
    return [
        `colorlevels=${lv('imin', f.blackLevel)}:${lv('imax', f.whiteLevel)}`,
        `eq=contrast=${f.contrast}:saturation=${f.saturation}`,
        ...(f.sharpen > 0 ? [`cas=strength=${f.sharpen}`] : []),
    ].join(',')
}

/** `<name>.mp4` -> `<name>-finished.mp4` */
export const finishedName = (video: string) => video.replace(/\.mp4$/, '-finished.mp4')

/** Writes the finished copy of a video next to it; the sound is copied as it is. */
export async function finishVideo(video: string, f: Finish): Promise<string> {
    const target = finishedName(video)
    const partial = `${target}.partial.mp4`
    await runProcess(['ffmpeg', '-y', '-v', 'error', '-i', video, '-vf', finishFilter(f),
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', partial],
        {errorMessage: err => `ffmpeg could not finish ${video}:\n${err}`})
    renameSync(partial, target)
    return target
}
