// One image edited by FLUX.2 [klein] 4B (the distilled one, 4 steps): the picture goes in as a reference, the prompt says what changes - here the
// views test of a location (tools/film-views-test.ts): "the same place from the other side". Wired like ComfyUI's own Flux.2 Klein edit template.
import {afterCleanup, dyn, type EditWorkflowOptions, widget, WorkflowBuilder, type WorkflowResult} from "../helpers.ts";

export default function edit(opts: EditWorkflowOptions): WorkflowResult {
    const wf = new WorkflowBuilder()

    const unet = wf.UNETLoader({unet_name: 'flux-2-klein-4b.safetensors', weight_dtype: 'default'})
    const clip = wf.CLIPLoader({clip_name: 'qwen_3_4b.safetensors', type: 'flux2', device: 'default'})
    const vae = wf.VAELoader({vae_name: 'flux2-vae.safetensors'})

    const image = wf.LoadImage({image: dyn(opts.image)})
    const scaled = wf.ImageScaleToTotalPixels({image: image.IMAGE, upscale_method: 'lanczos', megapixels: 1, resolution_steps: 1})
    const size = wf.GetImageSize({image: scaled.IMAGE})
    const reference = wf.VAEEncode({pixels: scaled.IMAGE, vae: vae.VAE})

    // the picture is a reference of the positive and of the (empty) negative conditioning
    const positive = wf.ReferenceLatent({conditioning: wf.CLIPTextEncode({text: opts.prompt, clip: clip.CLIP}).CONDITIONING, latent: reference.LATENT})
    const negative = wf.ReferenceLatent({conditioning: wf.ConditioningZeroOut({conditioning: wf.CLIPTextEncode({text: '', clip: clip.CLIP}).CONDITIONING}).CONDITIONING, latent: reference.LATENT})

    const guider = wf.CFGGuider({model: unet.MODEL, positive: positive.CONDITIONING, negative: negative.CONDITIONING, cfg: 1})
    const noise = wf.RandomNoise({noise_seed: opts.seed})
    const sampler = wf.KSamplerSelect({sampler_name: 'euler'})
    const sigmas = wf.Flux2Scheduler({steps: 4, width: widget(size.width), height: widget(size.height)})
    const latent = wf.EmptyFlux2LatentImage({width: widget(size.width), height: widget(size.height), batch_size: 1})
    const sampled = wf.SamplerCustomAdvanced({noise: noise.NOISE, guider: guider.GUIDER, sampler: sampler.SAMPLER, sigmas: sigmas.SIGMAS, latent_image: latent.LATENT})

    const decoded = wf.VAEDecode({samples: sampled.output, vae: vae.VAE})
    const save = wf.SaveImage({filename_prefix: opts.filenamePrefix, images: afterCleanup(wf, decoded.IMAGE, {offload_model: true, offload_cache: true})})
    return {workflow: wf, output: save.__id}
}
