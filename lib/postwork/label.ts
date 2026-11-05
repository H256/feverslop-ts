import {probeVideo} from "../assemble.ts";
import type {LabelSettings} from "./config.ts";
import {encode, postworkName, VIDEO_ENCODE} from "./video.ts";

// The AI marker over a finished video (#607): a PNG - one of the EU icons, or one of your own - in a corner, for the first
// seconds, at the start and again at an interval, or the whole time. The disclosure the AI Act asks of a deep fake
// (Article 50(4)); for an evidently artistic or fictional work the code of practice is content with one at the start
// ("credits"). ffmpeg's own overlay filter, no library beyond it.

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

/** When the marker shows, as an ffmpeg expression of the time - undefined: the whole time. */
export function labelEnable(label: Pick<LabelSettings, 'mode' | 'seconds' | 'interval'>): string | undefined {
    if (label.mode === 'always') return undefined
    if (label.mode === 'credits') return `lt(t,${label.seconds})`
    // at the start and every interval: the first `seconds` of each
    return `lt(mod(t,${label.interval}),${label.seconds})`
}

/** Where the marker's top left corner is, in the variables of the overlay filter (W, H: the video; w, h: the marker). */
export function labelPosition(corner: LabelSettings['corner'], margin: number): { x: string, y: string } {
    const m = String(margin)
    return {
        x: corner.endsWith('right') ? `W-w-${m}` : m,
        y: corner.startsWith('bottom') ? `H-h-${m}` : m,
    }
}

/**
 * The filter graph of the marker over a video of `height` pixels: input 0 is the video, input 1 the PNG. The marker is
 * scaled to its size in % of the height; the margin is in % of the height as well, so it looks the same at any size.
 */
export function labelFilter(label: LabelSettings, height: number): string {
    const size = even(height * label.size / 100)
    const margin = Math.round(height * label.margin / 100)
    const {x, y} = labelPosition(label.corner, margin)
    const enable = labelEnable(label)
    // the PNG is one frame: overlay keeps showing its last frame to the end of the video
    return `[1:v]scale=-2:${size}:flags=lanczos,format=rgba[marker];[0:v][marker]overlay=x=${x}:y=${y}:format=auto${enable ? `:enable='${enable}'` : ''},format=yuv420p[v]`
}

/** Writes `<video>-labeled.mp4` next to the video, with the marker over it. The sound and subtitles are copied as they are. */
export async function labelVideo(video: string, marker: string, label: LabelSettings): Promise<{ file: string, filter: string }> {
    const info = await probeVideo(video)
    const filter = labelFilter(label, info.height)
    const target = postworkName(video, 'labeled')
    await encode(['-i', video, '-i', marker, '-filter_complex', filter, '-map', '[v]', '-map', '0:a?', '-map', '0:s?',
        ...VIDEO_ENCODE, '-c:a', 'copy', '-c:s', 'copy'], target, info.frames, 'putting the marker on')
    return {file: target, filter}
}
