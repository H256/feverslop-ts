// A music-video clip in its wan2gp form (#1204, #1214, docs/render-engines.md): the clip's short wan2gp prompt (or its own prompt),
// its pictures in the order that prompt numbers them, and the clip's sound as the soundtrack the video follows (`AS`) - the clip's
// stems mixed into one track: wan2gp keeps it as the output audio, and the prompt asks for lip movements synchronized to it. That
// stands in for the whole song the ComfyUI workflow locks into the latent (MiniMaxH3AddGuide). A clip that needs more pictures than
// wan2gp's H3 takes, or context frames, has no wan2gp form and stays on ComfyUI.

import type {PixelSize} from '../comfy/helpers.ts'
import type {BridgeSettings} from './wan2gp.ts'

export const WAN2GP_MAX_PICTURES = 9
/** wan2gp takes a seed from 0 to 2^32 - 1. */
export const WAN2GP_SEEDS = 2 ** 32

export type Wan2gpClipInput = {
    template: string // the Deepy template of the wan2gp server ("gen_video_with_refs/MiniMax H3 Ref2VA Pruned PDD 8 Steps")
    prompt: string
    pictures: string[] // local files, in <Picture N> order
    soundtrack?: string // a local file already cut to the clip's span - the clip's sound; none: wan2gp makes its own
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
    return {
        template: clip.template,
        prompt: clip.prompt,
        image_refs: clip.pictures,
        video_prompt_type: 'I',
        resolution: `${clip.size.width}x${clip.size.height}`,
        video_length: clip.frames,
        seed: clip.seed % WAN2GP_SEEDS,
        ...(clip.soundtrack ? {audio_prompt_type: 'AS', audio_guide: clip.soundtrack} : {audio_prompt_type: ''}),
        ...(clip.startFrame ? {image_start: clip.startFrame, image_prompt_type: 'S'} : {}),
    }
}
