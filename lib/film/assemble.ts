import {existsSync, renameSync} from "node:fs";
import {join} from "node:path";
import {formatSlotRanges, framesOnGrid, probeVideo} from "../assemble.ts";
import {FPS, formatTime, secondsAt} from "../frames.ts";
import {log, startSpinner, styles} from "../log.ts";
import {runProcess} from "../process.ts";

// a clip's sound starts and ends with a very short fade, so that no click is heard where two clips meet
const FADE_SEC = 0.02
// what every clip's sound is brought to - the model's own is 32 kHz
const SAMPLE_RATE = 48000

// the loudness every clip is brought to - the model makes the level of every clip on its own, a quiet clip next to a loud one is what makes a film sound cut together
const TARGET_LUFS = -20
// ... but never by more than this: a clip of only wind must not be turned up to the level of a spoken line
const MAX_GAIN_DB = 9

/** Integrated loudness (EBU R128) of a clip's sound in LUFS, undefined for silence. */
export async function loudnessOf(file: string): Promise<number | undefined> {
    const proc = Bun.spawn(['ffmpeg', '-v', 'info', '-nostats', '-i', file, '-vn', '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'], {stdout: 'pipe', stderr: 'pipe'})
    const output = await new Response(proc.stderr).text()
    await proc.exited
    const match = output.match(/Integrated loudness:\s*I:\s*(-?[\d.]+) LUFS/)
    const value = match ? Number(match[1]) : NaN
    return Number.isFinite(value) && value > -60 ? value : undefined
}

/**
 * Builds the film: every clip cut to exactly its own frames from frame 0 on - the frames past that were only rendered because
 * the model needs certain lengths - and joined, with the sound the model made for each clip. Unlike the music-video
 * pipeline there is no soundtrack under the film, so the clips' own sound is the film's sound.
 */
