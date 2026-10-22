// The two passes of the h3-ref2video-2pass workflows, shared so the Radeon and the RTX variant cannot drift apart.
// The recipe (issue #288):
// pass 1 - the base model without the turbo LoRA, 20 steps res_multistep/simple, at a quarter of the final pixels;
// the video latent x2 with MinimaxH3LatentUpscaler3D; pass 2 - the base model again, euler/beta, 4 steps, denoise 0.2, with a
// noise of its own, at the final size (#343).
import type {NodeRef} from "@saintno/comfyui-sdk";
import {afterCleanup, startImages, type Aspect, dyn, MAX_REFERENCE_IMAGES, pixelSize, type PixelSize, type Resolution, resolution, type VideoWorkflowOptions, widget, withInputs, WorkflowBuilder} from "./helpers.ts";

// the final size when the project leaves videoResolution at -1: pass 1 at 0.5 MP as in the recipe
export const TWO_PASS_DEFAULT = 2

/**
 * The final size is what videoResolution asks for, exactly as every other workflow computes it (pixelSize) - the upscaler
 * is given it as its target. Pass 1 renders half its width and half its height, in multiples of 32.
 */
export function twoPassSizes(setting: Resolution, aspect: Aspect = '16:9'): { final: PixelSize, first: PixelSize } {
    const final = pixelSize(setting, aspect, TWO_PASS_DEFAULT)
    const half = (n: number) => Math.max(32, Math.round(n / 2 / 32) * 32)
    return {final, first: {width: half(final.width), height: half(final.height)}}
}

// a music-video clip's inputs - or a film clip's, without any sound (no song, no audios): then nothing is guided by audio and
// the sound of the clip is the model's own, decoded from the sampled latent as h3-ref2video-film does
type SoundInputs = 'audios' | 'vocals' | 'song' | 'songStart' | 'duration'
export type TwoPassOptions = Omit<VideoWorkflowOptions, SoundInputs> & Partial<Pick<VideoWorkflowOptions, SoundInputs>>

// song: the sound of the video - the trimmed song, or the model's own sound when no song went in
export type TwoPassResult = { images: NodeRef<"IMAGE">, song: NodeRef<"AUDIO">, size: PixelSize }

