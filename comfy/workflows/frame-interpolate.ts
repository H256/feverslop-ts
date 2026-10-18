// More frames for a rendered clip with ComfyUI's own frame interpolation (RIFE 4.25/4.26 or FILM, whichever model file is
// given) - the same nodes on every server, so every server gives the same result. Each shot of the clip is interpolated on
// its own: a piece of n frames gives (n - 1) * multiplier + 1 frames, and its last frame is held for the multiplier - 1
// frames up to the next shot, so the clip keeps its length exactly (n * multiplier frames) and nothing is made between two
// shots. Silent - the song goes under the final video as it is.
import {dyn, FPS, type InterpolationWorkflowOptions, withInputs, WorkflowBuilder, type WorkflowResult} from "../helpers.ts";

export default function frameInterpolate(opts: InterpolationWorkflowOptions): WorkflowResult {
    const wf = new WorkflowBuilder()
    if (!opts.pieces.length) throw new Error('frame-interpolate: no pieces - a clip has at least one shot')

    const clip = wf.VHS_LoadVideo({video: dyn(opts.video), force_rate: 0, custom_width: 0, custom_height: 0, frame_load_cap: 0, skip_first_frames: 0, select_every_nth: 1})
    const model = wf.FrameInterpolationModelLoader({model_name: opts.model})

    // per piece: its interpolated frames, then its last frame held up to the cut - all in one batch, in order (autogrow
    // slots images.image0, images.image1, ... of BatchImagesNode; ImageBatch with two inputs is deprecated)
    if (opts.pieces.length > 25) throw new Error(`frame-interpolate: ${opts.pieces.length} pieces - BatchImagesNode takes 50 inputs, two per piece`)
    const parts = opts.pieces.flatMap(({start, frames}) => {
        const shot = wf.ImageFromBatch({image: clip.IMAGE, batch_index: start, length: frames}).IMAGE
        const more = wf.FrameInterpolate({interp_model: model.INTERP_MODEL, images: shot, multiplier: opts.multiplier}).IMAGE
        const last = wf.ImageFromBatch({image: shot, batch_index: frames - 1, length: 1}).IMAGE
        return [more, wf.RepeatImageBatch({image: last, amount: opts.multiplier - 1}).IMAGE]
    })
    const all = withInputs(wf, wf.BatchImagesNode({} as never), Object.fromEntries(parts.map((part, i) => [`images.image${i}`, part])))

    const video = wf.VHS_VideoCombine({
        images: all.IMAGE,
        frame_rate: FPS * opts.multiplier,
        loop_count: 0,
        filename_prefix: opts.filenamePrefix,
        format: 'video/h264-mp4',
        pingpong: false,
        save_output: true,
    })
    // widgets VHS only adds for the h264 format
    withInputs(wf, video, {pix_fmt: 'yuv420p', crf: 17, save_metadata: true, trim_to_audio: false})

    return {workflow: wf, output: video.__id}
}
