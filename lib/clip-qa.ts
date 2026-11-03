// What else a rendered clip can come out with, by the seed: black frames, a picture that stands still for seconds, a hard jump the
// plan has no cut for (#405). Measured on the pixels alone, with ffmpeg, as lib/leak.ts does the grey backdrop: no model, no word
// list. A finding says where it is. Only black and frozen are a reason to render again: on our own clips (#405) every jump the
// plan has no cut for was a planned cut a little early or late, or one more cut in the same place - said, not rendered again.
// A picture that stands still is counted only where there is light enough to see a move.

import {existsSync, mkdirSync, renameSync} from "node:fs";
import {basename, join} from "node:path";

// small and grey: the brightness and how much moves is all that is measured
const WIDTH = 160
const HEIGHT = 90

export type FrameStats = { mean: number, peak: number, diff: number }
export type Finding = { kind: 'black' | 'frozen' | 'cut', at: number, seconds: number }

/** The thresholds, on 8-bit grey values. Start values from #405, checked against our own clips (see the PR). */
export const QA = {
    black: {mean: 4, peak: 20, seconds: 0.25},
    // only in a picture with light enough: in a dark one a real move is a small difference too (a dark corridor read as standing still)
    frozen: {diff: 0.25, seconds: 1.5, mean: 16},
    cut: {diff: 28, times: 8},
    // the model does not cut on the frame: a jump this near a cut the plan has is that cut
    planned: 0.6,
}

/** The mean brightness, the bright peak (99th percentile) and the mean absolute difference to the frame before. */
export function frameStats(frame: Uint8Array, before?: Uint8Array): FrameStats {
    const histogram = new Uint32Array(256)
    let sum = 0, diff = 0
    for (let i = 0; i < frame.length; i++) {
        const v = frame[i]!
        histogram[v]!++
        sum += v
        if (before) diff += Math.abs(v - before[i]!)
    }
    let peak = 255
    for (let v = 0, seen = 0; v < 256; v++) {
        seen += histogram[v]!
        if (seen >= frame.length * 0.99) { peak = v; break }
    }
    return {mean: sum / frame.length, peak, diff: before ? diff / frame.length : 0}
}

const median = (values: number[]) => {
    if (!values.length) return 0
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[sorted.length >> 1]!
}

/** Runs of frames for which `hit` holds, at least `seconds` long, as findings. */
function runs(stats: FrameStats[], fps: number, kind: Finding['kind'], seconds: number, hit: (s: FrameStats, n: number) => boolean): Finding[] {
    const found: Finding[] = []
    let start = -1
    for (let n = 0; n <= stats.length; n++) {
        const on = n < stats.length && hit(stats[n]!, n)
        if (on && start < 0) start = n
        if (!on && start >= 0) {
            if ((n - start) / fps >= seconds) found.push({kind, at: start / fps, seconds: (n - start) / fps})
            start = -1
        }
    }
    return found
}

/** What is wrong with a clip, from the stats of its frames in order. `cuts`: the seconds its plan cuts to another shot. */
export function findProblems(stats: FrameStats[], fps: number, cuts: number[] = []): Finding[] {
    const isBlack = (s: FrameStats) => s.mean < QA.black.mean && s.peak < QA.black.peak
    const black = runs(stats, fps, 'black', QA.black.seconds, isBlack)
    // standing still: frame after frame hardly changes - a black stretch is a black finding, not also a frozen one
    const frozen = runs(stats, fps, 'frozen', QA.frozen.seconds, (s, n) => n > 0 && s.diff < QA.frozen.diff && s.mean >= QA.frozen.mean)
    // a jump: one frame changes far more than the clip moves at all (its median), and more than a fast move does
    const typical = median(stats.slice(1).map(s => s.diff))
    const planned = (at: number) => cuts.some(c => Math.abs(c - at) <= QA.planned)
    const cut = stats.flatMap((s, n) => n > 0 && !isBlack(s) && !isBlack(stats[n - 1]!) && s.diff > QA.cut.diff && s.diff > QA.cut.times * typical && !planned(n / fps) ? [{kind: 'cut' as const, at: n / fps, seconds: 0}] : [])
    return [...black, ...frozen, ...cut].sort((a, b) => a.at - b.at)
}

