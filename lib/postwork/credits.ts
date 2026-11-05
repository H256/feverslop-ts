import {existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, isAbsolute, join, relative, resolve} from "node:path";
import {probeVideo} from "../assemble.ts";
import {workflowDir} from "../config.ts";
import {readTimings, type Timing} from "../timings.ts";
import type {CreditsSettings} from "./config.ts";
import {encode, postworkName, VIDEO_ENCODE} from "./video.ts";

// A title card before a finished video and scrolling credits after it (#609). What the credits say of how the video was
// made is collected by code from what the project has on disk and what was measured while it was rendered - the
// language model, the workflows and their models, the graphics cards. Nothing is asked of a model and nothing is guessed:
// a fact that is not known is left out. Drawn with ffmpeg's drawtext in a font of the repo (assets/fonts/), one line per
// filter, so every line is centred on its own and no text needs escaping (each is read from a file).

const ROOT = join(import.meta.dir, '..', '..')
const FONTS = join(ROOT, 'assets', 'fonts')

/** What the credits know of how the video was made. */
export type CreditFacts = {
    llm: string[],                              // the language models the plan was written with
    models: { what: string, names: string[] }[], // per kind of render: the models of the workflows it ran
    gpus: string[],                             // the graphics cards it rendered on
    software: string,
}

/** One line of a card or of the credits; an empty text is a gap. */
export type CreditLine = { text: string, size: 'title' | 'large' | 'normal' | 'small' }

// what a workflow file names as a model: the diffusion model, the checkpoint, a LoRA, the text encoder
const MODEL_FIELDS = /\b(?:unet_name|ckpt_name|lora_name|clip_name\d?)\s*:\s*'([^']+)'/g

/** The models a workflow of comfy/workflows/ loads, by their file names without the ending - only those it names literally. */
export function workflowModels(source: string): string[] {
    return [...new Set([...source.matchAll(MODEL_FIELDS)].map(m => m[1]!.replace(/\.(safetensors|gguf|ckpt|pt|pth|bin)$/i, '')))]
}

const KINDS: Record<string, string> = {clip: 'Video', picture: 'Pictures', song: 'Song', interpolation: 'Frame interpolation'}
// the order the credits name them in
const KIND_ORDER = ['Video', 'Pictures', 'Reference sheets', 'Song', 'Frame interpolation', 'Upscaling']

