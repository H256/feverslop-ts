// How much fine detail a clip has - to see whether continuing clips get grittier from link to link (#478). People who chain
// H3 shots report about 1.3x per join: skin, fabric and walls sharpen from clip to clip. Measured on the raw clips, never the
// finished ones (the finish sharpens on purpose).
//
// The measure is contrast-normalised Laplacian energy: the mean |Laplacian| of the luma divided by the mean local standard
// deviation, so a clip that is only brighter or more contrasty does not count as more detailed. Two scales: "fine" at the
// clip's own pixels, "structure" on a copy shrunk by 4 - there the 3x3 Laplacian sees roughly the 5-17 px band where the
// reported ratchet sits.

export type Texture = { fine: number, structure: number }

/** A grey picture: one byte of luma per pixel, row by row. */
export type Gray = { data: Uint8Array | Float32Array, width: number, height: number }

const WINDOW = 3   // local contrast over (2*WINDOW+1)^2 pixels

/** Contrast-normalised Laplacian energy of one picture - 0 for a flat one. */
export function laplacianEnergy({data, width, height}: Gray): number {
    if (width < 2 * WINDOW + 3 || height < 2 * WINDOW + 3) return 0
    // integral images of the luma and its square, for the local standard deviation
    const stride = width + 1
    const sum = new Float64Array(stride * (height + 1))
    const sq = new Float64Array(stride * (height + 1))
    for (let y = 0; y < height; y++) {
        let row = 0, rowSq = 0
        for (let x = 0; x < width; x++) {
            const v = data[y * width + x]!
            row += v
            rowSq += v * v
            sum[(y + 1) * stride + x + 1] = sum[y * stride + x + 1]! + row
            sq[(y + 1) * stride + x + 1] = sq[y * stride + x + 1]! + rowSq
        }
    }
    const n = (2 * WINDOW + 1) ** 2
    let laplace = 0, contrast = 0, count = 0
    for (let y = WINDOW + 1; y < height - WINDOW - 1; y++) {
        for (let x = WINDOW + 1; x < width - WINDOW - 1; x++) {
            const i = y * width + x
            laplace += Math.abs(4 * data[i]! - data[i - 1]! - data[i + 1]! - data[i - width]! - data[i + width]!)
            const x0 = x - WINDOW, x1 = x + WINDOW + 1, y0 = y - WINDOW, y1 = y + WINDOW + 1
            const s = sum[y1 * stride + x1]! - sum[y0 * stride + x1]! - sum[y1 * stride + x0]! + sum[y0 * stride + x0]!
            const s2 = sq[y1 * stride + x1]! - sq[y0 * stride + x1]! - sq[y1 * stride + x0]! + sq[y0 * stride + x0]!
            contrast += Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2))
            count++
        }
    }
    return contrast > 0 ? laplace / contrast : 0
}

/** The picture shrunk by `factor` in both directions, each new pixel the mean of the ones it covers. */
export function shrink({data, width, height}: Gray, factor: number): Gray {
    const w = Math.floor(width / factor), h = Math.floor(height / factor)
    const out = new Float32Array(w * h)
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let s = 0
            for (let dy = 0; dy < factor; dy++) for (let dx = 0; dx < factor; dx++) s += data[(y * factor + dy) * width + x * factor + dx]!
            out[y * w + x] = s / (factor * factor)
        }
    }
    return {data: out, width: w, height: h}
}

export const textureOf = (picture: Gray): Texture => ({fine: laplacianEnergy(picture), structure: laplacianEnergy(shrink(picture, 4))})

/**
 * The texture of a clip: the mean over frames sampled `fps` times a second, from `skip` seconds on - the first frames of a
 * continuing clip are the clip before it (its last frame, or its context frames), and would pull the two together.
 */
export async function clipTexture(file: string, size: { width: number, height: number }, opts: { fps?: number, skip?: number } = {}): Promise<Texture> {
    // raw frames over a pipe: the text helpers in lib/process.ts would decode them (as lib/leak.ts does)
    const proc = Bun.spawn(['ffmpeg', '-v', 'error', '-ss', String(opts.skip ?? 0.5), '-i', file, '-vf', `fps=${opts.fps ?? 2},format=gray`, '-f', 'rawvideo', '-'], {stdout: 'pipe', stderr: 'pipe'})
    const [raw, stderr, code] = await Promise.all([
        new Response(proc.stdout).arrayBuffer().then(b => new Uint8Array(b)),
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    if (code !== 0) throw new Error(`ffmpeg could not read ${file}:\n${stderr}`)
    const frameSize = size.width * size.height
    const frames = Math.floor(raw.length / frameSize)
    if (!frames) throw new Error(`${file}: no frames after ${opts.skip ?? 0.5} s`)
    let fine = 0, structure = 0
    for (let f = 0; f < frames; f++) {
        const t = textureOf({data: raw.subarray(f * frameSize, (f + 1) * frameSize), width: size.width, height: size.height})
        fine += t.fine
        structure += t.structure
    }
    return {fine: fine / frames, structure: structure / frames}
}

/** The factor per link that takes the first value to the last over the chain: (last / first)^(1 / links). */
export const perLink = (values: number[]) => values.length < 2 || !(values[0]! > 0) ? 1 : (values.at(-1)! / values[0]!) ** (1 / (values.length - 1))
