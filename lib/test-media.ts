/** Small real media for the tests that run ffmpeg (#1006): one place for the argument lists that were written out in each. */

/** Runs ffmpeg with `args` (after `-v error -y`) and throws what it says when it fails. */
export async function ffmpegMake(args: string[]): Promise<void> {
    const p = Bun.spawn(['ffmpeg', '-v', 'error', '-y', ...args], {stderr: 'pipe'})
    if ((await p.exited) !== 0) throw new Error(await new Response(p.stderr).text())
}

/** An mp4 of `frames` frames of ffmpeg's test pattern, with a sine's sound when `sound` (the shorter of the two ends it). */
export async function testVideo(
    file: string,
    {frames, size = '64x36', fps = 24, sound = false}: {frames: number; size?: string; fps?: number; sound?: boolean},
): Promise<void> {
    await ffmpegMake([
        '-f',
        'lavfi',
        '-i',
        `testsrc=size=${size}:rate=${fps}`,
        ...(sound ? ['-f', 'lavfi', '-i', 'sine=frequency=440', '-shortest'] : []),
        '-frames:v',
        String(frames),
        '-pix_fmt',
        'yuv420p',
        ...(sound ? ['-c:a', 'aac'] : []),
        file,
    ])
}
