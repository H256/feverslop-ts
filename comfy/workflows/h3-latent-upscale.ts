// A finished clip made larger with the latent upscaler of comfy/h3-two-pass.ts alone: encoded, upscaled, decoded. Nothing is sampled, so no text encoder, no
// model and no pictures are needed. Faster than h3-refine, but the upscaler is made to be sampled after: alone it leaves over-sharpened skin and frayed edges. No sound: the clip keeps the one it has (lib/refinish.ts).
import {dyn, FPS, type PixelSize, withInputs, WorkflowBuilder, type WorkflowResult} from '../helpers.ts'
import type {NodeRef} from '@saintno/comfyui-sdk'

export type LatentUpscaleOptions = {
    video: string // ComfyUI input name of the clip
    size: PixelSize
    filenamePrefix: string
}

export default function h3LatentUpscale(opts: LatentUpscaleOptions): WorkflowResult {
    const wf = new WorkflowBuilder()
    const vae = wf.VAELoader({vae_name: 'minimax_h3_video_vae_fp16.safetensors'})
    const frames = wf.VHS_LoadVideo({
        video: dyn(opts.video),
        force_rate: 0,
        custom_width: 0,
        custom_height: 0,
        frame_load_cap: 0,
        skip_first_frames: 0,
        select_every_nth: 1,
    }).IMAGE
    const encoded = wf.VAEEncodeTiled({pixels: frames, vae: vae.VAE, tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 8})
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
    const images = wf.VAEDecode({samples: upscaled.latent as NodeRef<'LATENT'>, vae: vae.VAE}).IMAGE
    const video = wf.VHS_VideoCombine({
        images,
        frame_rate: FPS,
        loop_count: 0,
        filename_prefix: opts.filenamePrefix,
        format: 'video/h264-mp4',
        pingpong: false,
        save_output: true,
    })
    withInputs(wf, video, {pix_fmt: 'yuv420p', crf: 17, save_metadata: true, trim_to_audio: false})
    return {workflow: wf, output: video.__id, size: opts.size}
}
