import {existsSync, renameSync} from "node:fs";
import {join} from "node:path";
import {formatSlotRanges, probeVideo} from "../assemble.ts";
import {FPS, formatTime, secondsAt} from "../frames.ts";
import {log, startSpinner, styles} from "../log.ts";

// a clip's sound starts and ends with a very short fade, so that no click is heard where two clips meet
const FADE_SEC = 0.02
// what every clip's sound is brought to - the model's own is 32 kHz
const SAMPLE_RATE = 48000

/**
 * Builds the film: every clip cut to exactly its own frames from frame 0 on - the frames past that were only rendered because
 * the model needs certain lengths - and joined, with the sound the model made for each clip. Unlike the music-video
 * pipeline there is no soundtrack under the film, so the clips' own sound is the film's sound.
 */
export async function assembleFilm({clips, projectDir, target}: {
    clips: { id: string, frames: number }[],
    projectDir: string,
    target: string,
}) {
    const files = clips.map(c => join(projectDir, 'videos', `${c.id}.mp4`))
    const missing = clips.filter((_, i) => !existsSync(files[i]!)).map(c => c.id)
    if (missing.length) throw new Error(`Can't assemble - ${missing.length} of ${clips.length} clip(s) not rendered yet: ${formatSlotRanges(missing)}\nRender them first: --render=videos --only=${missing.join(',')}`)

    const infos = await Promise.all(files.map(probeVideo))
    clips.forEach((clip, i) => {
        if (infos[i]!.frames < clip.frames) throw new Error(`videos/${clip.id}.mp4 has ${infos[i]!.frames} frames, but the clip needs ${clip.frames} - delete it and render again`)
        if (!infos[i]!.hasAudio) throw new Error(`videos/${clip.id}.mp4 has no audio - the film's sound comes from the clips: delete it and render again`)
    })

    // all clips at the size of the first one, in case the resolution changed between renders
    const {width, height} = infos[0]!
    const resized = infos.filter(i => i.width !== width || i.height !== height).length
    if (resized) log.warn(`${resized} clip(s) have another size than ${width}x${height} and are scaled`)
    // a clip at another frame rate would play at the wrong speed once its frames are counted on the 24 fps grid
    const resampled = infos.filter(i => Math.abs(i.fps - FPS) > 0.01).length
    if (resampled) log.warn(`${resampled} clip(s) have another frame rate than ${FPS} fps and are resampled`)

    const totalFrames = clips.reduce((sum, c) => sum + c.frames, 0)
    const filters = clips.map((clip, i) => {
        const seconds = secondsAt(clip.frames)
        return [
            `[${i}:v]${Math.abs(infos[i]!.fps - FPS) > 0.01 ? `fps=${FPS},` : ''}trim=end_frame=${clip.frames},setpts=PTS-STARTPTS,scale=${width}:${height},setsar=1,format=yuv420p[v${i}]`,
            `[${i}:a]aresample=${SAMPLE_RATE},aformat=channel_layouts=stereo,atrim=end=${seconds},asetpts=PTS-STARTPTS,afade=t=in:d=${FADE_SEC},afade=t=out:st=${Math.max(0, seconds - FADE_SEC)}:d=${FADE_SEC}[a${i}]`,
        ].join(';')
    })
    filters.push(`${clips.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${clips.length}:v=1:a=1[v][a]`)

    const partial = `${target}.partial.mp4`
    const args = [
        'ffmpeg', '-y', '-v', 'error', '-progress', 'pipe:1', '-nostats',
        ...files.flatMap(f => ['-i', f]),
        '-filter_complex', filters.join(';'),
        '-map', '[v]', '-map', '[a]',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS),
        '-c:a', 'aac', '-b:a', '256k',
        '-movflags', '+faststart',
        partial,
    ]

    let frame = 0
    const stopSpinner = startSpinner(() => `${styles.name('ffmpeg')} ${styles.muted(`frame ${frame} / ${totalFrames}`)}`)
    try {
        const proc = Bun.spawn(args, {stdout: 'pipe', stderr: 'pipe'})
        const stderr = new Response(proc.stderr).text()
        for await (const chunk of proc.stdout) {
            const match = new TextDecoder().decode(chunk).match(/frame=(\d+)/g)
            if (match) frame = Number(match.at(-1)!.slice(6))
        }
        if (await proc.exited !== 0) throw new Error(`ffmpeg failed:\n${await stderr}`)
    } finally {
        stopSpinner()
    }
    renameSync(partial, target)

    const result = await probeVideo(target)
    if (result.frames !== totalFrames) log.warn(`the film has ${result.frames} frames, expected ${totalFrames}`)
    return {frames: result.frames, width, height, seconds: secondsAt(result.frames), duration: formatTime(secondsAt(result.frames), true)}
}
