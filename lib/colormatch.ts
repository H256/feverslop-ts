import {renameSync} from "node:fs";
import {runProcess} from "./process.ts";

// A continuing clip is drawn on its own and comes out with its own exposure: on tides slot-013 -> 014 the new clip started
// darker and flatter (black 33 -> 29, white 157 -> 151, mean 81 -> 77) - a visible step at a cut that is no cut. The clip is
// matched as a whole to the last frames of the one before: black and white of the luma, the mean of the two chroma channels.

export type FrameStats = { ylow: number, yhigh: number, uavg: number, vavg: number }

/** The mean of ffmpeg's signalstats over frames `from` to `to` (inclusive) of a video. */
export async function frameStats(video: string, from: number, to: number): Promise<FrameStats> {
    // metadata=print writes to stderr
    const proc = Bun.spawn(['ffmpeg', '-v', 'info', '-i', video, '-vf', `select='between(n\\,${from}\\,${to})',signalstats,metadata=print`, '-an', '-f', 'null', '-'], {stdout: 'ignore', stderr: 'pipe'})
    const text = await new Response(proc.stderr).text()
    await proc.exited
    const mean = (key: string) => {
        const values = [...text.matchAll(new RegExp(`signalstats\\.${key}=([0-9.]+)`, 'g'))].map(m => Number(m[1]))
        if (!values.length) throw new Error(`ffmpeg gave no ${key} for frames ${from}-${to} of ${video}`)
        return values.reduce((a, b) => a + b, 0) / values.length
    }
    return {ylow: mean('YLOW'), yhigh: mean('YHIGH'), uavg: mean('UAVG'), vavg: mean('VAVG')}
}

/** The lutyuv filter that maps `cur` onto `ref`: the luma stretched from cur's black/white to ref's, the chroma shifted. */
export function matchFilter(ref: FrameStats, cur: FrameStats): string {
    const gain = (ref.yhigh - ref.ylow) / Math.max(1, cur.yhigh - cur.ylow)
    const r = (n: number) => Math.round(n * 1000) / 1000
    return `lutyuv=y='clip((val-${r(cur.ylow)})*${r(gain)}+${r(ref.ylow)},16,235)':u='clip(val+${r(ref.uavg - cur.uavg)},16,240)':v='clip(val+${r(ref.vavg - cur.vavg)},16,240)'`
}

/** Matches `video` as a whole to frames `refFrom`-`refTo` of `ref`, measured on its own first frames; sound copied. */
export async function matchColors(video: string, ref: string, refFrom: number, refTo: number, frames = 4): Promise<string> {
    const filter = matchFilter(await frameStats(ref, refFrom, refTo), await frameStats(video, 0, frames - 1))
    const partial = video.replace(/\.mp4$/, '.match.mp4')
    await runProcess(['ffmpeg', '-y', '-v', 'error', '-i', video, '-vf', filter, '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-pix_fmt', 'yuv420p', '-c:a', 'copy', partial],
        {errorMessage: err => `ffmpeg could not match the colors of ${video}:\n${err}`})
    renameSync(partial, video)
    return filter
}
