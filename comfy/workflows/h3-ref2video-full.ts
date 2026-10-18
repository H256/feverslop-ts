// h3-ref2video without the turbo LoRA: the base model as in ComfyUI's own template video_minimax_h3_r2v (its non-turbo
// branch) - res_multistep, simple, 20 steps, no CFG (BasicGuider) and no sigma shift. About 2.5x the sampling time of the
// 8-step turbo, for more detail, prompt adherence and motion - a person far from the camera has a face here.
// Everything else (references, audio tracks, the song guide, the pinned first frame) is the same as h3-ref2video.
import {afterCleanup, dyn, FPS, MAX_REFERENCE_IMAGES, type RenderFrames, resolution, type VideoWorkflowOptions, widget, withInputs, WorkflowBuilder, type WorkflowResult} from "../helpers.ts";

// MiniMaxH3ReferenceToVideo only renders 5 + 17·k frames - round up, the rest is cut off in the final video
export const renderFrames: RenderFrames = frames => 5 + 17 * Math.ceil(Math.max(0, frames - 5) / 17)


export default function h3Ref2VideoFull(opts: VideoWorkflowOptions): WorkflowResult {
    const wf = new WorkflowBuilder()

    const videoVae = wf.VAELoader({vae_name: 'minimax_h3_video_vae_fp16.safetensors'})
    const audioVae = wf.VAELoader({vae_name: 'minimax_h3_audio_vae_fp32.safetensors'})
    const unet = wf.UNETLoader({unet_name: 'minimax_h3_ref2va_pruned_int8_convrot.safetensors', weight_dtype: 'default'})
    const clip = wf.CLIPLoader({clip_name: 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors', type: 'minimax', device: 'default'})

    // Multi-track audio: one <Audio N> per stem actually audible on screen (see lib/compose.ts). opts.audios
    // names the *whole* stem file for each track (lib/render.ts uploads the full separated stem, not a
    // per-clip cut) - every track covers the same span, this clip's full length, so all of them trim with the
    // same start/duration. Not clip.frames: MiniMaxH3ReferenceToVideo only accepts a few frame counts and
    // rounds up (see renderFrames below) - the ref_audio has to cover the length actually rendered, or the
    // model runs out of audio before the video ends.
    const tracks = (opts.audios ?? []).map(name => wf.TrimAudioDuration({
        audio: wf.LoadAudio({audio: dyn(name)}).AUDIO,
        start_index: opts.songStart,
        duration: opts.duration,
    }))
    if (!tracks.length) throw new Error('h3-ref2video-full: opts.audios is empty - lib/render.ts should always provide at least the drums track')

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
    // autogrow slots: ref_images.ref_image_0 = <Picture 1>, ..., ref_audios.ref_audio_0 = <Audio 1>, ...
    withInputs(wf, references, {
        ...Object.fromEntries(opts.pictures.slice(0, MAX_REFERENCE_IMAGES).map((picture, i) =>
            [`ref_images.ref_image_${i}`, wf.LoadImage({image: dyn(picture)}).IMAGE])),
        ...Object.fromEntries(tracks.map((track, i) => [`ref_audios.ref_audio_${i}`, track.AUDIO])),
    })
    // Lock the whole, real song into the video's own AV latent instead of only offering isolated stems as loose
    // ref_audio references - ref_audio alone reads more as "sounds like this" than "this is exactly what's
    // playing, exactly now", and an instrument with no ref_audio track of its own (not active anywhere in this
    // clip) had no audio grounding at all behind its idle prompt text, which read as more instruments audibly
    // playing than the prompt said should. MiniMaxH3AddGuide anchors audio (encoded through audio_vae) into
    // the conditioning at a frame - at frame_idx 0 with a track trimmed to the full render length, that's the
    // whole clip, the stock-node equivalent of a third-party "audio drive" node.
    // Earlier version of this locked the vocals track alone instead (sharper word-level lip precision, but
    // regressed instrument grounding across a full-song render) - the full mix still carries the vocals within
    // it, just mixed with everything else, so lip precision may be a little softer than the vocals-only lock.
    const song = wf.TrimAudioDuration({audio: wf.LoadAudio({audio: dyn(opts.song)}).AUDIO, start_index: opts.songStart, duration: opts.duration})
    const guided = wf.MiniMaxH3AddGuide({positive: references.positive, latent: references.LATENT, frame_idx: 0, audio_vae: audioVae.VAE, audio: song.AUDIO})

    // A continuing clip's first frame (opts.startFrame) is a ref image like any other above - references only carry
    // identity and place, the pose and framing of the last frame of the clip before get lost. The same node that locks
    // the audio at frame 0 takes an image: that one is the clip's actual first frame.
    const pinned = opts.startFrame
        ? wf.MiniMaxH3AddGuide({positive: guided.positive, latent: references.LATENT, frame_idx: 0, vae: videoVae.VAE, image: wf.LoadImage({image: dyn(opts.startFrame)}).IMAGE})
        : guided

    // int8 attention through comfy-kitchen: ~25% faster sampling on the Radeon. Only the guider gets it - the scheduler just needs the sigma schedule
    const attention = wf.ModelAttentionBackend({model: unet.MODEL, attention: 'comfy kitchen attention'})
    const guider = wf.BasicGuider({model: attention.model, conditioning: pinned.positive})
    const noise = wf.RandomNoise({noise_seed: opts.seed})
    const sampler = wf.KSamplerSelect({sampler_name: 'res_multistep'})
    const sigmas = wf.BasicScheduler({scheduler: 'simple', steps: 20, denoise: 1, model: unet.MODEL})
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
        audio: song.AUDIO,
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