export function h3TwoPass(wf: WorkflowBuilder, opts: TwoPassOptions, name: string): TwoPassResult {
    const videoVae = wf.VAELoader({vae_name: 'minimax_h3_video_vae_fp16.safetensors'})
    const audioVae = wf.VAELoader({vae_name: 'minimax_h3_audio_vae_fp32.safetensors'})
    const unet = wf.UNETLoader({unet_name: 'minimax_h3_ref2va_pruned_int8_convrot.safetensors', weight_dtype: 'default'})
    const clip = wf.CLIPLoader({clip_name: 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors', type: 'minimax', device: 'default'})

    // the audio tracks, the song guide and the pinned first frame as in h3-ref2video - see the comments there
    const silent = opts.song === undefined
    if (silent && opts.audios?.length) throw new Error(`${name}: audio tracks without the song - a clip has both or no sound going in`)
    if (!silent && (opts.songStart === undefined || opts.duration === undefined)) throw new Error(`${name}: the song without songStart and duration`)
    const tracks = (opts.audios ?? []).map(audio => wf.TrimAudioDuration({
        audio: wf.LoadAudio({audio: dyn(audio)}).AUDIO,
        start_index: opts.songStart!,
        duration: opts.duration!,
    }))
    if (!silent && !tracks.length) throw new Error(`${name}: opts.audios is empty - lib/render.ts should always provide at least the drums track`)

    const prompt = wf.PrimitiveStringMultiline({value: opts.prompt})
    const length = wf.PrimitiveInt({value: opts.frames})
    const sizes = twoPassSizes(opts.resolution, opts.aspect)
    const size = resolution(wf, `${sizes.first.width}x${sizes.first.height}`, opts.aspect ?? 'landscape', TWO_PASS_DEFAULT)

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
    withInputs(wf, references, {
        ...Object.fromEntries(opts.pictures.slice(0, MAX_REFERENCE_IMAGES).map((picture, i) =>
            [`ref_images.ref_image_${i}`, wf.LoadImage({image: dyn(picture)}).IMAGE])),
        ...Object.fromEntries(tracks.map((track, i) => [`ref_audios.ref_audio_${i}`, track.AUDIO])),
    })
    const song = silent ? undefined : wf.TrimAudioDuration({audio: wf.LoadAudio({audio: dyn(opts.song!)}).AUDIO, start_index: opts.songStart!, duration: opts.duration!})
    const startFrame = startImages(wf, opts)

    // The guides are keyframes on the latent's own grid (comfy/ldm/minimax/model.py): a pinned frame encoded for pass 1
    // does not fit the upscaled latent, so each pass anchors the song and the first frame on its own latent. The
    // text and the reference pictures stay those of pass 1 - pass 2 only refines what pass 1 laid out.
    const guide = (latent: NodeRef<"LATENT">) => {
        const guided = song
            ? wf.MiniMaxH3AddGuide({positive: references.positive, latent, frame_idx: 0, audio_vae: audioVae.VAE, audio: song.AUDIO}).positive
            : references.positive
        return startFrame
            ? wf.MiniMaxH3AddGuide({positive: guided, latent, frame_idx: 0, vae: videoVae.VAE, image: startFrame}).positive
            : guided
    }
    const noise = wf.RandomNoise({noise_seed: opts.seed})

    // pass 1: the base model, as h3-ref2video-full
    const base = wf.ModelAttentionBackend({model: unet.MODEL, attention: 'comfy kitchen attention'})
    const first = wf.SamplerCustomAdvanced({
        noise: noise.NOISE,
        guider: wf.BasicGuider({model: base.model, conditioning: guide(references.LATENT)}).GUIDER,
        sampler: wf.KSamplerSelect({sampler_name: 'res_multistep'}).SAMPLER,
        sigmas: wf.BasicScheduler({scheduler: 'simple', steps: 20, denoise: 1, model: unet.MODEL}).SIGMAS,
        latent_image: references.LATENT,
    })

    // x2, to exactly the final size: the upscaler takes the video half of the AV latent only; the audio half goes on as it is.
    // device 'cuda' on both machines: a ROCm build of PyTorch serves the AMD card as "cuda" too, while 'rocm' is refused by a CUDA build
    // The upscaler loads its model past ComfyUI's memory management, so ComfyUI frees nothing for it: with pass 1's UNet
    // (~20 GB) still loaded it ran out of memory on a 32 GB Radeon. Unload first - pass 2 loads the UNet again from RAM.
    const split = wf.LTXVSeparateAVLatent({av_latent: afterCleanup(wf, first.output, {offload_model: true, offload_cache: false})})
    const upscaled = wf.MinimaxH3LatentUpscaler3D({
        latent: split.video_latent,
        model_name: 'minimax_h3_latent_upscaler_3d_bf16.safetensors',
        mode: dyn('target dimensions'),
        align: 32,
        enable_temporal_chunking: true,
        force_unload: true,
        device: 'cuda',
        precision: 'bf16',
    })
    withInputs(wf, upscaled, {'mode.width': sizes.final.width, 'mode.height': sizes.final.height})
    const large = wf.LTXVConcatAVLatent({video_latent: upscaled.latent as NodeRef<"LATENT">, audio_latent: split.audio_latent}).latent

    // pass 2: a short refine of the upscaled latent with the base model - no turbo LoRA, no sigma shift. With the turbo
    // LoRA (2 steps, simple) large faces kept a crosshatch on the skin; the base model at euler/beta over 4 steps weakened
    // it and kept the detail, better than an upscale in pixels (Lanczos or an AI model), which went soft (#343). Its own
    // noise, seed + 1: the noise of pass 1 again on the large latent repeats its pattern.
    const second = wf.SamplerCustomAdvanced({
        noise: wf.RandomNoise({noise_seed: opts.seed + 1}).NOISE,
        guider: wf.BasicGuider({model: base.model, conditioning: guide(large)}).GUIDER,
        sampler: wf.KSamplerSelect({sampler_name: 'euler'}).SAMPLER,
        sigmas: wf.BasicScheduler({scheduler: 'beta', steps: 4, denoise: 0.2, model: unet.MODEL}).SIGMAS,
        latent_image: large,
    })

    const result = afterCleanup(wf, second.output, {offload_model: true, offload_cache: false})
    const images = wf.VAEDecode({samples: result, vae: videoVae.VAE}).IMAGE
    // no song went in: the sound is the model's own - the audio half of the latent went through the upscale as it was and was refined in pass 2
    return {images, song: song?.AUDIO ?? wf.VAEDecodeAudio({samples: result, vae: audioVae.VAE}).AUDIO, size: sizes.final}
}
