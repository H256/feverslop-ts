// The silent turnaround video of a reference sheet (lib/sequenceSheet.ts), for every model it is rendered with: one still
// reference image in as the first frame (MiniMaxH3ImageToVideo), a few hard-cut "beats" out - different angles and expressions
// of a character, different views of a place - later sampled into frames and composited into a multi-angle sheet.
// The model and its sampling are a recipe: the FL2VA model with its 8-step turbo LoRA (h3-sequence-to-sheet), or a
// distilled checkpoint that needs no LoRA (h3-sequence-to-sheet-prism).
import {afterCleanup, dyn, FPS, resolution, type SequenceWorkflowOptions, widget, withInputs, WorkflowBuilder, type WorkflowResult} from './helpers.ts'

export type SheetRecipe = {
    unet: string
    // a turbo LoRA on top of the model - none for a distilled checkpoint
    lora?: string
    // the sigma shift a distilled checkpoint is sampled at (MiniMaxH3SigmaShift)
    shift?: {video: number; audio: number}
    sampler: string
    scheduler: string
    steps: number
}

// the FL2VA model with its 8-step turbo LoRA, res_multistep/simple
export const TURBO_SHEET: SheetRecipe = {
    unet: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
    lora: 'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors',
    sampler: 'res_multistep',
    scheduler: 'simple',
    steps: 8,
}

// The distilled PRISM DMAD/PDMD checkpoint, sampled as its two-pass clips are (comfy/h3-two-pass.ts PRISM_TWO_PASS): shift
// 12/3, 4 steps euler/beta57 (a scheduler of RES4LYF). It is a merge of two Ref2VA finetunes, here driven by the FL2VA node's
// first frame - whether it holds the anchor through the beats as the FL2VA model does is what a render shows.
export const PRISM_SHEET: SheetRecipe = {
    unet: 'PRISM_DMAD_PDMD_int8.safetensors',
    shift: {video: 12, audio: 3},
    sampler: 'euler',
    scheduler: 'beta57',
    steps: 4,
}

export function sequenceSheetWorkflow(opts: SequenceWorkflowOptions, recipe: SheetRecipe): WorkflowResult {
    const wf = new WorkflowBuilder()

    const videoVae = wf.VAELoader({vae_name: 'minimax_h3_video_vae_fp16.safetensors'})
    const unet = wf.UNETLoader({unet_name: dyn(recipe.unet), weight_dtype: 'default'}).MODEL
    const model = recipe.lora
        ? wf.LoraLoaderModelOnly({lora_name: dyn(recipe.lora), strength_model: 1, model: unet}).MODEL
        : recipe.shift
          ? wf.MiniMaxH3SigmaShift({model: unet, shift_video: recipe.shift.video, shift_audio: recipe.shift.audio}).MODEL
          : unet
    const clip = wf.CLIPLoader({clip_name: 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors', type: 'minimax', device: 'default'})

    const size = resolution(wf, opts.resolution, opts.orientation, 0.85)
    const length = wf.PrimitiveInt({value: opts.frames})
    const startFrame = wf.LoadImage({image: dyn(opts.startFrame)})

    const i2v = wf.MiniMaxH3ImageToVideo({
        prompt: opts.prompt,
        width: size.width,
        height: size.height,
        length: widget(length.INT),
        first_frame: startFrame.IMAGE,
        clip: clip.CLIP,
        vae: videoVae.VAE,
    })

    // int8 attention through comfy-kitchen: ~25% faster sampling on the Radeon. Only the guider gets it - the scheduler just needs the sigma schedule
    const attention = wf.ModelAttentionBackend({model, attention: 'comfy kitchen attention'})
    const guider = wf.BasicGuider({model: attention.model, conditioning: i2v.positive})
    const noise = wf.RandomNoise({noise_seed: opts.seed})
    const sampler = wf.KSamplerSelect({sampler_name: dyn(recipe.sampler)})
    const sigmas = wf.BasicScheduler({scheduler: dyn(recipe.scheduler), steps: recipe.steps, denoise: 1, model})
    const sampled = wf.SamplerCustomAdvanced({
        noise: noise.NOISE,
        guider: guider.GUIDER,
        sampler: sampler.SAMPLER,
        sigmas: sigmas.SIGMAS,
        latent_image: i2v.LATENT,
    })

    const decoded = wf.VAEDecode({samples: afterCleanup(wf, sampled.output, {offload_model: true, offload_cache: false}), vae: videoVae.VAE})
    const video = wf.VHS_VideoCombine({
        images: decoded.IMAGE,
        frame_rate: FPS,
        loop_count: 0,
        filename_prefix: opts.filenamePrefix,
        format: 'video/h264-mp4',
        pingpong: false,
        save_output: true,
    })
    withInputs(wf, video, {pix_fmt: 'yuv420p', crf: 19, save_metadata: true, trim_to_audio: false})

    return {workflow: wf, output: video.__id}
}
