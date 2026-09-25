// Silent turnaround video from one still reference image, for the reference-sheet pipeline (lib/sequenceSheet.ts):
// hero image in, a few hard-cut "beats" (different angles/expression for a character, different views for a
// location) out, later sampled into frames and composited into a multi-angle reference sheet. Ported from the
// predecessor project's fever-slop workflow (sequence_to_sheet_minimax_h3_i2va_v1.json) onto this project's own
// MiniMaxH3ImageToVideo (first_frame, no ref_images/audio - unlike h3-ref2video.ts's MiniMaxH3ReferenceToVideo).
import {afterCleanup, dyn, FPS, resolution, type SequenceWorkflowOptions, widget, withInputs, WorkflowBuilder, type WorkflowResult} from "../helpers.ts";

export default function h3SequenceToSheet(opts: SequenceWorkflowOptions): WorkflowResult {
    const wf = new WorkflowBuilder()

    const videoVae = wf.VAELoader({vae_name: 'minimax_h3_video_vae_fp16.safetensors'})
    const unet = wf.UNETLoader({unet_name: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors', weight_dtype: 'default'})
    const model = wf.LoraLoaderModelOnly({lora_name: 'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors', strength_model: 1, model: unet.MODEL})
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

    const guider = wf.BasicGuider({model: model.MODEL, conditioning: i2v.positive})
    const noise = wf.RandomNoise({noise_seed: opts.seed})
    const sampler = wf.KSamplerSelect({sampler_name: 'res_multistep'})
    const sigmas = wf.BasicScheduler({scheduler: 'simple', steps: 8, denoise: 1, model: model.MODEL})
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
