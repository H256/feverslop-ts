import {renameSync} from 'node:fs'
import {FPS} from './frames.ts'
import {runProcess} from './process.ts'

// Rendering part of a clip again (--retake=slot-007:3.2-5.0, or slot-007:shot2): the part is rendered between the frames around it, and
// joined into the clip with the sound it has. What is decided here needs no server; lib/render.ts sends the job.

export type RetakeAsk = {clip: string; seconds?: [number, number]; shot?: number}

/** "slot-007:3.2-5.0" or "slot-007:shot2". */
export function parseRetake(text: string): RetakeAsk {
    const match = /^([a-z]+-\d+):(?:(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)|shot(\d+))$/.exec(text)
    if (!match) throw new Error(`--retake: "${text}" is not <clip>:<from>-<to> in seconds or <clip>:shot<n> - e.g. slot-007:3.2-5.0 or slot-007:shot2`)
    if (match[4]) return {clip: match[1]!, shot: Number(match[4])}
    return {clip: match[1]!, seconds: [Number(match[2]), Number(match[3])]}
}

// where each shot of the file starts, the first one at 0 - `cuts` as lib/interpolate.ts finds them (shotCuts) has 0 among them
const shotStarts = (cuts: number[]) => [0, ...cuts.filter(cut => cut > 0)]

/**
 * The frames [first, end) of the clip's file the part means. Shots are named where the picture cuts: `cuts` are the first frames of the
 * shots, as lib/interpolate.ts finds them - with or without the 0 of the first one. Never frames the file does not have, and never nothing.
 */
export function retakeFrames(ask: RetakeAsk, fileFrames: number, cuts: number[]): {first: number; end: number} {
    let first: number, end: number
    if (ask.shot !== undefined) {
        const starts = shotStarts(cuts)
        if (ask.shot < 1 || ask.shot > starts.length) throw new Error(`${ask.clip} has ${starts.length} shot(s), not a shot ${ask.shot}`)
        first = starts[ask.shot - 1]!
        end = starts[ask.shot] ?? fileFrames
    } else {
        first = Math.round(ask.seconds![0] * FPS)
        end = Math.round(ask.seconds![1] * FPS)
    }
    end = Math.min(end, fileFrames)
    if (first >= end) throw new Error(`${ask.clip}: no frames in that part - the file has ${fileFrames} frames (${(fileFrames / FPS).toFixed(2)} s)`)
    return {first, end}
}

export type RetakePlan = {
    first: number
    end: number
    lead: number // frames of the clip before the part at the start of the render: the guide they are locked to
    singleStart: boolean // too little before the part for a batch of frames: only the frame right before it
    frames: number // the part's own frames
    render: number // the frames the job renders, in a length the model takes
    endAt?: number // the frame of the render that is guided to the frame after the part - none when the part goes to the end of the file
}

/** How the job is laid out. The extra frames a length the model takes brings are cut off when the part is joined in, after the guide. */
export function planRetake(
    {first, end}: {first: number; end: number},
    fileFrames: number,
    wantedLead: number,
    renderFrames: (frames: number) => number,
): RetakePlan {
    // 5 + 17·k frames in a batch, as context frames are; fewer than that before the part: the one frame right before it
    let lead = Math.min(wantedLead, first)
    while (lead > 5 && lead % 17 !== 5) lead--
    const batch = lead >= 5
    const before = batch ? lead : 0
    const frames = end - first
    const guided = end < fileFrames
    const render = renderFrames(before + frames + (guided ? 1 : 0))
    return {first, end, lead: before, singleStart: !batch && first > 0, frames, render, ...(guided ? {endAt: before + frames} : {})}
}

/**
 * The clip's prompt for some of its shots: what comes before the first [Shot n], and the sections of those shots. The labels are the
 * prompt's own markup (lib/compose.ts). A prompt without them stays as it is.
 */
export function retakePrompt(prompt: string, shots: number[]): string {
    const at = [...prompt.matchAll(/\[Shot (\d+)\]/g)]
    if (!at.length) return prompt
    const head = prompt.slice(0, at[0]!.index)
    const kept = at.flatMap((match, n) => (shots.includes(Number(match[1])) ? [prompt.slice(match.index, at[n + 1]?.index ?? prompt.length)] : []))
    return kept.length ? head + kept.join('') : prompt
}

/** The numbers of the shots (from 1) a part of the clip touches. */
export function shotsIn({first, end}: {first: number; end: number}, cuts: number[]): number[] {
    const starts = shotStarts(cuts)
    return starts.flatMap((start, n) => (first < (starts[n + 1] ?? Infinity) && end > start ? [n + 1] : []))
}

/** Puts the part into the clip: the head and the tail of the old file, the new frames between them, the old sound under all of it. Written next to `target` first. */
export async function spliceVideo({
    original,
    rendered,
    plan,
    width,
    height,
    target,
}: {
    original: string
    rendered: string
    plan: Pick<RetakePlan, 'first' | 'end' | 'lead' | 'frames'>
    width: number
    height: number
    target: string
}) {
    const {first, end, lead, frames} = plan
    const format = `setpts=PTS-STARTPTS,scale=${width}:${height},setsar=1,format=yuv420p`
    const pieces = [
        ...(first > 0 ? [`[0:v]trim=end_frame=${first},${format}[head]`] : []),
        `[1:v]trim=start_frame=${lead}:end_frame=${lead + frames},${format}[part]`,
        `[0:v]trim=start_frame=${end},${format}[tail]`,
    ]
    const labels = `${first > 0 ? '[head]' : ''}[part][tail]`
    const partial = target.replace(/\.mp4$/, '.splice.mp4')
    await runProcess(
        [
            'ffmpeg',
            '-y',
            '-v',
            'error',
            '-i',
            original,
            '-i',
            rendered,
            '-filter_complex',
            `${pieces.join(';')};${labels}concat=n=${first > 0 ? 3 : 2}:v=1:a=0[v]`,
            '-map',
            '[v]',
            '-map',
            '0:a?',
            '-c:v',
            'libx264',
            '-preset',
            'medium',
            '-crf',
            '14',
            '-pix_fmt',
            'yuv420p',
            '-c:a',
            'copy',
            '-r',
            String(FPS),
            partial,
        ],
        {errorMessage: err => `ffmpeg could not join the new part into ${original}:\n${err}`},
    )
    renameSync(partial, target)
}
