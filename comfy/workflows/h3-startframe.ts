// The start picture of a shot (#1187): MiniMax H3-Image with the clip's reference pictures as <Picture 1>, <Picture 2>, ...
// (MiniMaxH3ImageConditioning, the same checkpoint as text-to-image - an edit is only the pictures going in), 6 steps
// euler/simple at cfg 1 like h3-image, no prompt enhancer.
//
// The text encoder (32B, int8 about 27 GB) runs on the CPU, as in h3-refine: on the 32 GB Radeon it fills the card alone, and a
// start picture with seven reference pictures ran out of memory inside it (Qwen3-VL MLP, 29.6 GB allocated) - every picture costs
// the same there, ComfyUI scales each to a 1024 px short edge for the vision side.
//
// The text encoder is unloaded before the DiT samples: on the 32 GB Radeon the two together ran out of memory, and on a
// 32 GB 5090 that is also the desktop's card sampling hung at step 0 for more than ten minutes with 5 GB of the encoder left
// loaded. With VRAMCleanup in between a picture took 144 s (5090) and 330-390 s (Radeon), with six reference pictures.
import {afterCleanup, dyn, type StartFrameWorkflowOptions, WorkflowBuilder, type WorkflowResult, withInputs} from '../helpers.ts'

export default function h3StartFrame(opts: StartFrameWorkflowOptions): WorkflowResult {
    const wf = new WorkflowBuilder()

    const model = wf.UNETLoader({unet_name: 'minimax_h3_image_pruned_int8_convrot.safetensors', weight_dtype: 'default'})
    const clip = wf.CLIPLoader({clip_name: 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors', type: 'minimax', device: 'cpu'})
    const vae = wf.VAELoader({vae_name: 'minimax_h3_image_vae_fp16.safetensors'})

    // with the VAE the pictures are also anchored as reference latents, not only read by the text encoder
    const conditioning = wf.MiniMaxH3ImageConditioning({prompt: opts.prompt, width: opts.size.width, height: opts.size.height, clip: clip.CLIP, vae: vae.VAE})
    withInputs(wf, conditioning, Object.fromEntries(opts.pictures.map((picture, i) => [`images.image_${i + 1}`, wf.LoadImage({image: dyn(picture)}).IMAGE])))
    const positive = afterCleanup(wf, conditioning.positive)
    const negative = wf.ConditioningZeroOut({conditioning: positive})

    const sampled = wf.KSampler({
        seed: opts.seed,
        steps: 6,
        cfg: 1,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1,
        model: model.MODEL,
        positive,
        negative: negative.CONDITIONING,
        latent_image: conditioning.LATENT,
    })
    const decoded = wf.VAEDecode({samples: sampled.LATENT, vae: vae.VAE})
    const save = wf.SaveImage({filename_prefix: opts.filenamePrefix, images: afterCleanup(wf, decoded.IMAGE)})

    return {workflow: wf, output: save.__id, size: opts.size}
}