export async function assembleFilm({clips, projectDir, target, levelMatching = false}: {
    // useRendered: use every frame the model rendered, not only the planned ones - for a clip with dialogue, whose last word can fall
    // into the few frames after the planned end
    // continuesPrevious: the clip starts on the last frame of the clip right before it in the film - that frame is already there, the clip's first frame is the same picture and is left out (it would stand twice and stutter)
    clips: { id: string, frames: number, useRendered?: boolean, continuesPrevious?: boolean }[],
    projectDir: string,
    target: string,
    levelMatching?: boolean,        // every clip's sound is brought towards the same loudness
}) {
    const files = clips.map(c => join(projectDir, 'videos', `${c.id}.mp4`))
    const missing = clips.filter((_, i) => !existsSync(files[i]!)).map(c => c.id)
    if (missing.length) throw new Error(`Can't assemble - ${missing.length} of ${clips.length} clip(s) not rendered yet: ${formatSlotRanges(missing)}\nRender them first: --render=videos --only=${missing.join(',')}`)

    const infos = await Promise.all(files.map(probeVideo))
    // the frames each clip contributes
    const used = clips.map((c, i) => c.useRendered ? framesOnGrid(infos[i]!) : c.frames)
    clips.forEach((clip, i) => {
        if (framesOnGrid(infos[i]!) < clip.frames) throw new Error(`videos/${clip.id}.mp4 has ${framesOnGrid(infos[i]!)} frames (at ${FPS} fps), but the clip needs ${clip.frames} - delete it and render again`)
        if (!infos[i]!.hasAudio) throw new Error(`videos/${clip.id}.mp4 has no audio - the film's sound comes from the clips: delete it and render again`)
    })

    // all clips at the size of the first one, in case the resolution changed between renders
    const {width, height} = infos[0]!
    const resized = infos.filter(i => i.width !== width || i.height !== height).length
    if (resized) log.warn(`${resized} clip(s) have another size than ${width}x${height} and are scaled`)
    // a clip at another frame rate would play at the wrong speed once its frames are counted on the 24 fps grid
    const resampled = infos.filter(i => Math.abs(i.fps - FPS) > 0.01).length
    if (resampled) log.warn(`${resampled} clip(s) have another frame rate than ${FPS} fps and are resampled`)

    // gain per clip, to the common loudness (at most MAX_GAIN_DB either way)
    const gains = levelMatching
        ? await Promise.all(files.map(async f => {
            const loudness = await loudnessOf(f)
            return loudness === undefined ? 0 : Math.max(-MAX_GAIN_DB, Math.min(MAX_GAIN_DB, TARGET_LUFS - loudness))
        }))
        : files.map(() => 0)
    if (levelMatching) log.step('Levels', styles.muted(`clips brought towards ${TARGET_LUFS} LUFS: ${Math.min(...gains).toFixed(1)} to ${Math.max(...gains).toFixed(1)} dB`))
    const skipped = clips.map(c => c.continuesPrevious ? 1 : 0)
    const totalFrames = used.reduce((sum, n, i) => sum + n - skipped[i]!, 0)
    const filters = clips.map((clip, i) => {
        const seconds = secondsAt(used[i]!)
        const from = secondsAt(skipped[i]!)
        return [
            `[${i}:v]${Math.abs(infos[i]!.fps - FPS) > 0.01 ? `fps=${FPS},` : ''}trim=start_frame=${skipped[i]}:end_frame=${used[i]},setpts=PTS-STARTPTS,scale=${width}:${height},setsar=1,format=yuv420p[v${i}]`,
            `[${i}:a]aresample=${SAMPLE_RATE},aformat=channel_layouts=stereo,${gains[i] ? `volume=${gains[i]!.toFixed(2)}dB,alimiter=limit=0.95,` : ''}apad,atrim=start=${from}:end=${seconds},asetpts=PTS-STARTPTS,afade=t=in:d=${FADE_SEC},afade=t=out:st=${Math.max(0, seconds - from - FADE_SEC)}:d=${FADE_SEC}[a${i}]`,
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
    // the second of the film every clip starts at
    let at = 0
    const starts = used.map((n, i) => { const start = at; at += secondsAt(n - skipped[i]!); return start })
    // used, skipped: the frames of each clip the film shows, from frame 0 - and of those the ones left out at its start
    return {starts, used, skipped, frames: result.frames, width, height, seconds: secondsAt(result.frames), duration: formatTime(secondsAt(result.frames), true)}
}

/**
 * The film at another frame rate (finalFps): the interpolated clips (lib/final-pass.ts, `multiplier` times the frames each
 * clip has in the film) joined as assembleFilm joined them, down to `fps`, and the sound of the film at 24 fps taken over as it is -
 * levelled, faded and with its score. The picture of the two runs exactly as long.
 */
export async function assembleSmoothFilm({clips, files, multiplier, fps, sound, target}: {
    clips: { id: string, used: number, skipped: number }[],   // as assembleFilm returned them
    files: string[],                                           // the interpolated clips, in order
    multiplier: number,
    fps: number,
    sound: string,                                             // the film at 24 fps
    target: string,
}) {
    const infos = await Promise.all(files.map(probeVideo))
    clips.forEach((clip, i) => {
        if (infos[i]!.frames < clip.used * multiplier) throw new Error(`${files[i]} has ${infos[i]!.frames} frames, ${clip.used * multiplier} expected - delete it and run again`)
    })
    const {width, height} = infos[0]!
    const filters = clips.map((clip, i) => `[${i}:v]trim=start_frame=${clip.skipped * multiplier}:end_frame=${clip.used * multiplier},setpts=PTS-STARTPTS,scale=${width}:${height},setsar=1,format=yuv420p[v${i}]`)
    filters.push(`${clips.map((_, i) => `[v${i}]`).join('')}concat=n=${clips.length}:v=1:a=0[vc];[vc]fps=${fps}[v]`)
    const partial = `${target}.partial.mp4`
    await runProcess([
        'ffmpeg', '-y', '-v', 'error',
        ...files.flatMap(f => ['-i', f]), '-i', sound,
        '-filter_complex', filters.join(';'),
        '-map', '[v]', '-map', `${clips.length}:a:0`,
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(fps),
        '-c:a', 'copy', '-movflags', '+faststart', partial,
    ], {errorMessage: err => `ffmpeg could not join the interpolated clips:\n${err}`})
    renameSync(partial, target)
    const result = await probeVideo(target)
    const expected = Math.round(clips.reduce((sum, c) => sum + c.used - c.skipped, 0) * fps / FPS)
    if (Math.abs(result.frames - expected) > 1) log.warn(`${target} has ${result.frames} frames, ${expected} expected`)
    return {frames: result.frames, width, height, seconds: result.frames / fps}
}

export const SCORE_EXTENSIONS = ['mp3', 'wav', 'flac', 'm4a', 'ogg']

/**
 * Mixes a score under the finished film: it is looped or cut to the film's length, set `volumeDb` below the film's own sound, and gives way
 * (a sidechain compressor on the film's sound) while anybody speaks. The picture is copied, the sound is encoded once more.
 */
export async function addScore(film: string, score: string, volumeDb: number) {
    const partial = `${film}.score.mp4`
    const filter = [
        `[0:a]aformat=channel_layouts=stereo,asplit=2[dry][key]`,
        `[1:a]aresample=${SAMPLE_RATE},aformat=channel_layouts=stereo,volume=${volumeDb}dB[music]`,
        `[music][key]sidechaincompress=threshold=0.02:ratio=10:attack=30:release=600[ducked]`,
        `[dry][ducked]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]`,
    ].join(';')
    const proc = Bun.spawn(['ffmpeg', '-y', '-v', 'error', '-i', film, '-stream_loop', '-1', '-i', score, '-filter_complex', filter, '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', partial], {stdout: 'pipe', stderr: 'pipe'})
    const stderr = new Response(proc.stderr).text()
    if (await proc.exited !== 0) throw new Error(`ffmpeg could not mix the score:\n${await stderr}`)
    renameSync(partial, film)
}
