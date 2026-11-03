// h3-ref2video-2pass with the distilled PRISM DMAD/PDMD checkpoint (PRISM_DMAD_PDMD_int8.safetensors in diffusion_models/):
// pass 1 with 8 steps euler/beta57, the latent x2, pass 2 with 2 steps at denoise 0.2 - see comfy/h3-two-pass.ts (PRISM_TWO_PASS).
// The music video's inputs as in h3-ref2video-2pass. beta57 is a scheduler of the RES4LYF nodes.
// Select it with "videoWorkflow": "h3-ref2video-prism-2pass" in config.json.
import {h3RenderFrames, type VideoWorkflowOptions, type WorkflowResult} from "../helpers.ts";
import {PRISM_TWO_PASS, twoPassWorkflow} from "../h3-two-pass.ts";

export const renderFrames = h3RenderFrames

export default (opts: VideoWorkflowOptions): WorkflowResult => twoPassWorkflow(opts, 'h3-ref2video-prism-2pass', PRISM_TWO_PASS)
