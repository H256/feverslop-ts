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

/**
 * The lutyuv filter that maps `cur` onto `ref`: the luma stretched from cur's black/white to ref's, the chroma shifted.
 * strength < 1 goes only that part of the way; `enable` limits it to a time span of the video (ffmpeg timeline).
 */
export function matchFilter(ref: FrameStats, cur: FrameStats, strength = 1, enable?: string): string {
    const to = (key: keyof FrameStats) => cur[key] + strength * (ref[key] - cur[key])
    const gain = (to('yhigh') - to('ylow')) / Math.max(1, cur.yhigh - cur.ylow)
    const r = (n: number) => Math.round(n * 1000) / 1000
    return `lutyuv=y='clip((val-${r(cur.ylow)})*${r(gain)}+${r(to('ylow'))},16,235)':u='clip(val+${r(to('uavg') - cur.uavg)},16,240)':v='clip(val+${r(to('vavg') - cur.vavg)},16,240)'${enable ? `:enable='${enable}'` : ''}`
}

export type Span = { id: string, start: number, end: number }

/**
 * The signalstats of every clip of a joined video, by its time span in seconds: one ffmpeg pass over every `every`-th frame,
 * the frames within 0.1 s of a cut left out (a frame of the clip before can sit on the boundary).
 */
export async function clipStats(video: string, spans: Span[], every = 6): Promise<Map<string, FrameStats>> {
    const proc = Bun.spawn(['ffmpeg', '-v', 'info', '-i', video, '-vf', `select='not(mod(n\\,${every}))',signalstats,metadata=print`, '-an', '-f', 'null', '-'], {stdout: 'ignore', stderr: 'pipe'})
    const text = await new Response(proc.stderr).text()
    await proc.exited
    const frames: ({ t: number } & Partial<FrameStats>)[] = []
    const keys: Record<string, keyof FrameStats> = {YLOW: 'ylow', YHIGH: 'yhigh', UAVG: 'uavg', VAVG: 'vavg'}
    for (const line of text.split('\n')) {
        const time = line.match(/pts_time:([0-9.]+)/)
        if (time) frames.push({t: Number(time[1])})
        const value = line.match(/signalstats\.(YLOW|YHIGH|UAVG|VAVG)=([0-9.]+)/)
        if (value && frames.length) frames.at(-1)![keys[value[1]!]!] = Number(value[2])
    }
    if (!frames.length) throw new Error(`ffmpeg gave no signalstats for ${video}`)
    const stats = new Map<string, FrameStats>()
    for (const span of spans) {
        const inside = frames.filter(f => f.t >= span.start + 0.1 && f.t < span.end - 0.1 && f.ylow !== undefined)
        if (!inside.length) continue
        const mean = (key: keyof FrameStats) => inside.reduce((a, f) => a + f[key]!, 0) / inside.length
        stats.set(span.id, {ylow: mean('ylow'), yhigh: mean('yhigh'), uavg: mean('uavg'), vavg: mean('vavg')})
    }
    return stats
}

/** The middle value of every field over all clips - the reference when no clip is named: no single clip's mood. */
export function medianStats(all: FrameStats[]): FrameStats {
    const median = (key: keyof FrameStats) => {
        const sorted = all.map(s => s[key]).sort((a, b) => a - b)
        const mid = Math.floor(sorted.length / 2)
        return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
    }
    return {ylow: median('ylow'), yhigh: median('yhigh'), uavg: median('uavg'), vavg: median('vavg')}
}

/**
 * The color match of a joined video (finish.colorMatch): every clip, by its span, `strength` of the way to the reference - the
 * clip `reference` names, else the median of all clips. One lutyuv per clip, each enabled for its own span only.
 */
export async function colorMatchFilter(video: string, spans: Span[], strength: number, reference?: string): Promise<string> {
    const stats = await clipStats(video, spans)
    if (reference && !stats.has(reference)) throw new Error(`finish.colorReference: no clip ${reference} in ${video} - known are ${[...stats.keys()].join(', ')}`)
    const ref = reference ? stats.get(reference)! : medianStats([...stats.values()])
    return spans.flatMap(span => {
        const cur = stats.get(span.id)
        return cur ? [matchFilter(ref, cur, strength, `between(t,${span.start.toFixed(3)},${span.end.toFixed(3)})`)] : []
    }).join(',')
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
