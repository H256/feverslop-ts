// Rebuilt from comfy/r2v_audio_fullmix_guide_1-pass_turbo.json
import {afterCleanup, dyn, FPS, MAX_REFERENCE_IMAGES, type RenderFrames, resolution, type VideoWorkflowOptions, widget, withInputs, WorkflowBuilder, type WorkflowResult} from "../helpers.ts";

// MiniMaxH3ReferenceToVideo only renders 5 + 17·k frames - round up, the rest is cut off in the final video
export const renderFrames: RenderFrames = frames => 5 + 17 * Math.ceil(Math.max(0, frames - 5) / 17)

export default function h3Ref2Video(opts: VideoWorkflowOptions): WorkflowResult {
    const wf = new WorkflowBuilder()

    const videoVae = wf.VAELoader({vae_name: 'minimax_h3_video_vae_fp16.safetensors'})
    const audioVae = wf.VAELoader({vae_name: 'minimax_h3_audio_vae_fp32.safetensors'})
    const unet = wf.UNETLoader({unet_name: 'minimax_h3_ref2va_pruned_int8_convrot.safetensors', weight_dtype: 'default'})
    const model = wf.LoraLoaderModelOnly({lora_name: 'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors', strength_model: 1, model: unet.MODEL})
    const clip = wf.CLIPLoader({clip_name: 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors', type: 'minimax', device: 'default'})

    // <Audio 1>: the clip's part of the song - reference, guide and final soundtrack
    const song = wf.LoadAudio({audio: dyn(opts.song)})
    const audio = wf.TrimAudioDuration({audio: song.AUDIO, start_index: opts.songStart, duration: opts.duration})
    // <Audio 2>, only for clips with a singer: the same part of the isolated vocals - the voice reference for the lip-sync.
    // The audio guide and the MP4's soundtrack stay on the full mix.
    const vocals = opts.vocals
        ? wf.TrimAudioDuration({audio: wf.LoadAudio({audio: dyn(opts.vocals)}).AUDIO, start_index: opts.songStart, duration: opts.duration})
        : undefined

    const prompt = wf.PrimitiveStringMultiline({value: opts.prompt})
    const length = wf.PrimitiveInt({value: opts.frames})
    const size = resolution(wf, opts.resolution, 'landscape', 0.4)

    const references = wf.MiniMaxH3ReferenceToVideo({
        prompt: widget(prompt.STRING),
        width: size.width,
        height: size.height,
        length: widget(length.INT),
        ref_image_size: 'match',
        clip: clip.CLIP,
        vae: videoVae.VAE,
        audio_vae: audioVae.VAE,
    })
    // autogrow slots: ref_images.ref_image_0 = <Picture 1>, ..., ref_audios.ref_audio_0 = <Audio 1>, ...
    withInputs(wf, references, {
        ...Object.fromEntries(opts.pictures.slice(0, MAX_REFERENCE_IMAGES).map((picture, i) =>
            [`ref_images.ref_image_${i}`, wf.LoadImage({image: dyn(picture)}).IMAGE])),
        'ref_audios.ref_audio_0': audio.AUDIO,
        ...(vocals ? {'ref_audios.ref_audio_1': vocals.AUDIO} : {}),
    })

    const guided = wf.MiniMaxH3AddGuide({
        frame_idx: 0,
        positive: references.positive,
        latent: references.LATENT,
        audio_vae: audioVae.VAE,
        audio: audio.AUDIO,
    })
    const guider = wf.BasicGuider({model: model.MODEL, conditioning: guided.positive})
    const noise = wf.RandomNoise({noise_seed: opts.seed})
    const sampler = wf.KSamplerSelect({sampler_name: 'euler'})
    const sigmas = wf.BasicScheduler({scheduler: 'beta57', steps: 8, denoise: 1, model: model.MODEL})
    const sampled = wf.SamplerCustomAdvanced({
        noise: noise.NOISE,
        guider: guider.GUIDER,
        sampler: sampler.SAMPLER,
        sigmas: sigmas.SIGMAS,
        latent_image: references.LATENT,
    })

    const decoded = wf.VAEDecode({samples: afterCleanup(wf, sampled.output, {offload_model: true, offload_cache: false}), vae: videoVae.VAE})
    const video = wf.VHS_VideoCombine({
        images: decoded.IMAGE,
        audio: audio.AUDIO,
        frame_rate: FPS,
        loop_count: 0,
        filename_prefix: opts.filenamePrefix,
        format: 'video/h264-mp4',
        pingpong: false,
        save_output: true,
    })
    // widgets VHS only adds for the h264 format
    withInputs(wf, video, {pix_fmt: 'yuv420p', crf: 19, save_metadata: true, trim_to_audio: false})

    return {workflow: wf, output: video.__id}
}
