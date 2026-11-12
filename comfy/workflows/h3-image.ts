// Originally exported from ComfyUI as image_minimax_h3_image_t2i.json (see README's "Workflows" section).
// The export's prompt enhancer (a second text model that rewrites the prompt into a long caption and picks an aspect
// ratio) is left out: our prompts are written for the picture already and go into the conditioning as they are.
// Its ResolutionSelector (3:4, 8 MP) is replaced by the project's imageResolution and the picture's orientation.
import {afterCleanup, type ImageWorkflowOptions, resolution, WorkflowBuilder, type WorkflowResult} from '../helpers.ts'

export default function h3Image(opts: ImageWorkflowOptions): WorkflowResult {
    const wf = new WorkflowBuilder()

    const model = wf.UNETLoader({unet_name: 'minimax_h3_image_pruned_int8_convrot.safetensors', weight_dtype: 'default'})
    const clip = wf.CLIPLoader({clip_name: 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors', type: 'minimax', device: 'default'})
    const vae = wf.VAELoader({vae_name: 'minimax_h3_image_vae_fp16.safetensors'})

    // the conditioning node makes the empty latent of that size itself
    const size = resolution(wf, opts.resolution, opts.orientation, '1920x1088')
    const conditioning = wf.MiniMaxH3ImageConditioning({prompt: opts.prompt, width: size.width, height: size.height, clip: clip.CLIP, vae: vae.VAE})
    const negative = wf.ConditioningZeroOut({conditioning: conditioning.positive})

    const sampled = wf.KSampler({
        seed: opts.seed,
        steps: 6,
        cfg: 1,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1,
        model: model.MODEL,
        positive: conditioning.positive,
        negative: negative.CONDITIONING,
        latent_image: conditioning.LATENT,
    })
    const decoded = wf.VAEDecode({samples: sampled.LATENT, vae: vae.VAE})
    const save = wf.SaveImage({filename_prefix: opts.filenamePrefix, images: afterCleanup(wf, decoded.IMAGE, {offload_model: true, offload_cache: true})})

    return {workflow: wf, output: save.__id}
}
