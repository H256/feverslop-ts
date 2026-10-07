import {existsSync, readFileSync, renameSync} from "node:fs";
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
    // useRendered: use every frame the model rendered, not only the planned ones - for a clip with dialogue, whose last word can fall
    // into the few frames after the planned end. promptHash: the hash of the prompt planned now - a clip rendered from another one is stale
    // continuesPrevious: the clip starts on the last frame of the clip right before it in the film - that frame is already there, the clip's first frame is the same picture and is left out (it would stand twice and stutter)
    clips: { id: string, frames: number, useRendered?: boolean, continuesPrevious?: boolean, promptHash?: string }[],
    projectDir: string,
    target: string,
}) {
    const files = clips.map(c => join(projectDir, 'videos', `${c.id}.mp4`))
    const missing = clips.filter((_, i) => !existsSync(files[i]!)).map(c => c.id)
    if (missing.length) throw new Error(`Can't assemble - ${missing.length} of ${clips.length} clip(s) not rendered yet: ${formatSlotRanges(missing)}\nRender them first: --render=videos --only=${missing.join(',')}`)

    const infos = await Promise.all(files.map(probeVideo))
    // a clip rendered from another prompt than the one planned now belongs to another version of the film
    const stale = clips.filter(c => {
        const meta = join(projectDir, 'videos', `${c.id}.mp4.json`)
        const rendered = existsSync(meta) ? JSON.parse(readFileSync(meta, 'utf8')).promptHash : undefined
        return c.promptHash !== undefined && rendered !== undefined && rendered !== c.promptHash
    }).map(c => c.id)
    if (stale.length) throw new Error(`${stale.length} clip(s) were rendered from another prompt than the plan has now: ${formatSlotRanges(stale)}\nDelete videos/<clip-id>.mp4 (and its .json) of those and render them again: --render=videos --only=${stale.join(',')}`)
    // the frames each clip contributes
    const used = clips.map((c, i) => c.useRendered ? infos[i]!.frames : c.frames)
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

    const skipped = clips.map(c => c.continuesPrevious ? 1 : 0)
    const totalFrames = used.reduce((sum, n, i) => sum + n - skipped[i]!, 0)
    const filters = clips.map((clip, i) => {
        const seconds = secondsAt(used[i]!)
        const from = secondsAt(skipped[i]!)
        return [
            `[${i}:v]${Math.abs(infos[i]!.fps - FPS) > 0.01 ? `fps=${FPS},` : ''}trim=start_frame=${skipped[i]}:end_frame=${used[i]},setpts=PTS-STARTPTS,scale=${width}:${height},setsar=1,format=yuv420p[v${i}]`,
            `[${i}:a]aresample=${SAMPLE_RATE},aformat=channel_layouts=stereo,apad,atrim=start=${from}:end=${seconds},asetpts=PTS-STARTPTS,afade=t=in:d=${FADE_SEC},afade=t=out:st=${Math.max(0, seconds - from - FADE_SEC)}:d=${FADE_SEC}[a${i}]`,
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
