// A finished clip made larger with the second pass of comfy/h3-two-pass.ts, instead of the latent of a first pass: the clip's frames are encoded,
// the video latent is upscaled to the size asked for, and a short sample at a low denoise draws the detail, with the clip's own prompt, pictures and song
// as guides. Nothing is decoded as sound: the clip keeps the sound it has (lib/refinish.ts), so a film's voices stay what they were.
import {afterCleanup, refAudios, type Aspect, dyn, MAX_REFERENCE_IMAGES, type PixelSize, resolution, h3RenderFrames, FPS, widget, withInputs, WorkflowBuilder, type WorkflowResult} from "../helpers.ts";
import type {NodeRef} from "@saintno/comfyui-sdk";

// MiniMaxH3ReferenceToVideo only takes 5 + 17·k frames - a clip of another length is filled up first and cut back after
export const renderFrames = h3RenderFrames

export type RefineOptions = {
    prompt: string,
    pictures: string[],         // ComfyUI input names in <Picture N> order
    video: string,              // ComfyUI input name of the clip
    frames: number,             // its frames, already a length the model accepts
    size: PixelSize,            // what it comes out at
    aspect?: Aspect,
    denoise: number,
    // a music video's: its tracks and the song, trimmed to the clip. A film has none
    audios?: string[],
    song?: string,
    songStart?: number,
    duration?: number,
    seed: number,
    filenamePrefix: string,
}

export default function h3Refine(opts: RefineOptions): WorkflowResult {
    const wf = new WorkflowBuilder()
    const videoVae = wf.VAELoader({vae_name: 'minimax_h3_video_vae_fp16.safetensors'})
    const audioVae = wf.VAELoader({vae_name: 'minimax_h3_audio_vae_fp32.safetensors'})
    const unet = wf.UNETLoader({unet_name: 'minimax_h3_ref2va_pruned_int8_convrot.safetensors', weight_dtype: 'default'})
    // on the CPU: the encoder fills 28 GB of a 32 GB card, and in VRAM the frames of the clip do not fit next to it (Radeon, 2026-11-01)
    const clip = wf.CLIPLoader({clip_name: 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors', type: 'minimax', device: 'cpu'})

    const tracks = refAudios('h3-refine', opts.audios).map(audio => wf.TrimAudioDuration({audio: wf.LoadAudio({audio: dyn(audio)}).AUDIO, start_index: opts.songStart!, duration: opts.duration!}))
    const song = opts.song ? wf.TrimAudioDuration({audio: wf.LoadAudio({audio: dyn(opts.song)}).AUDIO, start_index: opts.songStart!, duration: opts.duration!}) : undefined

    // as in the two passes: the text and the pictures are taken in at half the final size, pass 2 only refines
    const half = (n: number) => Math.max(32, Math.round(n / 2 / 32) * 32)
    const small = resolution(wf, `${half(opts.size.width)}x${half(opts.size.height)}`, opts.aspect ?? 'landscape', 1)
    const references = wf.MiniMaxH3ReferenceToVideo({
        prompt: widget(wf.PrimitiveStringMultiline({value: opts.prompt}).STRING),
        width: small.width,
        height: small.height,
        length: widget(wf.PrimitiveInt({value: opts.frames}).INT),
        ref_image_size: 'match',
        clip: clip.CLIP,
        vae: videoVae.VAE,
        audio_vae: audioVae.VAE,
    })
    withInputs(wf, references, {
        ...Object.fromEntries(opts.pictures.slice(0, MAX_REFERENCE_IMAGES).map((picture, i) => [`ref_images.ref_image_${i}`, wf.LoadImage({image: dyn(picture)}).IMAGE])),
        ...Object.fromEntries(tracks.map((track, i) => [`ref_audios.ref_audio_${i}`, track.AUDIO])),
    })

    // the clip's frames as a latent, in tiles: a long clip does not fit at once
    const frames = wf.VHS_LoadVideo({video: dyn(opts.video), force_rate: 0, custom_width: 0, custom_height: 0, frame_load_cap: 0, skip_first_frames: 0, select_every_nth: 1}).IMAGE
    const encoded = wf.VAEEncodeTiled({pixels: frames, vae: videoVae.VAE, tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 8})
    const upscaled = wf.MinimaxH3LatentUpscaler3D({
        latent: encoded.LATENT,
        model_name: 'minimax_h3_latent_upscaler_3d_bf16.safetensors',
        mode: dyn('target dimensions'),
        align: 32,
        enable_temporal_chunking: true,
        force_unload: true,
        device: 'cuda',
        precision: 'bf16',
    })
    withInputs(wf, upscaled, {'mode.width': opts.size.width, 'mode.height': opts.size.height})
    // the empty audio half of the reference node goes along: the model samples picture and sound as one
    const silence = wf.LTXVSeparateAVLatent({av_latent: references.LATENT}).audio_latent
    const large = wf.LTXVConcatAVLatent({video_latent: upscaled.latent as NodeRef<"LATENT">, audio_latent: silence}).latent
    const positive = song ? wf.MiniMaxH3AddGuide({positive: references.positive, latent: large, frame_idx: 0, audio_vae: audioVae.VAE, audio: song.AUDIO}).positive : references.positive

    // pass 2 of comfy/h3-two-pass.ts: the base model, euler/beta, 4 steps
    const base = wf.ModelAttentionBackend({model: unet.MODEL, attention: 'comfy kitchen attention'})
    const sampled = wf.SamplerCustomAdvanced({
        noise: wf.RandomNoise({noise_seed: opts.seed}).NOISE,
        guider: wf.BasicGuider({model: base.model, conditioning: positive}).GUIDER,
        sampler: wf.KSamplerSelect({sampler_name: 'euler'}).SAMPLER,
        sigmas: wf.BasicScheduler({scheduler: 'beta', steps: 4, denoise: opts.denoise, model: unet.MODEL}).SIGMAS,
        latent_image: large,
    })
    const images = wf.VAEDecode({samples: afterCleanup(wf, sampled.output, {offload_model: true, offload_cache: false}), vae: videoVae.VAE}).IMAGE

    const video = wf.VHS_VideoCombine({images, frame_rate: FPS, loop_count: 0, filename_prefix: opts.filenamePrefix, format: 'video/h264-mp4', pingpong: false, save_output: true})
    withInputs(wf, video, {pix_fmt: 'yuv420p', crf: 17, save_metadata: true, trim_to_audio: false})
    return {workflow: wf, output: video.__id, size: opts.size}
}
