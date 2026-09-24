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

    // Multi-track audio: one <Audio N> per stem actually audible on screen (see lib/compose.ts). opts.audios
    // names the *whole* stem file for each track (lib/render.ts uploads the full separated stem, not a
    // per-clip cut) - every track covers the same span, this clip's full length, so all of them trim with the
    // same start/duration. Not clip.frames: MiniMaxH3ReferenceToVideo only accepts a few frame counts and
    // rounds up (see renderFrames below) - the ref_audio has to cover the length actually rendered, or the
    // model runs out of audio before the video ends. No single track is "the" song, so the first one stands in
    // for the MP4's own soundtrack, which is discarded and replaced with the real song later anyway (see
    // config.json songAudio).
    const tracks = (opts.audios ?? []).map(name => wf.TrimAudioDuration({
        audio: wf.LoadAudio({audio: dyn(name)}).AUDIO,
        start_index: opts.songStart,
        duration: opts.duration,
    }))
    if (!tracks.length) throw new Error('h3-ref2video: opts.audios is empty - lib/render.ts should always provide at least the drums track')

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
        ...Object.fromEntries(tracks.map((track, i) => [`ref_audios.ref_audio_${i}`, track.AUDIO])),
    })
    // Lock the vocals track into the video's own AV latent instead of only offering it as a loose ref_audio
    // reference - ref_audio alone (still wired above, for MiniMax's own style/rhythm conditioning) reads more
    // as "sounds like this" than "say exactly this, exactly now": lip movement ended up desynced and on the
    // wrong words. MiniMaxH3AddGuide anchors audio (encoded through audio_vae) into the conditioning at a
    // frame - at frame_idx 0 with a track already trimmed to the full render length (see tracks above), that's
    // the whole clip, the stock-node equivalent of a third-party "audio drive" node.
    const vocalsIndex = opts.vocals !== undefined ? (opts.audios ?? []).indexOf(opts.vocals) : -1
    if (opts.vocals !== undefined && vocalsIndex < 0) throw new Error('h3-ref2video: opts.vocals is set but not found in opts.audios')
    // Confirmed live: the <Audio 1>/<Audio 2> reorder in lib/compose.ts (performance-driving track first, the
    // always-present drums track last) does most of the work on its own, but AddGuide still measurably
    // sharpens word-level precision (without it, an extra word leaked in at a clip's tail where the real audio
    // only has one) - keep both.
    const guided = vocalsIndex >= 0
        ? wf.MiniMaxH3AddGuide({positive: references.positive, latent: references.LATENT, frame_idx: 0, audio_vae: audioVae.VAE, audio: tracks[vocalsIndex]!.AUDIO})
        : undefined

    const guider = wf.BasicGuider({model: model.MODEL, conditioning: guided ? guided.positive : references.positive})
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
        audio: tracks[0]!.AUDIO,
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
