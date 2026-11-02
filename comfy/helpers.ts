import type {NodeRef} from "@saintno/comfyui-sdk";
import {existsSync} from "node:fs";
import {join} from "node:path";
import {FallbackWorkflowBuilder} from "./nodes-fallback.ts";
// @ts-ignore generated, gitignored and made from a server: without it the workflows are simply not type-checked
import type {WorkflowBuilder as GeneratedWorkflowBuilder} from "./nodes.ts";

const generated = join(import.meta.dir, 'nodes.ts')
export const WorkflowBuilder: typeof GeneratedWorkflowBuilder = existsSync(generated) ? (await import(generated)).WorkflowBuilder : FallbackWorkflowBuilder
export type WorkflowBuilder = GeneratedWorkflowBuilder
export {FPS} from "../lib/frames.ts";

/**
 * -1 keep the workflow's own resolution
 * 1.1        megapixels, 16:9 or 9:16 in multiples of 32 (as ComfyUI's ResolutionSelector) - computed here, see pixelSize
 * "1920x1088" fixed size
 */
export type Resolution = -1 | number | `${number}x${number}`
export type Orientation = 'portrait' | 'landscape'
/** An aspect ratio like "16:9", "9:16", "2:1" or "2:3" - width first. */
export type Aspect = `${number}:${number}`
/** "16:9" etc. as width and height; landscape is 16:9, portrait 9:16. */
export function aspectOf(shape: Orientation | Aspect): { w: number, h: number } {
    if (shape === 'landscape') return {w: 16, h: 9}
    if (shape === 'portrait') return {w: 9, h: 16}
    const [w, h] = shape.split(':').map(Number) as [number, number]
    return {w, h}
}

// hardware/model limit: MiniMax H3 accepts at most this many reference images
export const MAX_REFERENCE_IMAGES = 9
// model limit: MiniMaxH3ReferenceToVideo's ref_audios autogrow has max=3 slots, i.e. ref_audio_0..ref_audio_2
// (comfy_extras/nodes_minimax_h3.py) - a 4th track is rejected by the node ("unexpected keyword argument
// 'ref_audios.ref_audio_3'", seen live on clip slot-030)
export const MAX_REF_AUDIOS = 3

/** The audio tracks of a video workflow, checked against MAX_REF_AUDIOS before anything is built - the server only says so mid-render, after all uploads. */
export function refAudios(workflow: string, audios: string[] | undefined): string[] {
    const tracks = audios ?? []
    if (tracks.length > MAX_REF_AUDIOS) throw new Error(`${workflow}: ${tracks.length} audio tracks, MiniMaxH3ReferenceToVideo takes at most ${MAX_REF_AUDIOS} (ref_audio_0..ref_audio_${MAX_REF_AUDIOS - 1})`)
    return tracks
}

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
    // ComfyUI input name of a short video: the last frames of the clip before (config.contextFrames), all of them locked to
    // the start of this clip with MiniMaxH3AddGuide - the motion goes on, not only the pose. Instead of startFrame
    startClip?: string,
    songStart: number,          // seconds - exactly on the clip's first frame, for every track in `audios`
    frames: number,             // frames to render, already a length the model accepts (see renderFrames)
    duration: number,           // frames / FPS - the audio to trim, covering the whole render
    seed: number,
    resolution: Resolution,
    aspect?: Aspect,            // config videoAspect - "16:9" (landscape) when not given
    // a cheap render (--preview): a factor on the pixels (pass it to resolution()), and the sampling steps of a workflow with the
    // turbo LoRA. A two-pass workflow stops after its first pass. Without it a workflow renders as it always does
    preview?: PreviewOptions,
    // part of a clip rendered again (--retake): the render is also guided to this picture at this frame - the frame right after the part
    endFrame?: EndFrame,
    filenamePrefix: string,
}
export type PreviewOptions = { scale: number, steps: number }
export type EndFrame = { image: string, at: number }
export type VideoWorkflow = (opts: VideoWorkflowOptions) => WorkflowResult

/**
 * What a continuing clip starts on, as images for MiniMaxH3AddGuide at frame 0: the frames of opts.startClip (the last
 * frames of the clip before - the node places a batch of 5 + 17·k as consecutive frames) or the one picture opts.startFrame.
 */
