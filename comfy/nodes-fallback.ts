import {WorkflowBuilder as BaseWorkflowBuilder} from "@saintno/comfyui-sdk";

// The nodes our workflows use with the names of their outputs, in output order - the part of the generated comfy/nodes.ts
// that matters when the workflows run. comfy/helpers.ts falls back to it when nodes.ts was not generated yet, which takes a
// ComfyUI server: without one, planning, --help and the tests still have to work. It checks nothing - only nodes.ts knows
// what a server has. comfy/nodes-fallback.test.ts keeps this list in step with the workflows and with nodes.ts.
export const FALLBACK_NODES: Record<string, string[]> = {
    BasicGuider: ['GUIDER'],
    BasicScheduler: ['SIGMAS'],
    BatchImagesNode: ['IMAGE'],
    CLIPLoader: ['CLIP'],
    CLIPTextEncode: ['CONDITIONING'],
    CheckpointLoaderSimple: ['MODEL', 'CLIP', 'VAE', 'NAME_STRING'],     // the last one only with a custom node of this name
    ConditioningAverage: ['CONDITIONING'],
    ConditioningZeroOut: ['CONDITIONING'],
    EmptyLatentImage: ['LATENT'],
    EmptyYuE2LatentAudio: ['LATENT'],
    FrameInterpolate: ['IMAGE'],
    FrameInterpolationModelLoader: ['INTERP_MODEL'],
    ImageFromBatch: ['IMAGE'],
    ImageScale: ['IMAGE'],
    ImageScaleBy: ['IMAGE'],
    ImageUpscaleWithModel: ['IMAGE'],
    KSampler: ['LATENT'],
    KSamplerSelect: ['SAMPLER'],
    LTXVConcatAVLatent: ['latent'],
    LTXVSeparateAVLatent: ['video_latent', 'audio_latent'],
    LoadAudio: ['AUDIO'],
    LoadImage: ['IMAGE', 'MASK'],
    LoraLoaderModelOnly: ['MODEL'],
    MiniMaxH3AddGuide: ['positive'],
    MiniMaxH3ImageToVideo: ['positive', 'LATENT'],
    MiniMaxH3ReferenceToVideo: ['positive', 'LATENT'],
    MiniMaxH3SigmaShift: ['MODEL'],
    MinimaxH3LatentUpscaler3D: ['latent'],
    ModelAttentionBackend: ['model'],
    PrimitiveInt: ['INT'],
    PrimitiveStringMultiline: ['STRING'],
    RandomNoise: ['NOISE'],
    RepeatImageBatch: ['IMAGE'],
    SamplerCustomAdvanced: ['output', 'denoised_output'],
    SaveAudioAdvanced: ['audio'],
    SaveImage: ['images'],
    SaveImageAdvanced: ['images'],
    SeedNode: ['seed'],
    TrimAudioDuration: ['AUDIO'],
    UNETLoader: ['MODEL'],
    UpscaleModelLoader: ['UPSCALE_MODEL'],
    VAEDecode: ['IMAGE'],
    VAEDecodeAudio: ['AUDIO'],
    VAEEncode: ['LATENT'],
    VAEEncodeTiled: ['LATENT'],
    VAELoader: ['VAE'],
    VHS_LoadVideo: ['IMAGE', 'frame_count', 'audio', 'video_info'],
    VHS_VideoCombine: ['Filenames'],
    VRAMCleanup: ['output'],
    YuE2GenerateABC: ['abc'],
    YuE2GenerateMusic: ['CONDITIONING', 'seconds'],
}

/** A WorkflowBuilder with one method per entry of FALLBACK_NODES - and a clear error for any other node a workflow asks for. */
export class FallbackWorkflowBuilder extends BaseWorkflowBuilder {
    constructor() {
        super()
        return new Proxy(this, {
            get: (target, name) => {
                const outputs = typeof name === 'string' ? FALLBACK_NODES[name] : undefined
                if (outputs) return (inputs: Record<string, unknown>) => {
                    const id = target.addNode(name as string, inputs)
                    return {...Object.fromEntries(outputs.map((output, index) => [output, target.makeRef(id, index)])), __id: id}
                }
                if (typeof name === 'string' && /^[A-Z]/.test(name)) throw new Error(`Node ${name}: not known without comfy/nodes.ts - generate it from your ComfyUI server: bun run comfy:types`)
                return Reflect.get(target, name, target)
            },
        })
    }
}
