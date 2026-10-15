import {existsSync, renameSync} from "node:fs";
import {join} from "node:path";
import {log, startSpinner, styles} from "./log.ts";
import {FPS, formatTime, frameAt, secondsAt} from "./frames.ts";
import type {ClipRequest} from "./compose.ts";
import {captureProcess, runProcess, SHORT_PROCESS_TIMEOUT_MS} from "./process.ts";

export type VideoInfo = { frames: number, width: number, height: number, fps: number, hasAudio: boolean }

// "slot-001, slot-002, slot-004, slot-005, slot-006" -> "slot-001-002, slot-004-006" - a long run of missing
// clips reads a lot faster as ranges than as one giant comma list
export function formatSlotRanges(ids: string[]): string {
    const numbered = ids.map(id => ({id, n: Number(id.match(/\d+/)?.[0])})).filter(({n}) => Number.isFinite(n))
    const ranges: string[] = []
    for (let i = 0; i < numbered.length; i++) {
        let j = i
        while (j + 1 < numbered.length && numbered[j + 1]!.n === numbered[j]!.n + 1) j++
        ranges.push(i === j ? numbered[i]!.id : `${numbered[i]!.id}-${numbered[j]!.id.match(/\d+/)![0]}`)
        i = j
    }
    return ranges.join(', ')
}

export async function probeVideo(file: string): Promise<VideoInfo> {
    const run = async (...args: string[]) => {
        const stdout = await runProcess(['ffprobe', '-v', 'error', '-of', 'json', ...args, file], {timeoutMs: SHORT_PROCESS_TIMEOUT_MS, errorMessage: err => `ffprobe failed for ${file}:\n${err}`})
        return JSON.parse(stdout) as { streams: { codec_type: string, nb_frames?: string, nb_read_frames?: string, width?: number, height?: number, r_frame_rate?: string }[] }
    }
    const {streams} = await run('-show_entries', 'stream=codec_type,nb_frames,width,height,r_frame_rate')
    const video = streams.find(s => s.codec_type === 'video')
    if (!video) throw new Error(`${file} has no video stream`)
    let frames = Number(video.nb_frames)
    // not every container stores the frame count - count them then
    if (!Number.isFinite(frames)) {
        const counted = await run('-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=codec_type,nb_read_frames')
        frames = Number(counted.streams[0]?.nb_read_frames)
    }
    // "24/1" -> 24
    const [num, den] = (video.r_frame_rate ?? '').split('/').map(Number)
    const fps = num && den ? num / den : FPS
    return {frames, width: video.width!, height: video.height!, fps, hasAudio: streams.some(s => s.codec_type === 'audio')}
}

/**
 * How many frames of the 24 fps target grid a clip fills: a clip at another frame rate is resampled by the assembly,
 * so its own frame count (48 at 12 fps) is not what ends up in the film (96).
 */
export const framesOnGrid = (info: Pick<VideoInfo, 'frames' | 'fps'>) =>
    Math.abs(info.fps - FPS) > 0.01 ? Math.round(info.frames * FPS / info.fps) : info.frames

/** The duration of an audio or video file in seconds, from its container. */
export async function probeDuration(file: string): Promise<number> {
    const stdout = await runProcess(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], {errorMessage: err => `ffprobe failed for ${file}:\n${err}`})
    const seconds = Number(stdout.trim())
    if (!Number.isFinite(seconds)) throw new Error(`${file} has no readable duration`)
    return seconds
}

/** Saves frame `index` (0-based) of a video as a PNG - written next to the target first, like the downloads. */
export async function extractFrame(video: string, index: number, target: string) {
    const partial = target.replace(/\.png$/, '.partial.png')
    const {stderr, code} = await captureProcess(['ffmpeg', '-y', '-v', 'error', '-i', video, '-vf', `select=eq(n\\,${index})`, '-frames:v', '1', partial], {stdout: 'ignore', timeoutMs: SHORT_PROCESS_TIMEOUT_MS})
    if (code !== 0 || !existsSync(partial)) throw new Error(`ffmpeg could not extract frame ${index} of ${video}:\n${stderr}`)
    renameSync(partial, target)
}

/**
 * Builds the final video: every clip cut to exactly its own frames from frame 0 on - the frames past
 * that were only rendered because the model needs certain lengths - then all clips concatenated.
 * The clips own consecutive ranges of the song's frame grid, so every clip starts on exactly the frame
 * its audio started on during generation, and the song can be laid under the whole video unchanged.
 */