export function endGuide<C extends NodeRef>(wf: WorkflowBuilder, positive: C, latent: NodeRef<"LATENT">, vae: NodeRef<"VAE">, endFrame: EndFrame | undefined): C {
    return endFrame ? wf.MiniMaxH3AddGuide({positive: positive as never, latent, frame_idx: endFrame.at, vae, image: wf.LoadImage({image: dyn(endFrame.image)}).IMAGE}).positive as unknown as C : positive
}

export function startImages(wf: WorkflowBuilder, opts: Pick<VideoWorkflowOptions, 'startFrame' | 'startClip'>): NodeRef<"IMAGE"> | undefined {
    if (opts.startClip) return wf.VHS_LoadVideo({video: dyn(opts.startClip), force_rate: 0, custom_width: 0, custom_height: 0, frame_load_cap: 0, skip_first_frames: 0, select_every_nth: 1}).IMAGE
    if (opts.startFrame) return wf.LoadImage({image: dyn(opts.startFrame)}).IMAGE
    return undefined
}

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

// More frames for a rendered clip (frame interpolation) - see lib/interpolate.ts. The clip is cut into its shots first: a
// piece never runs over a cut, so no frames are made between two shots.
export type InterpolationWorkflowOptions = {
    video: string,                              // ComfyUI input name of the rendered clip
    pieces: { start: number, frames: number }[], // the shots of the clip in its frames, back to back from frame 0
    model: string,                              // a file in ComfyUI's models/frame_interpolation/
    multiplier: number,                         // frames out per frame in - the output runs at FPS * multiplier
    filenamePrefix: string,
}
export type InterpolationWorkflow = (opts: InterpolationWorkflowOptions) => WorkflowResult

/**
 * Optional export of a video workflow: the frame count to render for a clip that needs `frames`.
 * Models that only accept some lengths round up here; the extra frames are cut off when the final
 * video is assembled. Without it, a clip is rendered with exactly the frames it needs.
 */
export type RenderFrames = (frames: number) => number
/** The lengths MiniMaxH3ReferenceToVideo renders, 5 + 17·k frames: a clip that needs `frames` is rendered at the next one up. */
export const h3RenderFrames: RenderFrames = frames => 5 + 17 * Math.ceil(Math.max(0, frames - 5) / 17)
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
    return (typeof setting === 'number' ? setting * MEGAPIXEL : pixels(setting)) > pixels(recommended)
}

// a megapixel as ComfyUI counts it - the one pixelSize renders with
const MEGAPIXEL = 1024 * 1024

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
 * another size is scaled in the final video. Megapixels as ComfyUI counts them (1 MP = 1024x1024) in the given shape
 * (landscape 16:9, portrait 9:16, or an aspect like "2:3"), in multiples of 32. A "WIDTHxHEIGHT" keeps its own ratio and is
 * turned to the shape's orientation, whatever way round it was written - a square shape keeps it as written.
 */
export function pixelSize(setting: Resolution, shape: Orientation | Aspect, workflowDefault: Exclude<Resolution, -1>): PixelSize {
    const value = setting === -1 ? workflowDefault : setting
    const {w, h} = aspectOf(shape)
    if (typeof value === 'number') {
        const scale = Math.sqrt(value * MEGAPIXEL / (w * h))
        return {width: roundHalfEven(w * scale / 32) * 32, height: roundHalfEven(h * scale / 32) * 32}
    }
    const [a, b] = value.split('x').map(Number) as [number, number]
    if (w === h) return {width: a, height: b}
    const [long, short] = a >= b ? [a, b] : [b, a]
    return w > h ? {width: long, height: short} : {width: short, height: long}
}

/** A size with `scale` times its pixels: each side by the square root of it, in multiples of 32. */
export function scaledSize(size: PixelSize, scale: number): PixelSize {
    if (scale === 1) return size
    const side = (n: number) => Math.max(32, Math.round(n * Math.sqrt(scale) / 32) * 32)
    return {width: side(size.width), height: side(size.height)}
}

/**
 * Width and height for a resolution setting - node outputs, typed to go straight into width/height widgets, and the
 * same size in pixels (`pixels`) for the workflow's result.
 */
export function resolution(workflow: WorkflowBuilder, setting: Resolution, shape: Orientation | Aspect, workflowDefault: Exclude<Resolution, -1>, scale = 1): { width: number, height: number, pixels: PixelSize } {
    const pixels = scaledSize(pixelSize(setting, shape, workflowDefault), scale)
    return {width: widget(workflow.PrimitiveInt({value: pixels.width}).INT), height: widget(workflow.PrimitiveInt({value: pixels.height}).INT), pixels}
}
