// h3-ref2video in two passes (issue #288): pass 1 with the base model at a quarter of the final pixels, the latent x2,
// pass 2 a short refine with the base model at the final size - see comfy/h3-two-pass.ts. videoResolution is the final size
// (-1 = 2 MP, pass 1 at 0.5 MP). Nothing after pass 2: the video is rendered at the size it is saved at.
import {FPS, type RenderFrames, type VideoWorkflowOptions, withInputs, WorkflowBuilder, type WorkflowResult} from "../helpers.ts";
import {h3TwoPass} from "../h3-two-pass.ts";

// MiniMaxH3ReferenceToVideo only renders 5 + 17·k frames - round up, the rest is cut off in the final video
export const renderFrames: RenderFrames = frames => 5 + 17 * Math.ceil(Math.max(0, frames - 5) / 17)

export default function h3Ref2Video2Pass(opts: VideoWorkflowOptions): WorkflowResult {
    const wf = new WorkflowBuilder()
    const {images, song, size} = h3TwoPass(wf, opts, 'h3-ref2video-2pass')

    const video = wf.VHS_VideoCombine({
        images,
        audio: song,
        frame_rate: FPS,
        loop_count: 0,
        filename_prefix: opts.filenamePrefix,
        format: 'video/h264-mp4',
        pingpong: false,
        save_output: true,
    })
    // widgets VHS only adds for the h264 format
    withInputs(wf, video, {pix_fmt: 'yuv420p', crf: 19, save_metadata: true, trim_to_audio: false})

    return {workflow: wf, output: video.__id, size}
}
