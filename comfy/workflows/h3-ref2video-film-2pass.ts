// The short-film pipeline's clips in two passes - the recipe of h3-ref2video-2pass (comfy/h3-two-pass.ts, the same code), with
// the film's inputs: pictures only, no audio goes in, and the sound is the model's own (dialogue and ambience from the prompt),
// decoded from the latent after pass 2. videoResolution is the final size (-1 = 2 MP, pass 1 at 0.5 MP).
// Select it with "videoWorkflow": "h3-ref2video-film-2pass" in the film's config.json.
import {FPS, withInputs, WorkflowBuilder, type WorkflowResult} from "../helpers.ts";
import {h3TwoPass} from "../h3-two-pass.ts";
import type {FilmVideoWorkflowOptions} from "./h3-ref2video-film.ts";

export {renderFrames} from "./h3-ref2video-film.ts"

export default function h3Ref2VideoFilm2Pass(opts: FilmVideoWorkflowOptions): WorkflowResult {
    const wf = new WorkflowBuilder()
    const {images, song: sound, size} = h3TwoPass(wf, opts, 'h3-ref2video-film-2pass')

    const video = wf.VHS_VideoCombine({
        images,
        audio: sound,
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
