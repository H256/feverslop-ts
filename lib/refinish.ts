import {FPS} from './frames.ts'
import {runProcess} from './process.ts'
import {produceMedia} from './media-file.ts'
import {existsSync, readFileSync, statSync} from 'node:fs'

export function completeDerivative(file: string): boolean {
    try {
        const meta = JSON.parse(readFileSync(`${file}.json`, 'utf8'))
        return existsSync(file) && meta.complete === true && meta.bytes === statSync(file).size
    } catch {
        return false
    }
}

// A project made before larger clips, 48 fps and the finish gets them afterwards, from the clips it has (tools/refinish.ts). No plan run: on an old project
// that would generate new steps and change prompts. Nothing it has is overwritten: every variant has a folder of its own, its final videos names of their own.

export type Upscale = 'none' | 'refine' | 'latent' | 'model'
export type RefinishOptions = {
    upscale: Upscale
    size: string // fullhd, 2x or WxH
    model: string // upscale: model - a file in models/upscale_models/
    denoise: number // upscale: refine
    fps: number // 24: none
    finish: boolean
}

export const DEFAULTS: RefinishOptions = {upscale: 'none', size: 'fullhd', model: 'RealESRGAN_x2plus.pth', denoise: 0.2, fps: 24, finish: false}

export const PRESETS: Record<string, Partial<RefinishOptions>> = {
    grade: {finish: true},
    smooth: {fps: 48, finish: true},
    fullhd: {upscale: 'refine', size: 'fullhd', fps: 48, finish: true},
}

/** The size a clip of `width`×`height` comes out at, in multiples of 32 as the latent upscaler keeps them: a portrait clip stays one. */
export function targetSize(setting: string, width: number, height: number): {width: number; height: number} {
    const on32 = (n: number) => Math.max(32, Math.round(n / 32) * 32)
    if (setting === '2x') return {width: on32(width * 2), height: on32(height * 2)}
    const fixed = /^(\d+)x(\d+)$/.exec(setting)
    if (fixed) return {width: on32(Number(fixed[1])), height: on32(Number(fixed[2]))}
    if (setting !== 'fullhd') throw new Error(`--size: "${setting}" is not fullhd, 2x or WIDTHxHEIGHT`)
    return width >= height ? {width: 1920, height: 1088} : {width: 1088, height: 1920}
}

/** The name of a variant: the folder of its clips, part of the names of its final videos. Another denoise or model is another one, so that they can be compared. */
export function variantOf(o: Pick<RefinishOptions, 'upscale' | 'size' | 'model' | 'denoise'>): string {
    if (o.upscale === 'none') return 'original'
    const size = o.size.toLowerCase()
    if (o.upscale === 'model')
        return `model-${o.model
            .replace(/\.[a-z0-9]+$/i, '')
            .replace(/[^a-z0-9]+/gi, '-')
            .toLowerCase()}-${size}`
    if (o.upscale === 'refine') return `refine-${size}${o.denoise === DEFAULTS.denoise ? '' : `-d${o.denoise}`}`
    return `${o.upscale}-${size}`
}

export const clipFolder = (variant: string) => `videos/refined/${variant}`
export const finalName = (id: string, variant: string) => `${id}--${variant}.mp4`

/** Reads the options of a command line, a preset first and what is said beside it on top. Throws on what cannot be. */
export function readOptions(values: {
    preset?: string
    upscale?: string
    size?: string
    model?: string
    denoise?: string
    fps?: string
    finish?: boolean
}): RefinishOptions {
    if (values.preset !== undefined && !(values.preset in PRESETS)) throw new Error(`--preset: "${values.preset}" - use ${Object.keys(PRESETS).join(', ')}`)
    const o: RefinishOptions = {...DEFAULTS, ...(values.preset ? PRESETS[values.preset] : {})}
    if (values.upscale !== undefined) {
        if (!['none', 'refine', 'latent', 'model'].includes(values.upscale))
            throw new Error(`--upscale: "${values.upscale}" - use none, refine, latent or model`)
        o.upscale = values.upscale as Upscale
    }
    if (values.size !== undefined) o.size = values.size
    targetSize(o.size, 16, 9)
    if (values.model !== undefined) o.model = values.model
    if (values.denoise !== undefined) o.denoise = Number(values.denoise)
    if (!(o.denoise > 0 && o.denoise <= 1)) throw new Error(`--denoise must be above 0 and up to 1, got ${values.denoise}`)
    if (values.fps !== undefined) o.fps = Number(values.fps)
    if (!Number.isInteger(o.fps) || o.fps < FPS)
        throw new Error(`--fps must be ${FPS} (none) or a frame rate interpolation reaches, e.g. 48 or 60, got ${values.fps}`)
    if (values.finish) o.finish = true
    if (o.upscale === 'none' && o.fps === FPS && !o.finish) throw new Error('nothing to do: say --preset, --upscale, --fps or --finish')
    return o
}

/** A clip filled up with its last frame, for a model that only takes some lengths. */
export const paddedClip = (source: string, target: string, extra: number) =>
    runProcess(
        [
            'ffmpeg',
            '-y',
            '-v',
            'error',
            '-i',
            source,
            '-vf',
            `tpad=stop_mode=clone:stop=${extra}`,
            '-an',
            '-c:v',
            'libx264',
            '-crf',
            '10',
            '-pix_fmt',
            'yuv420p',
            target,
        ],
        {errorMessage: err => `ffmpeg could not fill up ${source}:\n${err}`},
    )

/** The rendered picture with the sound of the original clip, as many frames as that has. The picture is only encoded again when frames were cut off. */
export const withOriginalSound = (rendered: string, original: string, frames: number, cut: boolean, target: string) =>
    produceMedia(target, partial =>
        runProcess(
            [
                'ffmpeg',
                '-y',
                '-v',
                'error',
                '-i',
                rendered,
                '-i',
                original,
                '-map',
                '0:v',
                '-map',
                '1:a?',
                ...(cut ? ['-frames:v', String(frames), '-c:v', 'libx264', '-preset', 'medium', '-crf', '15', '-pix_fmt', 'yuv420p'] : ['-c:v', 'copy']),
                '-c:a',
                'copy',
                '-movflags',
                '+faststart',
                partial,
            ],
            {errorMessage: err => `ffmpeg could not put the sound of ${original} under ${rendered}:\n${err}`},
        ),
    )
