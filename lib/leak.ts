// Reference leakage: now and then a shot comes out as the reference pictures lined up in front of their own plain grey
// studio backdrop instead of the figures standing in the place (see the retention lines in lib/compose.ts). It is
// seed-dependent and rare, so a render can be checked for it and made again with another seed.

// the frames are looked at small - a backdrop is a large flat area, the detail does not matter
const WIDTH = 96
const HEIGHT = 54
const TOP_ROWS = 8          // the band of the picture above the heads, where a studio backdrop shows first
const SAMPLE_FPS = 4

/**
 * Whether an RGB frame (WIDTH x HEIGHT, 3 bytes a pixel) has a flat grey backdrop along its top: most of the band
 * sits close to the band's own median grey, hardly any colour, neither dark nor bright. A cave, a sky or a fire is
 * not flat, and a dark set stays below the brightness a lit backdrop has.
 */
export function hasFlatBackdrop(frame: Uint8Array): boolean {
    const values: number[] = []
    let colour = 0
    for (let y = 0; y < TOP_ROWS; y++) for (let x = 0; x < WIDTH; x++) {
        const i = (y * WIDTH + x) * 3
        const r = frame[i]!, g = frame[i + 1]!, b = frame[i + 2]!
        values.push((r + g + b) / 3)
        colour += Math.max(r, g, b) - Math.min(r, g, b)
    }
    const median = [...values].sort((a, b) => a - b)[values.length >> 1]!
    const near = values.filter(v => Math.abs(v - median) < 14).length / values.length
    return median > 70 && median < 170 && colour / values.length < 30 && near > 0.6
}

/** How long a run of flagged samples has to be before a clip counts as leaked: a single flash or fade frame is not one. */
const MIN_RUN_SEC = 1

/** Whether the flagged seconds (from backdropSeconds) hold a run of at least MIN_RUN_SEC. */
export function hasBackdropRun(seconds: number[]): boolean {
    const need = Math.ceil(MIN_RUN_SEC * SAMPLE_FPS)
    let run = 0
    for (const [n, s] of seconds.entries()) {
        run = n > 0 && Math.abs(s - seconds[n - 1]! - 1 / SAMPLE_FPS) < 1e-6 ? run + 1 : 1
        if (run >= need) return true
    }
    return false
}

/** The seconds of a video at which a frame has a flat grey backdrop (sampled four times a second) - none when it is clean. */
export async function backdropSeconds(video: string): Promise<number[]> {
    // raw frames over a pipe: the text helpers in lib/process.ts would decode them
    const proc = Bun.spawn(
        ["ffmpeg", "-v", "error", "-i", video, "-vf", `fps=${SAMPLE_FPS},scale=${WIDTH}:${HEIGHT}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        {stdout: "pipe", stderr: "pipe"},
    )
    const [bytes, stderr, code] = await Promise.all([
        new Response(proc.stdout).arrayBuffer().then(b => new Uint8Array(b)),
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    if (code !== 0) throw new Error(`ffmpeg failed to read ${video} for the backdrop check:\n${stderr}`)
    const size = WIDTH * HEIGHT * 3
    const seconds: number[] = []
    for (let n = 0; (n + 1) * size <= bytes.length; n++) {
        if (hasFlatBackdrop(bytes.subarray(n * size, (n + 1) * size))) seconds.push(n / SAMPLE_FPS)
    }
    return seconds
}