/** The kind of render a sidecar file (<media>.json with its "workflow") belongs to, by where the media lies. */
function kindOfSidecar(dir: string, file: string): string | undefined {
    const path = relative(dir, file).replace(/\\/g, '/')
    if (/\.wav\.json$/.test(path)) return 'Song'
    if (/\.png\.json$/.test(path)) return 'Pictures'
    if (/^videos\/refined\//.test(path)) return 'Upscaling'
    if (/^videos\/interpolated\//.test(path)) return 'Frame interpolation'
    if (/^videos\/[^/]+\.mp4\.json$/.test(path)) return 'Video'
    if (/\.mp4\.json$/.test(path)) return 'Reference sheets'
    return undefined
}

/** The sidecars of the media of a project: every <file>.json next to a picture, clip or song. Old versions and logs are left out. */
function sidecars(dir: string): { kind: string, workflow?: string, model?: string }[] {
    const found: { kind: string, workflow?: string, model?: string }[] = []
    const walk = (folder: string) => {
        for (const entry of readdirSync(folder, {withFileTypes: true})) {
            const path = join(folder, entry.name)
            if (entry.isDirectory()) {
                if (!['old', 'logs', 'previews', 'node_modules'].includes(entry.name)) walk(path)
                continue
            }
            const kind = kindOfSidecar(dir, path)
            if (!kind) continue
            try {
                const data = JSON.parse(readFileSync(path, 'utf8')) as { workflow?: unknown, model?: unknown }
                found.push({kind, ...(typeof data.workflow === 'string' ? {workflow: data.workflow} : {}), ...(typeof data.model === 'string' ? {model: data.model} : {})})
            } catch {
                // not a sidecar of ours
            }
        }
    }
    if (existsSync(dir)) walk(dir)
    return found
}

/** "Radeon AI PRO R9700 (32 GB)" from what a timing says of where it ran. */
const gpuOf = (t: Pick<Timing, 'gpu' | 'vramGb'>) => t.gpu ? `${t.gpu.replace(/^cuda:\d+\s*/, '').replace(/\s*:\s*\w+$/, '')}${t.vramGb ? ` (${Math.round(t.vramGb)} GB)` : ''}` : undefined

/** The kind of render a timing belongs to - a reference sheet is measured as a picture, but runs a video model. */
const kindOfTiming = (t: Pick<Timing, 'kind' | 'name'>) => t.kind === 'picture' && /sequence|sheet/.test(t.name) ? 'Reference sheets' : KINDS[t.kind]

// what a graph records as its models (lib/graph.ts): "unet_name=file" - the VAE is no model anyone asks about
const shownModel = (entry: string) => {
    const [key, file] = entry.includes('=') ? entry.split('=', 2) as [string, string] : ['', entry]
    return key === 'vae_name' ? undefined : file.replace(/\.(safetensors|gguf|ckpt|pt|pth|bin|sft)$/i, '')
}

/**
 * The facts of a project: from the measurements of its renders and LLM calls (the timings file - what really ran, with
 * which models, and where) and, for what was not measured, from the sidecars of its media and the model names its
 * workflows have in them. `fallbackLlm`: the model of the settings, for a project whose calls were not measured.
 */
export function collectFacts(dir: string, opts: { timings?: Timing[], version: string, fallbackLlm?: string }): CreditFacts {
    const project = basename(dir)
    const mine = (opts.timings ?? readTimings()).filter(t => t.project === project && t.outcome !== 'failed')
    const llm = [...new Set(mine.filter(t => t.kind === 'llm').map(t => t.name))]
    const workflows = new Map<string, Set<string>>()
    const add = (what: string, workflow?: string, model?: string) => {
        const set = workflows.get(what) ?? new Set<string>()
        if (workflow) set.add(`workflow:${workflow}`)
        if (model) set.add(`model:${model}`)
        workflows.set(what, set)
    }
    // what the graphs of the renders loaded: exact, for whatever was measured
    const measured = new Map<string, Set<string>>()
    for (const t of mine) {
        const what = t.kind !== 'llm' ? kindOfTiming(t) : undefined
        if (!what) continue
        add(what, t.name)
        const names = measured.get(what) ?? new Set<string>()
        for (const model of t.setup?.models ?? []) {
            const shown = shownModel(model)
            if (shown) names.add(shown)
        }
        for (const lora of t.setup?.loras ?? []) names.add(lora.file.replace(/\.(safetensors|pt|ckpt)$/i, ''))
        if (names.size) measured.set(what, names)
    }
    for (const s of sidecars(dir)) add(s.kind, s.workflow, s.model)
    const models = KIND_ORDER.flatMap(what => {
        const names = new Set<string>(measured.get(what) ?? [])
        // not measured: the model names the workflow files have in them, as far as they name them literally
        if (!names.size) for (const entry of workflows.get(what) ?? []) {
            if (entry.startsWith('model:')) names.add(entry.slice(6).replace(/\.(safetensors|pth|pt|ckpt)$/i, ''))
            const file = join(workflowDir, `${entry.slice(9)}.ts`)
            if (entry.startsWith('workflow:') && existsSync(file)) for (const name of workflowModels(readFileSync(file, 'utf8'))) names.add(name)
        }
        return names.size ? [{what, names: [...names]}] : []
    })
    const gpus = [...new Set(mine.filter(t => t.kind !== 'llm').map(gpuOf).filter((g): g is string => !!g))]
    return {
        llm: llm.length ? llm : opts.fallbackLlm ? [opts.fallbackLlm] : [],
        models, gpus,
        software: `FeverSlop TS ${opts.version} · ComfyUI · ffmpeg`,
    }
}

/** What the title card and the credits say, line by line. */
export function creditLines(c: CreditsSettings, facts: CreditFacts | undefined, project: { title: string, kind: 'music' | 'film' }): { opening: CreditLine[], end: CreditLine[] } {
    const who = project.kind === 'film'
        ? c.director && `${c.directorLabel} ${c.director}`.trim()
        : c.artist && `${c.artistLabel} ${c.artist}`.trim()
    const gap: CreditLine = {text: '', size: 'normal'}
    // the disclosure at the first sight of the work, as the code of practice asks of an artistic one
    const opening: CreditLine[] = [
        {text: project.title, size: 'title'},
        ...(who ? [{text: who, size: 'large' as const}] : []),
        ...(c.disclosure ? [gap, {text: c.disclosure, size: 'small' as const}] : []),
    ]
    const section = (heading: string, lines: string[]): CreditLine[] => lines.length ? [gap, {text: heading, size: 'small'}, ...lines.map(text => ({text, size: 'normal' as const}))] : []
    const end: CreditLine[] = [
        {text: project.title, size: 'title'},
        ...(who ? [{text: who, size: 'large' as const}] : []),
        ...(c.extra.length ? [gap, ...c.extra.map(text => ({text, size: 'normal' as const}))] : []),
        ...(facts && c.facts ? [
            ...section(facts.llm.length > 1 ? 'Language models' : 'Language model', facts.llm),
            ...facts.models.flatMap(m => section(m.what, m.names)),
            ...section('Hardware', [...facts.gpus, ...(c.hardware ? [c.hardware] : [])]),
            ...section('Made with', [facts.software]),
        ] : c.hardware ? section('Hardware', [c.hardware]) : []),
        ...(c.disclosure ? [gap, gap, {text: c.disclosure, size: 'small' as const}] : []),
    ]
    return {opening, end}
}

/** The seconds the end credits run: as set, else about 1.5 s per line, at least 8. */
export const endSeconds = (c: Pick<CreditsSettings, 'endSeconds'>, lines: number) => c.endSeconds > 0 ? c.endSeconds : Math.max(8, Math.round(lines * 1.5))

const SIZE = {title: 0.075, large: 0.05, normal: 0.036, small: 0.028}
const LEADING = 1.55

/** The font files: Lato of the repo, or one of your own for both weights. */
export function fontFiles(font: string, projectDir: string): { regular: string, bold: string } {
    if (!font.trim()) return {regular: join(FONTS, 'Lato-Regular.ttf'), bold: join(FONTS, 'Lato-Bold.ttf')}
    const path = isAbsolute(font) ? font : join(projectDir, font)
    if (!existsSync(path)) throw new Error(`font: no file ${font} - the path of a .ttf or .otf, absolute or relative to the project`)
    return {regular: path, bold: path}
}

/**
 * The drawtext filters of a block of lines, each read from its own file in the working folder (`l<n>.txt`) and centred on
 * its own. `y0` is where the block starts - an expression, so the end credits can scroll (t: the time).
 */
export function linesFilter(lines: CreditLine[], height: number, y0: string, first = 0, extra = ''): { filter: string, files: Record<string, string>, height: number } {
    let y = 0
    const files: Record<string, string> = {}
    const parts: string[] = []
    lines.forEach((line, i) => {
        const size = Math.round(height * SIZE[line.size])
        if (line.text) {
            const name = `l${first + i}.txt`
            files[name] = line.text
            const font = line.size === 'title' || line.size === 'large' ? 'bold.ttf' : 'regular.ttf'
            parts.push(`drawtext=fontfile=${font}:textfile=${name}:expansion=none:fontsize=${size}:fontcolor=${line.size === 'small' ? '0xBBBBBB' : 'white'}:x=(w-text_w)/2:y=${y0}+${Math.round(y)}${extra}`)
        }
        y += size * LEADING
    })
    return {filter: parts.join(','), files, height: Math.round(y)}
}

export type CreditsPlan = {
    width: number, height: number, fps: number,
    opening?: { lines: CreditLine[], seconds: number, marker?: boolean },
    end?: { lines: CreditLine[], seconds: number },
    videoAudio: boolean,
    sound: boolean,       // a sound file under the end credits: input 2 (or 3 with a marker... see creditsFilter)
}

/**
 * The filter graph: input 0 is the video; the cards are made of lavfi colour sources in the graph. With a marker on the
 * title card it is input `markerInput`, a sound under the credits input `soundInput`. Out: [v] and, when the video has
 * sound, [a]. The text files it reads are in `files`, to be written into the working folder ffmpeg runs in.
 */
export function creditsFilter(plan: CreditsPlan, inputs: { marker?: number, sound?: number } = {}): { filter: string, files: Record<string, string> } {
    const {width: w, height: h, fps} = plan
    const parts: string[] = []
    const files: Record<string, string> = {}
    const card = (seconds: number) => `color=c=black:s=${w}x${h}:r=${fps}:d=${seconds.toFixed(3)},format=yuv420p,setsar=1`
    const fades = (seconds: number) => `fade=t=in:st=0:d=0.5,fade=t=out:st=${Math.max(0, seconds - 0.6).toFixed(3)}:d=0.6`
    const silence = (seconds: number) => `anullsrc=r=48000:cl=stereo,atrim=duration=${seconds.toFixed(3)}`
    const segments: string[] = []
    let n = 0
    if (plan.opening) {
        const {lines, seconds} = plan.opening
        const block = linesFilter(lines, h, '0', n)
        Object.assign(files, block.files)
        n += lines.length
        // the block in the middle of the picture, a little above it
        const centred = linesFilter(lines, h, `(h-${block.height})/2-h*0.05`, n - lines.length)
        let video = `${card(seconds)},${centred.filter}`
        if (plan.opening.marker && inputs.marker !== undefined) {
            const size = Math.max(2, Math.round(h * 0.06 / 2) * 2)
            parts.push(`[${inputs.marker}:v]scale=-2:${size}:flags=lanczos,format=rgba[ocm]`)
            parts.push(`${video}[ocb]`)
            parts.push(`[ocb][ocm]overlay=x=(W-w)/2:y=H*0.74:format=auto,${fades(seconds)},format=yuv420p[ov]`)
        } else {
            parts.push(`${video},${fades(seconds)}[ov]`)
        }
        segments.push('[ov]' + (plan.videoAudio ? '[oa]' : ''))
        if (plan.videoAudio) parts.push(`${silence(seconds)}[oa]`)
    }
    parts.push(`[0:v]setsar=1,format=yuv420p[mv]`)
    if (plan.videoAudio) parts.push(`[0:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[ma]`)
    segments.push('[mv]' + (plan.videoAudio ? '[ma]' : ''))
    if (plan.end) {
        const {lines, seconds} = plan.end
        const measured = linesFilter(lines, h, '0', n)
        // from below the picture to above it in the time it runs
        const speed = (h + measured.height) / seconds
        const scroll = linesFilter(lines, h, `h-t*${speed.toFixed(3)}`, n)
        Object.assign(files, scroll.files)
        parts.push(`${card(seconds)},${scroll.filter},fade=t=in:st=0:d=0.5[ev]`)
        if (plan.videoAudio) {
            parts.push(plan.sound && inputs.sound !== undefined
                ? `[${inputs.sound}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration=${seconds.toFixed(3)},afade=t=in:st=0:d=0.5,afade=t=out:st=${Math.max(0, seconds - 3).toFixed(3)}:d=3[ea]`
                : `${silence(seconds)}[ea]`)
        }
        segments.push('[ev]' + (plan.videoAudio ? '[ea]' : ''))
    }
    parts.push(`${segments.join('')}concat=n=${segments.length}:v=1:a=${plan.videoAudio ? 1 : 0}[v]${plan.videoAudio ? '[a]' : ''}`)
    return {filter: parts.join(';'), files}
}

/**
 * Writes `<video>-credits.mp4` next to the video: the title card, the video, the credits - as `lines` says. ffmpeg runs in
 * a folder of its own with the fonts and the text files, so no path or text in the filter needs escaping. Subtitles of
 * the video are kept, moved by the length of the title card.
 */
export async function creditsVideo(video: string, lines: { opening?: CreditLine[], end?: CreditLine[] }, c: CreditsSettings,
                                   given: { regular: string, bold: string, marker?: string, sound?: string }): Promise<{ file: string, seconds: { opening: number, end: number } }> {
    // ffmpeg runs in a folder of its own: every path it is given is a whole one
    video = resolve(video)
    const files = {...given, ...(given.marker ? {marker: resolve(given.marker)} : {}), ...(given.sound ? {sound: resolve(given.sound)} : {})}
    const info = await probeVideo(video)
    const fps = Math.round(info.fps * 1000) / 1000
    const end = lines.end ? endSeconds(c, lines.end.length) : 0
    const plan: CreditsPlan = {
        width: info.width, height: info.height, fps,
        ...(lines.opening ? {opening: {lines: lines.opening, seconds: c.openingSeconds, marker: !!files.marker}} : {}),
        ...(lines.end ? {end: {lines: lines.end, seconds: end}} : {}),
        videoAudio: info.hasAudio, sound: !!files.sound,
    }
    const inputs: string[] = ['-i', video]
    const at: { marker?: number, sound?: number } = {}
    let next = 1
    if (plan.opening?.marker) { inputs.push('-i', files.marker!); at.marker = next++ }
    if (plan.end && files.sound) { inputs.push('-i', files.sound); at.sound = next++ }
    const opening = plan.opening ? c.openingSeconds : 0
    inputs.push('-itsoffset', opening.toFixed(3), '-i', video)
    const subtitles = next
    const {filter, files: texts} = creditsFilter(plan, at)
    const work = mkdtempSync(join(tmpdir(), 'credits-'))
    try {
        writeFileSync(join(work, 'regular.ttf'), readFileSync(files.regular))
        writeFileSync(join(work, 'bold.ttf'), readFileSync(files.bold))
        for (const [name, text] of Object.entries(texts)) writeFileSync(join(work, name), text)
        const target = postworkName(video, 'credits')
        const frames = Math.round((opening + end) * fps) + info.frames
        await encode([...inputs, '-filter_complex', filter, '-map', '[v]', ...(info.hasAudio ? ['-map', '[a]', '-c:a', 'aac', '-b:a', '320k'] : []),
            '-map', `${subtitles}:s?`, '-c:s', 'copy', ...VIDEO_ENCODE], target, frames, 'adding the credits', work)
        return {file: target, seconds: {opening, end}}
    } finally {
        rmSync(work, {recursive: true, force: true})
    }
}

/** The title of a project as the credits say it: the one set, else a film's own, else its id. */
export function projectTitle(dir: string, kind: 'music' | 'film', id: string, set: string): string {
    if (set.trim()) return set.trim()
    if (kind === 'film' && existsSync(join(dir, 'project.json'))) {
        try {
            const data = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')) as { screenplay?: { title?: string }, brief?: { title?: string } }
            return data.screenplay?.title ?? data.brief?.title ?? id
        } catch {
            return id
        }
    }
    return id
}
