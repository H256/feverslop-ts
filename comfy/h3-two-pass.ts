// The two passes of the h3-ref2video-2pass workflows, shared so the Radeon and the RTX variant cannot drift apart.
// The recipe (issue #288):
// pass 1 - the base model without the turbo LoRA, 20 steps res_multistep/simple, at a quarter of the final pixels;
// the video latent x2 with MinimaxH3LatentUpscaler3D; pass 2 - the turbo LoRA, 2 steps, denoise 0.2, at the final size.
import type {NodeRef} from "@saintno/comfyui-sdk";
import {afterCleanup, dyn, MAX_REFERENCE_IMAGES, type Resolution, resolution, type VideoWorkflowOptions, widget, withInputs, WorkflowBuilder} from "./helpers.ts";

// the final size when the project leaves videoResolution at -1: pass 1 at 0.5 MP as in the recipe
export const TWO_PASS_DEFAULT = 2

/** Pass 1's size: half the width and half the height of the final size - the upscaler doubles both. */
export function passOneSize(setting: Resolution): Exclude<Resolution, -1> {
    const final = setting === -1 ? TWO_PASS_DEFAULT : setting
    if (typeof final === 'number') return final / 4
    const half = (n: number) => Math.max(32, Math.round(n / 2 / 32) * 32)
    const [w, h] = final.split('x').map(Number) as [number, number]
    return `${half(w)}x${half(h)}`
}

export type TwoPassResult = { images: NodeRef<"IMAGE">, song: NodeRef<"AUDIO"> }

export function h3TwoPass(wf: WorkflowBuilder, opts: VideoWorkflowOptions, name: string): TwoPassResult {
    const videoVae = wf.VAELoader({vae_name: 'minimax_h3_video_vae_fp16.safetensors'})
    const audioVae = wf.VAELoader({vae_name: 'minimax_h3_audio_vae_fp32.safetensors'})
    const unet = wf.UNETLoader({unet_name: 'minimax_h3_ref2va_pruned_int8_convrot.safetensors', weight_dtype: 'default'})
    const clip = wf.CLIPLoader({clip_name: 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors', type: 'minimax', device: 'default'})

    // the audio tracks, the song guide and the pinned first frame as in h3-ref2video - see the comments there
    const tracks = (opts.audios ?? []).map(audio => wf.TrimAudioDuration({
        audio: wf.LoadAudio({audio: dyn(audio)}).AUDIO,
        start_index: opts.songStart,
        duration: opts.duration,
    }))
    if (!tracks.length) throw new Error(`${name}: opts.audios is empty - lib/render.ts should always provide at least the drums track`)

    const prompt = wf.PrimitiveStringMultiline({value: opts.prompt})
    const length = wf.PrimitiveInt({value: opts.frames})
    const size = resolution(wf, passOneSize(opts.resolution), 'landscape', TWO_PASS_DEFAULT / 4)

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
    const song = wf.TrimAudioDuration({audio: wf.LoadAudio({audio: dyn(opts.song)}).AUDIO, start_index: opts.songStart, duration: opts.duration})
    const startFrame = opts.startFrame ? wf.LoadImage({image: dyn(opts.startFrame)}).IMAGE : undefined

    // The guides are keyframes on the latent's own grid (comfy/ldm/minimax/model.py): a pinned frame encoded for pass 1
    // does not fit the upscaled latent, so each pass anchors the song and the first frame on its own latent. The
    // text and the reference pictures stay those of pass 1 - pass 2 only refines what pass 1 laid out.
    const guide = (latent: NodeRef<"LATENT">) => {
        const guided = wf.MiniMaxH3AddGuide({positive: references.positive, latent, frame_idx: 0, audio_vae: audioVae.VAE, audio: song.AUDIO})
        return startFrame
            ? wf.MiniMaxH3AddGuide({positive: guided.positive, latent, frame_idx: 0, vae: videoVae.VAE, image: startFrame}).positive
            : guided.positive
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

    // x2: the upscaler takes the video half of the AV latent only; the audio half goes on as it is.
    // device 'cuda' on both machines: a ROCm build of PyTorch serves the AMD card as "cuda" too, while 'rocm' is refused by a CUDA build
    // The upscaler loads its model past ComfyUI's memory management, so ComfyUI frees nothing for it: with pass 1's UNet
    // (~20 GB) still loaded it ran out of memory on a 32 GB Radeon. Unload first - pass 2 loads the UNet again from RAM.
    const split = wf.LTXVSeparateAVLatent({av_latent: afterCleanup(wf, first.output, {offload_model: true, offload_cache: false})})
    const upscaled = wf.MinimaxH3LatentUpscaler3D({
        latent: split.video_latent,
        model_name: 'minimax_h3_latent_upscaler_3d_bf16.safetensors',
        mode: dyn('scale by multiplier'),
        align: 32,
        enable_temporal_chunking: true,
        force_unload: true,
        device: 'cuda',
        precision: 'bf16',
    })
    withInputs(wf, upscaled, {'mode.scale': 2})
    const large = wf.LTXVConcatAVLatent({video_latent: upscaled.latent as NodeRef<"LATENT">, audio_latent: split.audio_latent}).latent

    // pass 2: the turbo LoRA with its shifts (as h3-ref2video), a short refine of the upscaled latent
    const lora = wf.LoraLoaderModelOnly({lora_name: 'minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors', strength_model: 1, model: unet.MODEL})
    const shifted = wf.MiniMaxH3SigmaShift({model: lora.MODEL, shift_video: 12, shift_audio: 3})
    const turbo = wf.ModelAttentionBackend({model: shifted.MODEL, attention: 'comfy kitchen attention'})
    const second = wf.SamplerCustomAdvanced({
        noise: noise.NOISE,
        guider: wf.BasicGuider({model: turbo.model, conditioning: guide(large)}).GUIDER,
        sampler: wf.KSamplerSelect({sampler_name: 'euler'}).SAMPLER,
        sigmas: wf.BasicScheduler({scheduler: 'simple', steps: 2, denoise: 0.2, model: shifted.MODEL}).SIGMAS,
        latent_image: large,
    })

    const images = wf.VAEDecode({samples: afterCleanup(wf, second.output, {offload_model: true, offload_cache: false}), vae: videoVae.VAE}).IMAGE
    return {images, song: song.AUDIO}
}
