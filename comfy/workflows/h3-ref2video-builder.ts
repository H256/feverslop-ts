import {afterCleanup, refAudios, dyn, endGuide, startImages, FPS, MAX_REFERENCE_IMAGES, resolution, type VideoWorkflowOptions, widget, withInputs, WorkflowBuilder, type WorkflowResult} from "../helpers.ts";
import type {FilmVideoWorkflowOptions} from "./h3-ref2video-film.ts";

type Options = VideoWorkflowOptions | FilmVideoWorkflowOptions
type Variant = {
    name: string,
    clipDevice?: 'default' | 'cpu',
    turbo?: boolean,
    sampler: 'euler' | 'res_multistep',
    scheduler: 'simple' | 'beta',
    steps: (opts: Options) => number,
}

/** Shared one-pass H3 graph; variants supply only the model/sampler differences. */
export function h3Ref2Video(opts: Options, variant: Variant): WorkflowResult {
    const wf = new WorkflowBuilder()
    const videoVae = wf.VAELoader({vae_name: 'minimax_h3_video_vae_fp16.safetensors'})
    const audioVae = wf.VAELoader({vae_name: 'minimax_h3_audio_vae_fp32.safetensors'})
    const unet = wf.UNETLoader({unet_name: 'minimax_h3_ref2va_pruned_int8_convrot.safetensors', weight_dtype: 'default'})
    const lora = variant.turbo ? wf.LoraLoaderModelOnly({lora_name: 'minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors', strength_model: 1, model: unet.MODEL}) : undefined
    const shifted = lora ? wf.MiniMaxH3SigmaShift({model: lora.MODEL, shift_video: 12, shift_audio: 3}) : undefined
    const model = shifted?.MODEL ?? unet.MODEL
    const clip = wf.CLIPLoader({clip_name: 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors', type: 'minimax', device: variant.clipDevice ?? 'default'})
    const audio = 'audios' in opts
    const tracks = audio ? refAudios(variant.name, opts.audios).map(name => wf.TrimAudioDuration({
        audio: wf.LoadAudio({audio: dyn(name)}).AUDIO,
        start_index: opts.songStart,
        duration: opts.duration,
    })) : []
    if (audio && !tracks.length) throw new Error(`${variant.name}: opts.audios is empty - lib/render.ts should always provide at least the drums track`)

    const prompt = wf.PrimitiveStringMultiline({value: opts.prompt})
    const length = wf.PrimitiveInt({value: opts.frames})
    const size = resolution(wf, opts.resolution, opts.aspect ?? 'landscape', 0.4, opts.preview?.scale)
    const references = wf.MiniMaxH3ReferenceToVideo({
        prompt: widget(prompt.STRING), width: size.width, height: size.height, length: widget(length.INT),
        ref_image_size: 'match', clip: clip.CLIP, vae: videoVae.VAE, audio_vae: audioVae.VAE,
    })
    withInputs(wf, references, {
        ...Object.fromEntries(opts.pictures.slice(0, MAX_REFERENCE_IMAGES).map((picture, i) =>
            [`ref_images.ref_image_${i}`, wf.LoadImage({image: dyn(picture)}).IMAGE])),
        ...Object.fromEntries(tracks.map((track, i) => [`ref_audios.ref_audio_${i}`, track.AUDIO])),
    })
    let positive = references.positive
    let song: ReturnType<typeof wf.TrimAudioDuration> | undefined
    if (audio) {
        song = wf.TrimAudioDuration({audio: wf.LoadAudio({audio: dyn(opts.song)}).AUDIO, start_index: opts.songStart, duration: opts.duration})
        positive = wf.MiniMaxH3AddGuide({positive, latent: references.LATENT, frame_idx: 0, audio_vae: audioVae.VAE, audio: song.AUDIO}).positive
    }
    const start = startImages(wf, opts)
    if (start) positive = wf.MiniMaxH3AddGuide({positive, latent: references.LATENT, frame_idx: 0, vae: videoVae.VAE, image: start}).positive
    const attention = wf.ModelAttentionBackend({model, attention: 'comfy kitchen attention'})
    const guider = wf.BasicGuider({model: attention.model, conditioning: endGuide(wf, positive, references.LATENT, videoVae.VAE, opts.endFrame)})
    const noise = wf.RandomNoise({noise_seed: opts.seed})
    const sampler = wf.KSamplerSelect({sampler_name: variant.sampler})
    const sigmas = wf.BasicScheduler({scheduler: variant.scheduler, steps: variant.steps(opts), denoise: 1, model})
    const sampled = wf.SamplerCustomAdvanced({noise: noise.NOISE, guider: guider.GUIDER, sampler: sampler.SAMPLER, sigmas: sigmas.SIGMAS, latent_image: references.LATENT})
    const result = afterCleanup(wf, sampled.output, {offload_model: true, offload_cache: false})
    const decoded = wf.VAEDecode({samples: result, vae: videoVae.VAE})
    const outputAudio = song?.AUDIO ?? wf.VAEDecodeAudio({samples: result, vae: audioVae.VAE}).AUDIO
    const video = wf.VHS_VideoCombine({images: decoded.IMAGE, audio: outputAudio, frame_rate: FPS, loop_count: 0, filename_prefix: opts.filenamePrefix, format: 'video/h264-mp4', pingpong: false, save_output: true})
    withInputs(wf, video, {pix_fmt: 'yuv420p', crf: 19, save_metadata: true, trim_to_audio: false})
    return {workflow: wf, output: video.__id, size: size.pixels}
}
