// The loudness of a sound file over time - for the Timing page and for the alignment of the lyrics.

/**
 * How loud each of `buckets` equal parts of 16-bit mono sound is, 0 to 1 with 1 the loudest part. Loudness and not the
 * highest sample: in a mastered song nearly every part reaches the top, and the verses would look like the chorus.
 */
export function peaks(samples: Int16Array, buckets: number): number[] {
    const sums = new Array<number>(buckets).fill(0)
    const counts = new Array<number>(buckets).fill(0)
    for (let i = 0; i < samples.length; i++) {
        const bucket = Math.floor((i / samples.length) * buckets)
        sums[bucket]! += samples[i]! * samples[i]!
        counts[bucket]!++
    }
    const levels = sums.map((sum, bucket) => (counts[bucket] ? Math.sqrt(sum / counts[bucket]!) : 0))
    const loudest = Math.max(...levels, 1)
    return levels.map(level => Math.round((level / loudest) * 1000) / 1000)
}

/** The loudness at a fixed rate (values per second) - fine enough to see where a word starts, for the Timing page. */
export async function readFineWaveform(file: string, perSecond: number): Promise<number[] | undefined> {
    const rate = 8000
    const proc = Bun.spawn(['ffmpeg', '-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(rate), '-f', 's16le', '-'], {
        stdout: 'pipe',
        stderr: 'ignore',
        stdin: 'ignore',
    })
    const bytes = await new Response(proc.stdout).arrayBuffer()
    if ((await proc.exited) !== 0) return undefined
    const samples = new Int16Array(bytes, 0, Math.floor(bytes.byteLength / 2))
    return peaks(samples, Math.max(1, Math.round((samples.length / rate) * perSecond)))
}
