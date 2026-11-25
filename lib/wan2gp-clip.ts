// A music-video clip in its wan2gp form (#1204, docs/render-engines.md): the same prompt, pictures and stems the ComfyUI workflow gets,
// as settings for the wan2gp bridge. wan2gp's H3 Ref2VA takes up to nine pictures and three audio references (<Audio 1> to <Audio 3>,
// each at least 2 s); a clip that needs more, or context frames, has no wan2gp form and stays on ComfyUI. The whole song the ComfyUI
// workflow locks into the latent as a guide (MiniMaxH3AddGuide) has no counterpart there and is left out.

import type {PixelSize} from '../comfy/helpers.ts'
import type {BridgeSettings} from './wan2gp.ts'

export const WAN2GP_MAX_PICTURES = 9
export const WAN2GP_MAX_AUDIOS = 3
export const WAN2GP_MIN_AUDIO_SECONDS = 2
const AUDIO_LETTERS = ['A', 'AB', 'ABD'] as const
const AUDIO_KEYS = ['audio_guide', 'audio_guide2', 'audio_guide3'] as const

export type Wan2gpClipInput = {
    template: string // the Deepy template of the wan2gp server ("gen_video_with_refs/MiniMax H3 Ref2VA Pruned PDD 8 Steps")
    prompt: string
    pictures: string[] // local files, in <Picture N> order
    audios: string[] // local files already cut to the clip's span, in <Audio N> order
    startFrame?: string // a local picture the clip starts on (pinStartFrame)
    contextFrames?: boolean // the clip starts on the last frames of the clip before (contextFrames) - not in the wan2gp form yet
    frames: number
    fps: number
    seed: number
    size: PixelSize
}

/** The settings for the bridge, or why the clip has no wan2gp form. */
export function wan2gpClipSettings(clip: Wan2gpClipInput): BridgeSettings | string {
    if (clip.contextFrames) return 'it starts on context frames of the clip before (contextFrames), which the wan2gp form does not take yet'
    if (clip.pictures.length > WAN2GP_MAX_PICTURES) return `it has ${clip.pictures.length} pictures, wan2gp's H3 takes ${WAN2GP_MAX_PICTURES}`
    if (clip.audios.length > WAN2GP_MAX_AUDIOS) return `it has ${clip.audios.length} audio references, wan2gp's H3 takes ${WAN2GP_MAX_AUDIOS}`
    if (clip.audios.length && clip.frames / clip.fps < WAN2GP_MIN_AUDIO_SECONDS)
        return `it lasts ${(clip.frames / clip.fps).toFixed(2)} s, wan2gp takes an audio reference of ${WAN2GP_MIN_AUDIO_SECONDS} s or more`
    const audios: Record<string, string> = Object.fromEntries(clip.audios.map((file, i) => [AUDIO_KEYS[i]!, file]))
    return {
        template: clip.template,
        prompt: clip.prompt,
        image_refs: clip.pictures,
        video_prompt_type: 'I',
        resolution: `${clip.size.width}x${clip.size.height}`,
        video_length: clip.frames,
        seed: clip.seed,
        ...(clip.audios.length
            ? {audio_prompt_type: AUDIO_LETTERS[clip.audios.length - 1]!, ...audios}
            : {audio_prompt_type: ''}),
        ...(clip.startFrame ? {image_start: clip.startFrame, image_prompt_type: 'S'} : {}),
    }
}
