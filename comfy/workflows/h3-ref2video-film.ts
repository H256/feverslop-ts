// The short-film pipeline's video workflow (film.ts) - h3-ref2video without any audio input: nothing is locked into the
// clip and no stems are referenced, the model speaks the dialogue itself from the prompt (<d>[Language] ...</d>) and
// makes its own ambience. As in ComfyUI's own template (video_minimax_h3_r2v) MiniMaxH3ReferenceToVideo already returns an
// empty video+audio latent: it is sampled as it is, and the result is decoded twice - the picture with the video VAE, the
// sound with the audio VAE.
import {afterCleanup, dyn, FPS, MAX_REFERENCE_IMAGES, type RenderFrames, type Resolution, resolution, widget, withInputs, WorkflowBuilder, type WorkflowResult} from "../helpers.ts";

export type FilmVideoWorkflowOptions = {
    prompt: string,
    pictures: string[],         // ComfyUI input names in <Picture N> order
    // ComfyUI input name of the picture the video has to start on (a continuing clip's first frame, config.pinStartFrame):
    // locked to frame 0 with MiniMaxH3AddGuide instead of only being one of the loose reference pictures
    startFrame?: string,
    frames: number,             // frames to render, already a length the model accepts (see renderFrames)
    seed: number,
    resolution: Resolution,     // always rendered landscape
    // "turbo" = the 8-step turbo LoRA (fast); "beta" / "simple" = no LoRA, 20 steps of res_multistep with that scheduler (slower, follows the prompt better)
    sampling?: VideoSampling,
    filenamePrefix: string,
}

export type VideoSampling = 'turbo' | 'beta' | 'simple'

// MiniMaxH3ReferenceToVideo only renders 5 + 17·k frames - round up, the rest is cut off in the final film
export const renderFrames: RenderFrames = frames => 5 + 17 * Math.ceil(Math.max(0, frames - 5) / 17)

export default function h3Ref2VideoFilm(opts: FilmVideoWorkflowOptions): WorkflowResult {
    const wf = new WorkflowBuilder()

    const videoVae = wf.VAELoader({vae_name: 'minimax_h3_video_vae_fp16.safetensors'})
    const audioVae = wf.VAELoader({vae_name: 'minimax_h3_audio_vae_fp32.safetensors'})
    const unet = wf.UNETLoader({unet_name: 'minimax_h3_ref2va_pruned_int8_convrot.safetensors', weight_dtype: 'default'})
    const sampling = opts.sampling ?? 'turbo'
    const model = sampling === 'turbo'
        ? wf.LoraLoaderModelOnly({lora_name: 'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors', strength_model: 1, model: unet.MODEL})
        : unet
    const clip = wf.CLIPLoader({clip_name: 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors', type: 'minimax', device: 'default'})

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
    // autogrow slots: ref_images.ref_image_0 = <Picture 1>, ...
    withInputs(wf, references, Object.fromEntries(opts.pictures.slice(0, MAX_REFERENCE_IMAGES).map((picture, i) =>
        [`ref_images.ref_image_${i}`, wf.LoadImage({image: dyn(picture)}).IMAGE])))

    // A continuing clip's first frame is a ref image like any other above - references only carry identity and place, the
    // pose and framing of the last frame of the clip before get lost. This node takes the image as the clip's actual first frame.
    const positive = opts.startFrame
        ? wf.MiniMaxH3AddGuide({positive: references.positive, latent: references.LATENT, frame_idx: 0, vae: videoVae.VAE, image: wf.LoadImage({image: dyn(opts.startFrame)}).IMAGE}).positive
        : references.positive

    const attention = wf.ModelAttentionBackend({model: model.MODEL, attention: 'comfy kitchen attention'})
    const guider = wf.BasicGuider({model: attention.model, conditioning: positive})
    const noise = wf.RandomNoise({noise_seed: opts.seed})
    const sampler = wf.KSamplerSelect({sampler_name: sampling === 'turbo' ? 'euler' : 'res_multistep'})
    const sigmas = sampling === 'turbo'
        ? wf.BasicScheduler({scheduler: 'beta57', steps: 8, denoise: 1, model: model.MODEL})
        : wf.BasicScheduler({scheduler: sampling, steps: 20, denoise: 1, model: model.MODEL})
    // No audio goes in - not as a reference, not as a guide: the latent of the reference node is the (empty) one that is sampled
    const sampled = wf.SamplerCustomAdvanced({
        noise: noise.NOISE,
        guider: guider.GUIDER,
        sampler: sampler.SAMPLER,
        sigmas: sigmas.SIGMAS,
        latent_image: references.LATENT,
    })

    // the sampled latent carries picture and sound - each decoded with its own VAE
    const result = afterCleanup(wf, sampled.output, {offload_model: true, offload_cache: false})
    const decoded = wf.VAEDecode({samples: result, vae: videoVae.VAE})
    const speech = wf.VAEDecodeAudio({samples: result, vae: audioVae.VAE})
    const video = wf.VHS_VideoCombine({
        images: decoded.IMAGE,
        audio: speech.AUDIO,
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
