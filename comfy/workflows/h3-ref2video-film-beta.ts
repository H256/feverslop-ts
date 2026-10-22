// The short-film pipeline's video workflow WITHOUT the turbo LoRA - h3-ref2video-film.ts to play with: the same graph, sampled as the
// ComfyUI template does (res_multistep, beta scheduler, 20 steps) instead of 8 steps of euler with the LoRA. About 2.5 times slower; the picture
// follows the prompt more closely (a held shot stays held). Select it with "videoWorkflow": "h3-ref2video-film-beta" in the film's config.json.
// The model is CFG-distilled: no negative prompt, BasicGuider as in the template. Change the sampler, the scheduler or the steps below.
import type {FilmVideoWorkflowOptions} from "./h3-ref2video-film.ts";
import {afterCleanup, dyn, startImages, FPS, MAX_REFERENCE_IMAGES, resolution, widget, withInputs, WorkflowBuilder, type WorkflowResult} from "../helpers.ts";

export {renderFrames} from "./h3-ref2video-film.ts"

export default function h3Ref2VideoFilmBeta(opts: FilmVideoWorkflowOptions): WorkflowResult {
    const wf = new WorkflowBuilder()

    const videoVae = wf.VAELoader({vae_name: 'minimax_h3_video_vae_fp16.safetensors'})
    const audioVae = wf.VAELoader({vae_name: 'minimax_h3_audio_vae_fp32.safetensors'})
    const unet = wf.UNETLoader({unet_name: 'minimax_h3_ref2va_pruned_int8_convrot.safetensors', weight_dtype: 'default'})
    const model = unet   // no turbo LoRA
    const clip = wf.CLIPLoader({clip_name: 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors', type: 'minimax', device: 'default'})

    const prompt = wf.PrimitiveStringMultiline({value: opts.prompt})
    const length = wf.PrimitiveInt({value: opts.frames})
    const size = resolution(wf, opts.resolution, opts.aspect ?? 'landscape', 0.4)

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
    // pose and framing of the last frame of the clip before get lost. This node takes the image as the clip's actual first frame -
    // or the last frames of the clip before (startClip, config.contextFrames) as its first frames.
    const start = startImages(wf, opts)
    const positive = start
        ? wf.MiniMaxH3AddGuide({positive: references.positive, latent: references.LATENT, frame_idx: 0, vae: videoVae.VAE, image: start}).positive
        : references.positive

    const attention = wf.ModelAttentionBackend({model: model.MODEL, attention: 'comfy kitchen attention'})
    const guider = wf.BasicGuider({model: attention.model, conditioning: positive})
    const noise = wf.RandomNoise({noise_seed: opts.seed})
    const sampler = wf.KSamplerSelect({sampler_name: 'res_multistep'})
    const sigmas = wf.BasicScheduler({scheduler: 'beta', steps: 20, denoise: 1, model: model.MODEL})
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

    return {workflow: wf, output: video.__id, size: size.pixels}
}
