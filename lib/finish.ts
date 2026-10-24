import {renameSync} from "node:fs";
import {colorMatchFilter, type Span} from "./colormatch.ts";
import {probeVideo} from "./assemble.ts";
import {startSpinner, styles} from "./log.ts";

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
    // every clip this part of the way (0-1) to one reference in black, white and mean color, so the cuts do not jump - 0 = off
    colorMatch: number,
    colorReference: string, // the clip id of that reference, e.g. "slot-014" - '' = the median of all clips
    grain: number,          // film grain over everything, last (ffmpeg noise strength, 0-100), 0 = off
}

/** "mild" - the strongest grade that still looked right on tides-261017 (black level, contrast, saturation, CAS 0.4). */
export const MILD_FINISH: Finish = {blackLevel: 0.025, whiteLevel: 0.98, contrast: 1.03, saturation: 1.03, sharpen: 0.4, colorMatch: 0, colorReference: '', grain: 0}

/** The finish of a config value: true = the mild one, an object = the mild one with its fields replaced. */
export const finishOf = (value: boolean | Partial<Finish>): Finish | undefined =>
    value === false ? undefined : value === true ? MILD_FINISH : {...MILD_FINISH, ...value}

/** What is wrong with a finish setting - ffmpeg refuses these values - or undefined. */
export function finishProblem(f: Finish): string | undefined {
    for (const key of ['blackLevel', 'whiteLevel', 'sharpen', 'colorMatch'] as const) {
        if (!Number.isFinite(f[key]) || f[key] < 0 || f[key] > 1) return `${key} must be between 0 and 1, got ${JSON.stringify(f[key])}`
    }
    if (f.blackLevel >= f.whiteLevel) return `blackLevel (${f.blackLevel}) must be below whiteLevel (${f.whiteLevel})`
    for (const key of ['contrast', 'saturation'] as const) {
        if (!Number.isFinite(f[key]) || f[key] <= 0) return `${key} must be a positive number, 1 = unchanged, got ${JSON.stringify(f[key])}`
    }
    if (!Number.isFinite(f.grain) || f.grain < 0 || f.grain > 100) return `grain must be between 0 and 100, got ${JSON.stringify(f.grain)}`
    if (typeof f.colorReference !== 'string') return `colorReference must be a clip id like "slot-014" or "", got ${JSON.stringify(f.colorReference)}`
    return undefined
}

/**
 * The ffmpeg filter chain of a finish: the clips matched to each other first (`match`, colorMatchFilter), then the grade
 * and the sharpen, the grain last - sharpened grain is harsh.
 */
export function finishFilter(f: Finish, match?: string): string {
    const lv = (k: 'imin' | 'imax', v: number) => ['r', 'g', 'b'].map(c => `${c}${k}=${v}`).join(':')
    return [
        ...(match ? [match] : []),
        `colorlevels=${lv('imin', f.blackLevel)}:${lv('imax', f.whiteLevel)}`,
        `eq=contrast=${f.contrast}:saturation=${f.saturation}`,
        ...(f.sharpen > 0 ? [`cas=strength=${f.sharpen}`] : []),
        ...(f.grain > 0 ? [`noise=alls=${f.grain}:allf=t+u`] : []),
    ].join(',')
}

/** `<name>.mp4` -> `<name>-finished.mp4` */
export const finishedName = (video: string) => video.replace(/\.mp4$/, '-finished.mp4')

/**
 * Writes the finished copy of a video next to it; the sound is copied as it is. `spans`: where each clip is in the video, in
 * seconds - needed for the color match. Returns the file and the filter chain used.
 */
export async function finishVideo(video: string, f: Finish, spans: Span[] = []): Promise<{ file: string, filter: string }> {
    const target = finishedName(video)
    const partial = `${target}.partial.mp4`
    const total = (await probeVideo(video)).frames
    // the match, the grade and the sharpen run on the CPU - minutes for a whole song, so they show what they are at
    let frame = 0
    let stage = f.colorMatch > 0 && spans.length ? 'matching the clips' : 'grading'
    const stopSpinner = startSpinner(() => `${styles.name('ffmpeg')} ${styles.muted(`finishing: ${stage}${frame ? ` - frame ${frame} / ${total}` : ''}`)}`)
    let filter: string
    try {
        const match = f.colorMatch > 0 && spans.length ? await colorMatchFilter(video, spans, f.colorMatch, f.colorReference || undefined) : undefined
        filter = finishFilter(f, match)
        stage = 'grading and sharpening'
        const proc = Bun.spawn(['ffmpeg', '-y', '-v', 'error', '-progress', 'pipe:1', '-nostats', '-i', video, '-vf', filter,
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', partial], {stdout: 'pipe', stderr: 'pipe'})
        const stderr = new Response(proc.stderr).text()
        for await (const chunk of proc.stdout) {
            const found = new TextDecoder().decode(chunk).match(/frame=(\d+)/g)
            if (found) frame = Number(found.at(-1)!.slice(6))
        }
        if (await proc.exited !== 0) throw new Error(`ffmpeg could not finish ${video}:\n${await stderr}`)
    } finally {
        stopSpinner()
    }
    renameSync(partial, target)
    return {file: target, filter}
}