/** How bad a take is: every finding counts 10, and its length in seconds on top - the better of two takes has the lower score. */
export const scoreOf = (findings: Finding[]) => findings.reduce((sum, f) => sum + 10 + f.seconds, 0)

/** The stats of the first `frames` frames of a video (all, when not given), decoded small and grey. */
export async function clipStats(video: string, frames?: number): Promise<{ stats: FrameStats[], fps: number }> {
    const probe = Bun.spawn(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', video], {stdout: 'pipe', stderr: 'pipe'})
    const [rate] = await Promise.all([new Response(probe.stdout).text(), probe.exited])
    const [num, den] = rate.trim().split('/').map(Number)
    const fps = num && den ? num / den : 24
    const proc = Bun.spawn(['ffmpeg', '-v', 'error', '-i', video, ...(frames ? ['-frames:v', String(frames)] : []), '-vf', `scale=${WIDTH}:${HEIGHT}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], {stdout: 'pipe', stderr: 'pipe'})
    const [bytes, stderr, code] = await Promise.all([
        new Response(proc.stdout).arrayBuffer().then(b => new Uint8Array(b)),
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    if (code !== 0) throw new Error(`ffmpeg failed to read ${video} for the clip check:\n${stderr}`)
    const size = WIDTH * HEIGHT
    const stats: FrameStats[] = []
    for (let n = 0; (n + 1) * size <= bytes.length; n++) {
        stats.push(frameStats(bytes.subarray(n * size, (n + 1) * size), n ? bytes.subarray((n - 1) * size, n * size) : undefined))
    }
    return {stats, fps}
}

/** What is wrong with a rendered clip, in its first `frames` frames: those the video shows. `cuts`: where its plan cuts. */
export async function checkClip(video: string, cuts: number[], frames?: number): Promise<Finding[]> {
    const {stats, fps} = await clipStats(video, frames)
    return findProblems(stats, fps, cuts)
}

export const describe = (findings: Finding[]) => findings.map(f => f.kind === 'cut' ? `a jump at ${f.at.toFixed(1)} s` : `${f.kind} ${f.at.toFixed(1)}-${(f.at + f.seconds).toFixed(1)} s`).join(', ')

/** What happened to the takes of a clip: rendered again, or the take before kept since the new one was worse. */
export type TakeEvent =
    | { kind: 'again', findings: Finding[], seed: number, attempt: number, put: string }
    | { kind: 'kept', seed: number, worse: number, findings: Finding[], put: string }

const isHard = (f: Finding) => f.kind !== 'cut'

/**
 * The best take of a clip: while it has black or standing frames and retries are left, it is put away (`putAway(seed)`, a folder)
 * and the clip made again with a derived seed (first + 7919·k, not a new random one), and the take with the lower score kept - the
 * other one stays put away. The clip file and its sidecar (.json) move together. `said` hears what happened.
 */
export async function bestTake(o: { target: string, seed: number, retries: number, check: () => Promise<Finding[]>, again: (seed: number) => Promise<number>, putAway: (seed: number) => string, said?: (event: TakeEvent) => void }): Promise<{ seed: number, findings: Finding[] }> {
    const move = (from: string, to: string) => { for (const suffix of ['', '.json']) if (existsSync(from + suffix)) renameSync(from + suffix, to + suffix) }
    let seed = o.seed
    let findings = await o.check()
    for (let k = 1; k <= o.retries && findings.some(isHard); k++) {
        const kept = o.putAway(seed)
        mkdirSync(kept, {recursive: true})
        move(o.target, join(kept, basename(o.target)))
        const derived = o.seed + 7919 * k
        o.said?.({kind: 'again', findings: findings.filter(isHard), seed: derived, attempt: k, put: kept})
        const taken = await o.again(derived)
        const next = await o.check()
        if (scoreOf(next) <= scoreOf(findings)) {
            seed = taken
            findings = next
            continue
        }
        // the take before was better: it comes back, the new one is put away
        const worse = o.putAway(taken)
        mkdirSync(worse, {recursive: true})
        move(o.target, join(worse, basename(o.target)))
        move(join(kept, basename(o.target)), o.target)
        o.said?.({kind: 'kept', seed, worse: taken, findings: next.filter(isHard), put: worse})
    }
    return {seed, findings}
}
