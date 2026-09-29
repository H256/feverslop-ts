// Originally exported from ComfyUI as image_t2i_startframe_krea_v1.json (see README's "Workflows" section)
import {afterCleanup, type ImageWorkflowOptions, resolution, WorkflowBuilder, type WorkflowResult} from "../helpers.ts";

export default function krea2Image(opts: ImageWorkflowOptions & { negative?: string }): WorkflowResult {
    const wf = new WorkflowBuilder()

    const model = wf.UNETLoader({unet_name: 'krea2_turbo_fp8_scaled.safetensors', weight_dtype: 'default'})
    const clip = wf.CLIPLoader({clip_name: 'qwen3vl_4b_fp8_scaled.safetensors', type: 'krea2', device: 'default'})
    const vae = wf.VAELoader({vae_name: 'qwen_image_vae.safetensors'})

    const positive = wf.CLIPTextEncode({text: opts.prompt, clip: clip.CLIP})
    const negativeText = wf.CLIPTextEncode({text: opts.negative ?? 'watermark', clip: clip.CLIP})
    const average = wf.ConditioningAverage({conditioning_to: negativeText.CONDITIONING, conditioning_from: positive.CONDITIONING, conditioning_to_strength: 0})
    const negative = wf.ConditioningZeroOut({conditioning: average.CONDITIONING})

    const size = resolution(wf, opts.resolution, opts.orientation, '1920x1088')
    const latent = wf.EmptyLatentImage({width: size.width, height: size.height, batch_size: 1})

    // comfy-kitchen attention as the last step before the sampler (untested speedup on Krea2 - its attention is a smaller share of the step)
    const attention = wf.ModelAttentionBackend({model: model.MODEL, attention: 'comfy kitchen attention'})

    const sampled = wf.KSampler({
        seed: opts.seed,
        steps: 12,
        cfg: 1,
        sampler_name: 'er_sde',
        scheduler: 'beta',
        denoise: 1,
        model: attention.model,
        positive: positive.CONDITIONING,
        negative: negative.CONDITIONING,
        latent_image: latent.LATENT,
    })
    const decoded = wf.VAEDecode({samples: sampled.LATENT, vae: vae.VAE})
    const save = wf.SaveImage({filename_prefix: opts.filenamePrefix, images: afterCleanup(wf, decoded.IMAGE, {offload_model: true, offload_cache: true})})

    return {workflow: wf, output: save.__id}
}
