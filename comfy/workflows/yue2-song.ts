// Rebuilt from comfy/audio_yue2_text2music.json - simplified: the ABC-planning toggle and its preview nodes are
// dropped (ABC planning is always on, "mode": "full"), style/lyrics/seed are wired to opts directly instead of
// through primitive nodes.
import {type AudioWorkflowOptions, dyn, widget, withInputs, WorkflowBuilder, type WorkflowResult} from "../helpers.ts";

export default function yue2Song(opts: AudioWorkflowOptions): WorkflowResult {
    const wf = new WorkflowBuilder()

    const model = wf.CheckpointLoaderSimple({ckpt_name: 'yue2_3b_int8_convrot.safetensors'})

    // plans the melody/harmony in ABC notation first - keeps the generated song coherent
    const abc = wf.YuE2GenerateABC({
        clip: model.CLIP,
        style: opts.style,
        lyrics: opts.lyrics,
        seed: opts.seed,
        mode: 'full',
        max_abc_tokens: 8192,
        temperature: 0.7,
        top_p: 0.9,
        top_k: 30,
        repetition_penalty: 1.005,
        penalty_window: 100,
    })

    // max_duration only caps the length - the model decides the actual song length (music.seconds)
    const music = wf.YuE2GenerateMusic({
        clip: model.CLIP,
        style: opts.style,
        lyrics: opts.lyrics,
        abc: widget(abc.abc),
        seed: opts.seed,
        mode: 'full',
        max_duration: opts.duration,
        temperature: 1,
        top_p: 0.95,
        top_k: 100,
        repetition_penalty: 1.2,
    })
    const negative = wf.ConditioningZeroOut({conditioning: music.CONDITIONING})
    const latent = wf.EmptyYuE2LatentAudio({seconds: widget(music.seconds), batch_size: 1})

    const sampled = wf.KSampler({
        seed: opts.seed,
        steps: 32,
        cfg: 1,
        sampler_name: 'dpm_2',
        scheduler: 'sgm_uniform',
        denoise: 1,
        model: model.MODEL,
        positive: music.CONDITIONING,
        negative: negative.CONDITIONING,
        latent_image: latent.LATENT,
    })
    const decoded = wf.VAEDecodeAudio({samples: sampled.LATENT, vae: model.VAE})

    // "format.quality" only exists as a widget once "format" is mp3 - ComfyUI's dynamic combo flattens it into
    // this dotted input name, which the generated types don't know about
    const save = wf.SaveAudioAdvanced({audio: decoded.AUDIO, filename_prefix: opts.filenamePrefix, format: dyn('mp3')})
    withInputs(wf, save, {'format.quality': 'V0'})

    return {workflow: wf, output: save.__id}
}
