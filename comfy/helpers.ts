import type {NodeRef} from "@saintno/comfyui-sdk";
import {WorkflowBuilder} from "./nodes.ts";

export {WorkflowBuilder}
export {FPS} from "../lib/frames.ts";

/**
 * -1 keep the workflow's own resolution
 * 1.1        megapixels, 16:9 or 9:16 in multiples of 32 (as ComfyUI's ResolutionSelector) - computed here, see pixelSize
 * "1920x1088" fixed size
 */
export type Resolution = -1 | number | `${number}x${number}`
export type Orientation = 'portrait' | 'landscape'

// hardware/model limit: MiniMax H3 accepts at most this many reference images
export const MAX_REFERENCE_IMAGES = 9
// model limit: MiniMaxH3ReferenceToVideo's ref_audios autogrow has max=3 slots, i.e. ref_audio_0..ref_audio_2
// (comfy_extras/nodes_minimax_h3.py) - a 4th track is rejected by the node ("unexpected keyword argument
// 'ref_audios.ref_audio_3'", seen live on clip slot-030)
export const MAX_REF_AUDIOS = 3

// The contract of a workflow file in comfy/workflows/ - see docs/custom-workflows.md.
// Its default export takes these options and returns the graph plus the node whose files are downloaded.
// size: what the output is rendered at, when the workflow knows it - lib/render.ts checks the file against it
export type WorkflowResult = { workflow: WorkflowBuilder, output: string, size?: PixelSize }
export type PixelSize = { width: number, height: number }

export type ImageWorkflowOptions = {
    prompt: string,
    seed: number,
    resolution: Resolution,
    orientation: Orientation,   // characters portrait, locations landscape
    filenamePrefix: string,     // where ComfyUI saves the result, e.g. "feverslop-ts/<project>/characters/thorin"
}
export type ImageWorkflow = (opts: ImageWorkflowOptions) => WorkflowResult

export type AudioWorkflowOptions = {
    style: string,               // musical style/genre/instrumentation caption
    lyrics: string,               // full lyrics with [Section] tags, sung words only
    seed: number,
    duration: number,             // seconds - an upper bound; the model decides the actual song length
    filenamePrefix: string,
}
export type AudioWorkflow = (opts: AudioWorkflowOptions) => WorkflowResult

export type VideoWorkflowOptions = {
    prompt: string,
    pictures: string[],         // ComfyUI input names in <Picture N> order, e.g. "feverslop-ts/<project>/assets/characters/thorin.png"
    // ComfyUI input name of the song's isolated vocals - only for clips with a singer, and only when there's a
    // vocals entry in `audios` (which of its entries is the vocals stem, given again here so the workflow can
    // offer it as a loose ref_audio labeled correctly).
    vocals?: string,
    // the ComfyUI input name of each track's *whole* separated stem file, in <Audio N> order (see
    // lib/compose.ts) - lib/render.ts uploads the full stem, and the workflow trims each one to this clip's
    // own span itself (TrimAudioDuration), the render length exactly.
    audios: string[],
    // ComfyUI input name of the whole, unseparated song - not one of the labeled <Audio N> references, only
    // locked into the AV latent via MiniMaxH3AddGuide so every instrument (not just the ones with their own
    // isolated track) has some real audio grounding behind its idle/active prompt text.
    song: string,
    // ComfyUI input name of the picture the video has to start on (a continuing clip's first frame, config.pinStartFrame):
    // locked to frame 0 with MiniMaxH3AddGuide instead of only being one of the loose reference pictures
    startFrame?: string,
    songStart: number,          // seconds - exactly on the clip's first frame, for every track in `audios`
    frames: number,             // frames to render, already a length the model accepts (see renderFrames)
    duration: number,           // frames / FPS - the audio to trim, covering the whole render
    seed: number,
    resolution: Resolution,     // always rendered landscape
    filenamePrefix: string,
}
export type VideoWorkflow = (opts: VideoWorkflowOptions) => WorkflowResult

// A short, silent turnaround video from one still image - the reference-sheet pipeline's video step (see
// lib/sequenceSheet.ts). Not a VideoWorkflow: no ref_images/audio, one first_frame image drives the whole clip.
export type SequenceWorkflowOptions = {
    prompt: string,
    startFrame: string,          // ComfyUI input name of the anchor/hero image (first_frame)
    frames: number,
    orientation: Orientation,    // characters portrait, locations landscape
    resolution: Resolution,
    seed: number,
    filenamePrefix: string,
}
export type SequenceWorkflow = (opts: SequenceWorkflowOptions) => WorkflowResult

/**
 * Optional export of a video workflow: the frame count to render for a clip that needs `frames`.
 * Models that only accept some lengths round up here; the extra frames are cut off when the final
 * video is assembled. Without it, a clip is rendered with exactly the frames it needs.
 */
