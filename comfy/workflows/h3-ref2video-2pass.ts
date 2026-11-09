// h3-ref2video in two passes (issue #288): pass 1 with the base model at a quarter of the final pixels, the latent x2,
// pass 2 a short refine with the base model at the final size - see comfy/h3-two-pass.ts. videoResolution is the final size
// (-1 = 2 MP, pass 1 at 0.5 MP). Nothing after pass 2: the video is rendered at the size it is saved at.
import {h3RenderFrames, type VideoWorkflowOptions, type WorkflowResult} from '../helpers.ts'
import {twoPassWorkflow} from '../h3-two-pass.ts'

// MiniMaxH3ReferenceToVideo only renders 5 + 17·k frames - round up, the rest is cut off in the final video
export const renderFrames = h3RenderFrames

export default (opts: VideoWorkflowOptions): WorkflowResult => twoPassWorkflow(opts, 'h3-ref2video-2pass')
