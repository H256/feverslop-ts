import type {NodeRef} from "@saintno/comfyui-sdk";
import {WorkflowBuilder} from "./nodes.ts";

export {WorkflowBuilder}
export {FPS} from "../lib/frames.ts";

/**
 * -1         keep the workflow's own resolution
 * 1.1        megapixels, through a ResolutionSelector node
 * "1920x1088" fixed size, through two PrimitiveInt nodes
 */
export type Resolution = -1 | number | `${number}x${number}`
export type Orientation = 'portrait' | 'landscape'

// The contract of a workflow file in comfy/workflows/ - see docs/custom-workflows.md.
// Its default export takes these options and returns the graph plus the node whose files are downloaded.
export type WorkflowResult = { workflow: WorkflowBuilder, output: string }

export type ImageWorkflowOptions = {
    prompt: string,
    seed: number,
    resolution: Resolution,
    orientation: Orientation,   // characters portrait, locations landscape
    filenamePrefix: string,     // where ComfyUI saves the result, e.g. "feverslop-ts/<project>/characters/thorin"
}
export type ImageWorkflow = (opts: ImageWorkflowOptions) => WorkflowResult

export type VideoWorkflowOptions = {
    prompt: string,
    pictures: string[],         // ComfyUI input names in <Picture N> order, e.g. "feverslop-ts/<project>/assets/characters/thorin.png"
    song: string,               // ComfyUI input name of the full song
    vocals?: string,            // ComfyUI input name of the song's isolated vocals (<Audio 2>) - only for clips with a singer
    songStart: number,          // seconds - exactly on the clip's first frame, for the song and the vocals
    frames: number,             // frames to render, already a length the model accepts (see renderFrames)
    duration: number,           // frames / FPS - the audio to trim, covering the whole render
    seed: number,
    resolution: Resolution,     // always rendered landscape
    filenamePrefix: string,
}
export type VideoWorkflow = (opts: VideoWorkflowOptions) => WorkflowResult

/**
 * Optional export of a video workflow: the frame count to render for a clip that needs `frames`.
 * Models that only accept some lengths round up here; the extra frames are cut off when the final
 * video is assembled. Without it, a clip is rendered with exactly the frames it needs.
 */
export type RenderFrames = (frames: number) => number
export type VideoWorkflowModule = { default: VideoWorkflow, renderFrames?: RenderFrames }

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
    // the builder only hands out copies of its nodes - the inputs have to go in before build()
    const nodes = (workflow as unknown as { _nodes: Record<string, { inputs: Record<string, unknown> }> })._nodes
    Object.assign(nodes[node.__id]!.inputs, inputs)
    return node
}

// VRAMCleanup passes anything through - keep the type of what goes in
export function afterCleanup<T extends NodeRef>(workflow: WorkflowBuilder, value: T, opts: { offload_model?: boolean, offload_cache?: boolean } = {}): T {
    return workflow.VRAMCleanup({offload_model: opts.offload_model ?? true, offload_cache: opts.offload_cache ?? true, anything: value}).output as T
}

export function resolveSeed(seed: number) {
    return seed === -1 ? Math.floor(Math.random() * 2 ** 48) : seed
}

/**
 * Width and height for a resolution setting - node outputs, typed to go straight into width/height widgets.
 * The result always has the requested orientation, whatever way round the setting was written.
 */
export function resolution(workflow: WorkflowBuilder, setting: Resolution, orientation: Orientation, workflowDefault: Exclude<Resolution, -1>): { width: number, height: number } {
    const value = setting === -1 ? workflowDefault : setting

    if (typeof value === 'number') {
        const selector = workflow.ResolutionSelector({
            aspect_ratio: orientation === 'portrait' ? '9:16 (Portrait Widescreen)' : '16:9 (Widescreen)',
            megapixels: value,
            multiple: 32,
        })
        return {width: widget(selector.width), height: widget(selector.height)}
    }

    const [a, b] = value.split('x').map(Number) as [number, number]
    const [long, short] = a >= b ? [a, b] : [b, a]
    const [width, height] = orientation === 'landscape' ? [long, short] : [short, long]
    return {width: widget(workflow.PrimitiveInt({value: width}).INT), height: widget(workflow.PrimitiveInt({value: height}).INT)}
}
