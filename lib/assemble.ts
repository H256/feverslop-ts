import {existsSync, renameSync} from "node:fs";
import {join} from "node:path";
import {log, startSpinner, styles} from "./log.ts";
import {FPS, secondsAt} from "./frames.ts";
import type {ClipRequest} from "./compose.ts";
import {captureProcess, runProcess} from "./process.ts";

export type VideoInfo = { frames: number, width: number, height: number, hasAudio: boolean }

export async function probeVideo(file: string): Promise<VideoInfo> {
    const run = async (...args: string[]) => {
        const stdout = await runProcess(['ffprobe', '-v', 'error', '-of', 'json', ...args, file], {errorMessage: err => `ffprobe failed for ${file}:\n${err}`})
        return JSON.parse(stdout) as { streams: { codec_type: string, nb_frames?: string, nb_read_frames?: string, width?: number, height?: number }[] }
    }
    const {streams} = await run('-show_entries', 'stream=codec_type,nb_frames,width,height')
    const video = streams.find(s => s.codec_type === 'video')
    if (!video) throw new Error(`${file} has no video stream`)
    let frames = Number(video.nb_frames)
    // not every container stores the frame count - count them then
    if (!Number.isFinite(frames)) {
        const counted = await run('-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=codec_type,nb_read_frames')
        frames = Number(counted.streams[0]?.nb_read_frames)
    }
    return {frames, width: video.width!, height: video.height!, hasAudio: streams.some(s => s.codec_type === 'audio')}
}

/** Saves frame `index` (0-based) of a video as a PNG - written next to the target first, like the downloads. */
export async function extractFrame(video: string, index: number, target: string) {
    const partial = target.replace(/\.png$/, '.partial.png')
    const {stderr, code} = await captureProcess(['ffmpeg', '-y', '-v', 'error', '-i', video, '-vf', `select=eq(n\\,${index})`, '-frames:v', '1', partial], {stdout: 'ignore'})
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
    if (missing.length) throw new Error(`Can't assemble - ${missing.length} clip(s) not rendered yet: ${missing.join(', ')}`)

    const infos = await Promise.all(files.map(probeVideo))
    clips.forEach((clip, i) => {
        if (infos[i]!.frames < clip.frames) throw new Error(`videos/${clip.id}.mp4 has ${infos[i]!.frames} frames, but the clip needs ${clip.frames} - delete it and render again`)
        if (!songAudio && !infos[i]!.hasAudio) throw new Error(`videos/${clip.id}.mp4 has no audio - set "songAudio": true in config.json`)
    })

    // all clips at the size of the first one, in case the resolution changed between renders
    const {width, height} = infos[0]!
    const resized = infos.filter(i => i.width !== width || i.height !== height).length
    if (resized) log.warn(`${resized} clip(s) have another size than ${width}x${height} and are scaled`)

    const filters = clips.map((clip, i) => [
        `[${i}:v]trim=end_frame=${clip.frames},setpts=PTS-STARTPTS,scale=${width}:${height},setsar=1,format=yuv420p[v${i}]`,
        ...(songAudio ? [] : [`[${i}:a]atrim=end=${secondsAt(clip.frames)},asetpts=PTS-STARTPTS[a${i}]`]),
    ].join(';'))
    const concatInputs = clips.map((_, i) => songAudio ? `[v${i}]` : `[v${i}][a${i}]`).join('')
    filters.push(`${concatInputs}concat=n=${clips.length}:v=1:a=${songAudio ? 0 : 1}${songAudio ? '[v]' : '[v][a]'}`)

    const totalFrames = clips.reduce((sum, c) => sum + c.frames, 0)
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
