// Originally exported from ComfyUI as r2v_audio_fullmix_guide_1-pass_turbo.json (see README's "Workflows" section)
import {h3Ref2Video} from './h3-ref2video-builder.ts'
import {h3RenderFrames, type RecommendedResolution, type VideoWorkflowOptions, type WorkflowResult} from '../helpers.ts'

export const renderFrames = h3RenderFrames
export const recommendedResolution: RecommendedResolution = '1344x768'

export default function h3Ref2VideoTurbo(opts: VideoWorkflowOptions): WorkflowResult {
    return h3Ref2Video(opts, {
        name: 'h3-ref2video',
        turbo: true,
        sampler: 'euler',
        scheduler: 'simple',
        steps: o => o.preview?.steps ?? ('steps' in o ? o.steps : undefined) ?? 8,
    })
}