export async function assembleFinal({clips, projectDir, songFile, songAudio, target}: {
    clips: ClipRequest[],
    projectDir: string,
    songFile: string,
    songAudio: boolean,     // true: the original song is the soundtrack, false: the clips' own audio
    target: string,
}) {
    const files = clips.map(c => join(projectDir, 'videos', `${c.id}.mp4`))
    const missing = clips.filter((_, i) => !existsSync(files[i]!)).map(c => c.id)
    if (missing.length) throw new Error(`Can't assemble - ${missing.length} of ${clips.length} clip(s) not rendered yet: ${formatSlotRanges(missing)}\nRender them first: --render=videos --only=${missing.join(',')}`)

    const infos = await Promise.all(files.map(probeVideo))
    clips.forEach((clip, i) => {
        if (framesOnGrid(infos[i]!) < clip.frames) throw new Error(`videos/${clip.id}.mp4 has ${framesOnGrid(infos[i]!)} frames (at ${FPS} fps), but the clip needs ${clip.frames} - delete it and render again`)
        if (!songAudio && !infos[i]!.hasAudio) throw new Error(`videos/${clip.id}.mp4 has no audio - set "songAudio": true in config.json`)
    })

    // The clips are concatenated back to back and the song goes under them unchanged, so the two only stay in sync
    // if the clips tile the song from its first frame to its last: a gap (e.g. a section without a bar) shifts every
    // later clip, and a clip total that differs from the song leaves a silent/black tail or cuts the song off.
    const totalFrames = clips.reduce((sum, c) => sum + c.frames, 0)
    let cursor = 0
    for (const clip of clips) {
        if (clip.frameStart !== cursor) {
            log.warn(`${clip.id} starts at ${formatTime(secondsAt(clip.frameStart), true)} but the clips before it end at ${formatTime(secondsAt(cursor), true)} - the clips don't tile the song, everything after this is out of sync with it`)
            break
        }
        cursor += clip.frames
    }
    if (songAudio) {
        const songFrames = frameAt(await probeDuration(songFile))
        if (Math.abs(songFrames - totalFrames) > 1) {
            log.warn(`the clips add up to ${formatTime(secondsAt(totalFrames), true)} (${totalFrames} frames) but the song is ${formatTime(secondsAt(songFrames), true)} (${songFrames} frames) - the final video ends ${totalFrames < songFrames ? 'before the song does' : 'after the song ends'}`)
        }
    }

    // all clips at the size of the first one, in case the resolution changed between renders
    const {width, height} = infos[0]!
    const resized = infos.filter(i => i.width !== width || i.height !== height).length
    if (resized) log.warn(`${resized} clip(s) have another size than ${width}x${height} and are scaled`)

    // a clip at another frame rate would play at the wrong speed once its frames are counted on the 24 fps grid
    const resampled = infos.filter(i => Math.abs(i.fps - FPS) > 0.01).length
    if (resampled) log.warn(`${resampled} clip(s) have another frame rate than ${FPS} fps and are resampled`)

    const filters = clips.map((clip, i) => [
        `[${i}:v]${Math.abs(infos[i]!.fps - FPS) > 0.01 ? `fps=${FPS},` : ''}trim=end_frame=${clip.frames},setpts=PTS-STARTPTS,scale=${width}:${height},setsar=1,format=yuv420p[v${i}]`,
        ...(songAudio ? [] : [`[${i}:a]atrim=end=${secondsAt(clip.frames)},asetpts=PTS-STARTPTS[a${i}]`]),
    ].join(';'))
    const concatInputs = clips.map((_, i) => songAudio ? `[v${i}]` : `[v${i}][a${i}]`).join('')
    filters.push(`${concatInputs}concat=n=${clips.length}:v=1:a=${songAudio ? 0 : 1}${songAudio ? '[v]' : '[v][a]'}`)

    const partial = `${target}.partial.mp4`
    const args = [
        'ffmpeg', '-y', '-v', 'error', '-progress', 'pipe:1', '-nostats',
        ...files.flatMap(f => ['-i', f]),
        ...(songAudio ? ['-i', songFile] : []),
        '-filter_complex', filters.join(';'),
        '-map', '[v]', '-map', songAudio ? `${clips.length}:a:0` : '[a]',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS),
        '-c:a', 'aac', '-b:a', '320k',
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
    if (result.frames !== totalFrames) log.warn(`final video has ${result.frames} frames, expected ${totalFrames}`)
    return {frames: result.frames, width, height, seconds: secondsAt(result.frames)}
}
