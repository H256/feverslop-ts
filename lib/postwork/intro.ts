import {probeVideo} from "../assemble.ts";
import type {IntroSettings} from "./config.ts";
import {encode, postworkName, VIDEO_ENCODE} from "./video.ts";

// A clip in front of a finished video (#608): a logo, a channel ident, a title card. The intro takes the size, the frame rate
// and the pixel shape of the video - another aspect ratio gets black bars, it is never stretched - and is joined to it with
// a hard cut or a short fade. ffmpeg's own concat, xfade and acrossfade, no library beyond them.

/** What the join needs to know of the two videos. */
export type IntroJoin = {
    width: number, height: number, fps: number,     // of the video: the intro is made like it
    introSeconds: number,
    introAudio: boolean,
    videoAudio: boolean,                            // a video without sound gets none; the intro's is left out then
}

const SOUND = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo'

/** The seconds the video starts at in the joined one: after the intro, or as the fade begins. */
export const videoStart = (join: Pick<IntroJoin, 'introSeconds'>, fade: number) => Math.max(0, join.introSeconds - fade)

/** What is wrong with joining these two, or undefined. */
export function introProblem(join: IntroJoin, intro: IntroSettings): string | undefined {
    if (!(join.introSeconds > 0)) return 'the intro has no length'
    if (intro.fade >= join.introSeconds) return `the fade (${intro.fade} s) must be shorter than the intro (${join.introSeconds.toFixed(2)} s)`
    return undefined
}

/**
 * The filter graph of the join: input 0 is the intro, input 1 the video. Out: [v], and [a] when the video has sound.
 * The intro's sound is cut or filled with silence to the length of its picture, so the two stay in sync after it.
 */
export function introFilter(join: IntroJoin, intro: IntroSettings): string {
    const {width: w, height: h, fps} = join
    const d = join.introSeconds.toFixed(3)
    const parts = [
        `[0:v]fps=${fps},scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p,settb=AVTB[iv]`,
        `[1:v]setsar=1,format=yuv420p,settb=AVTB[mv]`,
    ]
    if (join.videoAudio) {
        parts.push(join.introAudio
            ? `[0:a]${SOUND},apad,atrim=duration=${d}[ia]`
            : `anullsrc=r=48000:cl=stereo,atrim=duration=${d},${SOUND}[ia]`)
        parts.push(`[1:a]${SOUND}[ma]`)
    }
    if (intro.fade > 0) {
        parts.push(`[iv][mv]xfade=transition=fade:duration=${intro.fade}:offset=${videoStart(join, intro.fade).toFixed(3)}[v]`)
        if (join.videoAudio) parts.push(`[ia][ma]acrossfade=d=${intro.fade}:c1=tri:c2=tri[a]`)
    } else {
        parts.push(join.videoAudio ? '[iv][ia][mv][ma]concat=n=2:v=1:a=1[v][a]' : '[iv][mv]concat=n=2:v=1:a=0[v]')
    }
    return parts.join(';')
}

/**
 * Writes `<video>-intro.mp4` next to the video, the intro in front of it. Subtitles of the video are kept, moved by the
 * length of the intro, so they stay on their lines.
 */
export async function introVideo(video: string, intro: string, settings: IntroSettings): Promise<{ file: string, filter: string, seconds: number }> {
    const [main, clip] = await Promise.all([probeVideo(video), probeVideo(intro)])
    const join: IntroJoin = {
        width: main.width, height: main.height, fps: Math.round(main.fps * 1000) / 1000,
        introSeconds: clip.frames / clip.fps, introAudio: clip.hasAudio, videoAudio: main.hasAudio,
    }
    const wrong = introProblem(join, settings)
    if (wrong) throw new Error(wrong)
    const filter = introFilter(join, settings)
    const start = videoStart(join, settings.fade)
    const target = postworkName(video, 'intro')
    const frames = Math.round(start * join.fps) + main.frames
    await encode(['-i', intro, '-i', video, '-itsoffset', start.toFixed(3), '-i', video, '-filter_complex', filter,
        '-map', '[v]', ...(join.videoAudio ? ['-map', '[a]', '-c:a', 'aac', '-b:a', '320k'] : []), '-map', '2:s?', '-c:s', 'copy',
        ...VIDEO_ENCODE], target, frames, 'putting the intro in front')
    return {file: target, filter, seconds: join.introSeconds}
}
