// The base H3 model without the turbo LoRA: the slower, higher quality variant.
import {h3Ref2Video} from "./h3-ref2video-builder.ts";
import {h3RenderFrames, type VideoWorkflowOptions, type WorkflowResult} from "../helpers.ts";

export const renderFrames = h3RenderFrames

export default function h3Ref2VideoFull(opts: VideoWorkflowOptions): WorkflowResult {
    return h3Ref2Video(opts, {name: 'h3-ref2video-full', sampler: 'res_multistep', scheduler: 'simple', steps: o => ('steps' in o ? o.steps : undefined) ?? 20})
}