export type RenderFrames = (frames: number) => number
/**
 * Optional export of a video workflow: the largest size its model is made for, landscape (a LoRA trained up to 768p). A larger
 * videoResolution is rendered as it is set - the run only says so, once (aboveRecommended).
 */
export type RecommendedResolution = `${number}x${number}`
export type VideoWorkflowModule = { default: VideoWorkflow, renderFrames?: RenderFrames, recommendedResolution?: RecommendedResolution }

/** Whether the setting asks for more pixels than the workflow's recommended size. -1 (the workflow's own size) never does. */
export function aboveRecommended(setting: Resolution, recommended: RecommendedResolution | undefined): boolean {
    if (!recommended || setting === -1) return false
    const pixels = (size: string) => size.split('x').map(Number).reduce((a, b) => a * b, 1)
    return (typeof setting === 'number' ? setting * 1e6 : pixels(setting)) > pixels(recommended)
}

/**
 * A value the server didn't list when nodes.ts was generated - an uploaded file, a model installed later.
 * Dropdowns are typed with the listed values only; this lets any value through, unchecked.
 */
export const dyn = (value: string | number) => value as never

/**
 * Connects a node output to a widget input, e.g. a PrimitiveInt into EmptyLatentImage's width.
 * ComfyUI allows that for every widget, the generated types only allow plain values there.
 */
export const widget = (ref: NodeRef) => ref as never

/**
 * Sets inputs the generated types can't express: autogrow slots like "ref_images.ref_image_0"
 * and widgets that only exist for some settings, like VHS_VideoCombine's crf. Unchecked.
 */
export function withInputs<N extends { __id: string }>(workflow: WorkflowBuilder, node: N, inputs: Record<string, unknown>): N {
    // The builder has no public way to change a node after it was added, and only hands out copies of its nodes -
    // so the inputs go into its private _nodes before build(). That field is not part of the SDK's API (package.json
    // keeps @saintno/comfyui-sdk on 0.3.x, where it exists): fail loudly if an SDK update ever renames it, instead of
    // silently sending a workflow without these inputs.
    const nodes = (workflow as unknown as { _nodes?: Record<string, { inputs?: Record<string, unknown> }> })._nodes
    const target = nodes?.[node.__id]?.inputs
    if (!target) throw new Error(`withInputs: cannot set ${Object.keys(inputs).join(', ')} on node ${node.__id} - the workflow builder of @saintno/comfyui-sdk no longer keeps its nodes in "_nodes" (SDK updated? see comfy/helpers.ts)`)
    Object.assign(target, inputs)
    return node
}

// VRAMCleanup passes anything through - keep the type of what goes in
export function afterCleanup<T extends NodeRef>(workflow: WorkflowBuilder, value: T, opts: { offload_model?: boolean, offload_cache?: boolean } = {}): T {
    return workflow.VRAMCleanup({offload_model: opts.offload_model ?? true, offload_cache: opts.offload_cache ?? true, anything: value}).output as T
}

export function resolveSeed(seed: number) {
    return seed === -1 ? Math.floor(Math.random() * 2 ** 48) : seed
}

// Python's round(): half to even - the same sizes as ComfyUI's ResolutionSelector, which pixelSize replaces
const roundHalfEven = (x: number) => Math.abs(x % 1) === 0.5 ? 2 * Math.round(x / 2) : Math.round(x)

/**
 * The size a resolution setting renders at, in pixels. Computed here and not by a ResolutionSelector node on the server: a
 * server with another ComfyUI version could compute another size, and every server has to deliver the same - a clip of
 * another size is scaled in the final video. Megapixels as ComfyUI counts them (1 MP = 1024x1024), 16:9 or 9:16, in
 * multiples of 32. The result always has the requested orientation, whatever way round the setting was written.
 */
export function pixelSize(setting: Resolution, orientation: Orientation, workflowDefault: Exclude<Resolution, -1>): PixelSize {
    const value = setting === -1 ? workflowDefault : setting
    let long: number, short: number
    if (typeof value === 'number') {
        const scale = Math.sqrt(value * 1024 * 1024 / (16 * 9))
        long = roundHalfEven(16 * scale / 32) * 32
        short = roundHalfEven(9 * scale / 32) * 32
    } else {
        const [a, b] = value.split('x').map(Number) as [number, number]
        ;[long, short] = a >= b ? [a, b] : [b, a]
    }
    return orientation === 'landscape' ? {width: long, height: short} : {width: short, height: long}
}

/**
 * Width and height for a resolution setting - node outputs, typed to go straight into width/height widgets, and the
 * same size in pixels (`pixels`) for the workflow's result.
 */
export function resolution(workflow: WorkflowBuilder, setting: Resolution, orientation: Orientation, workflowDefault: Exclude<Resolution, -1>): { width: number, height: number, pixels: PixelSize } {
    const pixels = pixelSize(setting, orientation, workflowDefault)
    return {width: widget(workflow.PrimitiveInt({value: pixels.width}).INT), height: widget(workflow.PrimitiveInt({value: pixels.height}).INT), pixels}
}
