import {cli} from '../lib/cli.ts';
// Gives rendered clips of a project more frames with ComfyUI's frame interpolation, to compare models before the final
// video uses it (issue #291): each clip is cut into its shots (never interpolated across a cut), every model given makes
// its own file in videos/interpolated/ - at FPS * multiplier, and a 60 fps copy with the song under it to watch.
// usage: bun run interpolate <project-id> --only=slot-018 --model=rife_v4.26_heavy.safetensors,film_net_fp16.safetensors
//        [--multiplier=5] [--comfy=http://host:8188]
import {existsSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {parseArgs} from "node:util";
import {loadProjectConfig} from "../lib/config.ts";
import {FPS, secondsAt} from "../lib/frames.ts";
import {log} from "../lib/log.ts";
import {runProcess} from "../lib/process.ts";
import {projectDir, projectExists} from "../lib/project-setup.ts";
import {Renderer} from "../lib/render.ts";
import {loadSettings} from "../lib/settings.ts";
cli('interpolate')


const usage = 'usage: bun run interpolate <project-id> --only=slot-001,... --model=<file in models/frame_interpolation>,... [--multiplier=5] [--comfy=http://host:8188]'
const {values: args, positionals: [id]} = parseArgs({
    args: Bun.argv.slice(2), allowPositionals: true,
    options: {only: {type: 'string', default: ''}, model: {type: 'string', default: ''}, multiplier: {type: 'string', default: '5'}, comfy: {type: 'string'}},
})
const only = args.only.split(',').filter(Boolean)
const models = args.model.split(',').filter(Boolean)
const multiplier = Number(args.multiplier)
if (!id || !projectExists(id) || !only.length || !models.length || !Number.isInteger(multiplier) || multiplier < 2) {
    log.error(`${usage}${id && !projectExists(id) ? `\nprojects/${id} does not exist` : ''}`)
    process.exit(1)
}
const dir = projectDir(id)
const config = await loadProjectConfig(dir)
const settings = await loadSettings({projectModel: config.llm.model, ...(args.comfy ? {comfy: args.comfy} : {})})
// the song as index.ts finds it: generated or supplied as input/song.wav, or supplied as input/song.mp3
const song = ['song.wav', 'song.mp3'].map(f => join(dir, 'input', f)).find(existsSync)

using renderer = new Renderer(id, dir, config, settings.comfy)
for (const clipId of only) {
    const requestFile = join(dir, 'output', 'clips', `${clipId}.json`)
    if (!existsSync(requestFile)) throw new Error(`${clipId}: no output/clips/${clipId}.json - plan the project first`)
    const clip = JSON.parse(readFileSync(requestFile, 'utf8')) as { id: string, frames: number, frameStart: number, shots?: { at: number }[] }
    for (const model of models) {
        const name = model.replace(/\.[^.]+$/, '')
        const target = join(dir, 'videos', 'interpolated', `${clipId}.${name}.mp4`)
        await renderer.renderInterpolation(clip, model, multiplier, target)
        // to watch: 60 fps (every other frame of x5), the song of the clip's span under it
        const watch = target.replace(/\.mp4$/, '.60fps.mp4')
        await runProcess(['ffmpeg', '-y', '-v', 'error', '-i', target,
            ...(song ? ['-ss', String(secondsAt(clip.frameStart)), '-t', String(secondsAt(clip.frames)), '-i', song, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '256k'] : []),
            '-vf', 'fps=60', '-c:v', 'libx264', '-crf', '17', '-pix_fmt', 'yuv420p', '-shortest', watch], {errorMessage: err => `ffmpeg failed on ${watch}:\n${err}`})
        log.step('Watch', `${watch.slice(dir.length + 1)} (60 fps, ${FPS * multiplier} fps source)`)
    }
}
