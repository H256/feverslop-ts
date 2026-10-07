// One image edited by Qwen-Image-Edit with a LoRA that does the camera work - the views test of a location (tools/film-views-test.ts).
// qwenAngles: Qwen-Image-Edit-2509 + "Multiple angles" (turn the camera by degrees). qwenNextScene: 2511 + "Next Scene" (the next shot of a film in
// the same place). Both with a Lightning LoRA (4 steps). Wired like ComfyUI's own Qwen-Image-Edit template.
import {afterCleanup, dyn, type EditWorkflowOptions, WorkflowBuilder, type WorkflowResult} from "../helpers.ts";

// the file names are typed from what the ComfyUI server has installed (comfy/nodes.ts) - a model that is not there does not typecheck
type UnetName = Parameters<WorkflowBuilder['UNETLoader']>[0]['unet_name']
type LoraName = Parameters<WorkflowBuilder['LoraLoaderModelOnly']>[0]['lora_name']
type Setup = { unet: UnetName, loras: { name: LoraName, strength: number }[] }

function qwenEdit(setup: Setup) {
    return function edit(opts: EditWorkflowOptions): WorkflowResult {
        const wf = new WorkflowBuilder()

        const unet = wf.UNETLoader({unet_name: setup.unet, weight_dtype: 'default'})
        const loras = setup.loras.reduce((model, lora) => wf.LoraLoaderModelOnly({lora_name: lora.name, strength_model: lora.strength, model}).MODEL, unet.MODEL)
        const aura = wf.ModelSamplingAuraFlow({model: loras, shift: 3})
        const normed = wf.CFGNorm({model: aura.MODEL, strength: 1})
        const clip = wf.CLIPLoader({clip_name: 'qwen_2.5_vl_7b_fp8_scaled.safetensors', type: 'qwen_image', device: 'default'})
        const vae = wf.VAELoader({vae_name: 'qwen_image_vae.safetensors'})

        const image = wf.LoadImage({image: dyn(opts.image)})
        const scaled = wf.ImageScaleToTotalPixels({image: image.IMAGE, upscale_method: 'lanczos', megapixels: 1, resolution_steps: 1})
        const positive = wf.TextEncodeQwenImageEditPlus({clip: clip.CLIP, prompt: opts.prompt, vae: vae.VAE, image1: scaled.IMAGE})
        const negative = wf.TextEncodeQwenImageEditPlus({clip: clip.CLIP, prompt: '', vae: vae.VAE, image1: scaled.IMAGE})
        const latent = wf.VAEEncode({pixels: scaled.IMAGE, vae: vae.VAE})

        const sampled = wf.KSampler({
            model: normed.patched_model, seed: opts.seed, steps: 4, cfg: 1, sampler_name: 'euler', scheduler: 'simple',
            positive: positive.CONDITIONING, negative: negative.CONDITIONING, latent_image: latent.LATENT, denoise: 1,
        })
        const decoded = wf.VAEDecode({samples: sampled.LATENT, vae: vae.VAE})
        const save = wf.SaveImage({filename_prefix: opts.filenamePrefix, images: afterCleanup(wf, decoded.IMAGE, {offload_model: true, offload_cache: true})})
        return {workflow: wf, output: save.__id}
    }
}

export const qwenAngles = qwenEdit({
    unet: 'qwen_image_edit_2509_fp8_e4m3fn.safetensors',
    loras: [
        {name: 'Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors', strength: 1},
        {name: 'qwen-edit\\Qwen-Edit-2509-Multiple-angles.safetensors', strength: 1},
    ],
})

export const qwenNextScene = qwenEdit({
    unet: 'qwen_image_edit_2511_fp8mixed.safetensors',
    loras: [
        {name: 'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors', strength: 1},
        {name: 'next-scene_lora-v2-3000.safetensors', strength: 0.8},
    ],
})

export default qwenAngles
