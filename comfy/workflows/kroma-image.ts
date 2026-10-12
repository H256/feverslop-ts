// Originally exported from ComfyUI as kroma.json (see README's "Workflows" section) - two passes: Kroma v0.3.1 turbo
// renders the picture at half size, which is scaled up 2x and refined by a short second sampling (denoise 0.2).
import {afterCleanup, dyn, type ImageWorkflowOptions, resolution, widget, withInputs, WorkflowBuilder, type WorkflowResult} from "../helpers.ts";

export default function kromaImage(opts: ImageWorkflowOptions): WorkflowResult {
    const wf = new WorkflowBuilder()

    const model = wf.UNETLoader({unet_name: 'kroma-v0.3.1-turbo-opd.safetensors', weight_dtype: 'default'})
    const clip = wf.CLIPLoader({clip_name: 'qwen3vl_4b_fp8_scaled.safetensors', type: 'krea2', device: 'default'})
    const vae = wf.VAELoader({vae_name: 'qwen_image_vae.safetensors'})

    const positive = wf.CLIPTextEncode({text: opts.prompt, clip: clip.CLIP})
    const negative = wf.ConditioningZeroOut({conditioning: positive.CONDITIONING})

    // the size of the first pass - the saved picture is twice as large
    const size = resolution(wf, opts.resolution, opts.orientation, '544x960')
    const latent = wf.EmptyLatentImage({width: size.width, height: size.height, batch_size: 1})

    // one seed for both passes
    const seed = wf.SeedNode({seed: opts.seed})

    const firstPass = wf.KSampler({
        seed: widget(seed.seed),
        steps: 8,
        cfg: 1,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1,
        model: model.MODEL,
        positive: positive.CONDITIONING,
        negative: negative.CONDITIONING,
        latent_image: latent.LATENT,
    })
    const firstImage = wf.VAEDecode({samples: firstPass.LATENT, vae: vae.VAE})

    const upscaled = wf.ImageScaleBy({upscale_method: 'lanczos', scale_by: 2, image: firstImage.IMAGE})
    const upscaledLatent = wf.VAEEncode({pixels: upscaled.IMAGE, vae: vae.VAE})

    const refinePass = wf.KSampler({
        seed: widget(seed.seed),
        steps: 4,
        cfg: 1,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 0.2,
        model: model.MODEL,
        positive: positive.CONDITIONING,
        negative: negative.CONDITIONING,
        latent_image: upscaledLatent.LATENT,
    })
    const refinedImage = wf.VAEDecode({samples: refinePass.LATENT, vae: vae.VAE})

    // the pipeline's PNG, with the bit depth and colour space of the export
    const save = wf.SaveImageAdvanced({filename_prefix: opts.filenamePrefix, format: dyn('png'), images: afterCleanup(wf, refinedImage.IMAGE)})
    withInputs(wf, save, {'format.bit_depth': '16-bit', 'format.input_color_space': 'sRGB'})

    return {workflow: wf, output: save.__id}
}
