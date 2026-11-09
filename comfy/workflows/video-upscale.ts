// A finished clip made larger with an upscale model, frame by frame, then brought to the size asked for. No sound: the clip keeps the one it has (lib/refinish.ts).
import {dyn, FPS, type PixelSize, withInputs, WorkflowBuilder, type WorkflowResult} from '../helpers.ts'

export type VideoUpscaleOptions = {
    video: string // ComfyUI input name of the clip
    model: string // a file in ComfyUI's models/upscale_models/
    size: PixelSize
    filenamePrefix: string
}

export default function videoUpscale(opts: VideoUpscaleOptions): WorkflowResult {
    const wf = new WorkflowBuilder()
    const frames = wf.VHS_LoadVideo({
        video: dyn(opts.video),
        force_rate: 0,
        custom_width: 0,
        custom_height: 0,
        frame_load_cap: 0,
        skip_first_frames: 0,
        select_every_nth: 1,
    }).IMAGE
    const larger = wf.ImageUpscaleWithModel({upscale_model: wf.UpscaleModelLoader({model_name: dyn(opts.model)}).UPSCALE_MODEL, image: frames}).IMAGE
    const sized = wf.ImageScale({image: larger, upscale_method: 'lanczos', width: opts.size.width, height: opts.size.height, crop: 'disabled'}).IMAGE
    const video = wf.VHS_VideoCombine({
        images: sized,
        frame_rate: FPS,
        loop_count: 0,
        filename_prefix: opts.filenamePrefix,
        format: 'video/h264-mp4',
        pingpong: false,
        save_output: true,
    })
    withInputs(wf, video, {pix_fmt: 'yuv420p', crf: 17, save_metadata: true, trim_to_audio: false})
    return {workflow: wf, output: video.__id, size: opts.size}
}
