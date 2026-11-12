import {noProject} from '../lib/usage.ts'
import {runEvent} from '../lib/run-events.ts'
import {cli} from '../lib/cli.ts'
import {completeDerivative} from '../lib/refinish.ts'
// A project made before larger clips, 48 fps and the finish gets them afterwards, from the clips it has. No plan run: it reads output/clips/ and the
// settings of the project, nothing is generated and no prompt changes. Nothing it has is overwritten: videos/ and the final video stay as they are, every
// variant has its own folder videos/refined/<variant>/ and its own final videos <id>--<variant>[-48fps][-finished].mp4, so they can be compared.
// usage: bun run refinish <id> [--film] [--preset=grade|smooth|fullhd] [--upscale=none|refine|latent|model] [--size=fullhd|2x|WxH]
//        [--model=<file>] [--denoise=0.2] [--fps=48] [--finish] [--only=slot-001,...] [--again] [--comfy=URL]     (--only: those clips, no final video)
import {existsSync, mkdirSync, readFileSync} from 'node:fs'
import {join, relative} from 'node:path'
import {parseArgs} from 'node:util'
import {archiveFiles, versionStamp} from '../lib/archive.ts'
import {assembleFinal, probeVideo} from '../lib/assemble.ts'
import {onlyClips} from '../lib/batch.ts'
import type {ClipRequest} from '../lib/compose.ts'
import {loadProjectConfig} from '../lib/config.ts'
import {finishCopy, interpolateClips} from '../lib/final-pass.ts'
import {finishOf, finishedName} from '../lib/finish.ts'
import {FPS, secondsAt} from '../lib/frames.ts'
import {songFileOf} from '../lib/inputs.ts'
import {multiplierFor} from '../lib/interpolate.ts'
import {lockProject} from '../lib/lock.ts'
import {keepLogIn, log, styles} from '../lib/log.ts'
import {projectDir, projectExists, listProjects} from '../lib/project-setup.ts'
import type {Project} from '../lib/project.ts'
import {clipFolder, finalName, readOptions, targetSize, variantOf} from '../lib/refinish.ts'
import {readClipRequests} from '../lib/render-state.ts'
import {Renderer} from '../lib/render.ts'
import {beginRun} from '../lib/run-record-view.ts'
import {loadSettings} from '../lib/settings.ts'
import {keepTimingsIn} from '../lib/timings.ts'
import {addScore, assembleFilm, assembleSmoothFilm, SCORE_EXTENSIONS} from '../lib/film/assemble.ts'
import type {FilmClipRequest} from '../lib/film/compose.ts'
import {loadFilmConfig} from '../lib/film/config.ts'
import {filmRenderConfig} from '../lib/film/pictures.ts'
import {FilmRenderer, filmAssemblyClips} from '../lib/film/render.ts'
import {filmDir, filmExists, filmIds} from '../lib/film/setup.ts'
import {addSubtitles} from '../lib/film/subtitles.ts'
cli('refinish')

const usage =
    'usage: bun run refinish <id> [--film] [--preset=grade|smooth|fullhd] [--upscale=none|refine|latent|model] [--size=fullhd|2x|WxH] [--model=<file>] [--denoise=0.2] [--fps=48] [--finish] [--only=slot-001,...] [--again] [--comfy=URL]'
const {
    values: args,
    positionals: [id],
} = (() => {
    try {
        return parseArgs({
            args: Bun.argv.slice(2),
            allowPositionals: true,
            options: {
                film: {type: 'boolean', default: false},
                preset: {type: 'string'},
                upscale: {type: 'string'},
                size: {type: 'string'},
                model: {type: 'string'},
                denoise: {type: 'string'},
                fps: {type: 'string'},
                finish: {type: 'boolean', default: false},
                only: {type: 'string', default: ''},
                again: {type: 'boolean', default: false},
                comfy: {type: 'string'},
            },
        })
    } catch (e) {
        return log.usageError(e instanceof Error ? e.message : String(e), usage)
    }
})()
if (!id || !(args.film ? filmExists(id) : projectExists(id)))
    log.usageError(args.film ? noProject('film', id, filmIds()) : noProject('project', id, listProjects()), usage)
const options = (() => {
    try {
        return readOptions(args)
    } catch (e) {
        return log.usageError((e as Error).message, usage)
    }
})()
const dir = args.film ? filmDir(id!) : projectDir(id!)
if (options.fps !== FPS && !multiplierFor(options.fps)) log.usageError(`--fps: frame interpolation does not reach ${options.fps} from ${FPS}`, usage)

const only = new Set(args.only.split(',').filter(Boolean))
const variant = variantOf(options)
const folder = clipFolder(variant)
lockProject(dir, id!)
keepTimingsIn(dir)
keepLogIn(join(dir, 'logs', `${versionStamp()}.log`))
beginRun(dir, 'tools/refinish.ts')

// a music video's and a film's: what is different between them, in one place
const requests = await readClipRequests<ClipRequest & FilmClipRequest>(dir)
if (!requests.length) throw new Error(`${dir} has no clip requests - it was never planned`)
const selected = onlyClips(requests, only)
const missing = selected.filter(r => !existsSync(join(dir, 'videos', `${r.id}.mp4`))).map(r => r.id)
if (missing.length) throw new Error(`not rendered: ${missing.join(', ')} - this works from the clips there are`)

const config = args.film ? filmRenderConfig(await loadFilmConfig(dir)) : await loadProjectConfig(dir)
const filmConfig = args.film ? await loadFilmConfig(dir) : undefined
const settings = await loadSettings({
    projectModel: (args.film ? filmConfig! : (config as Awaited<ReturnType<typeof loadProjectConfig>>)).llm.model,
    ...(args.comfy ? {comfy: args.comfy} : {}),
})
const remoteId = args.film ? `film-${id}` : id!
using renderer = args.film ? new FilmRenderer(remoteId, dir, config, settings.comfy) : new Renderer(remoteId, dir, config, settings.comfy)

log.step(
    'Variant',
    `${styles.name(variant)} ${styles.muted(`- videos/ stays as it is, ${options.upscale === 'none' ? 'the clips are used as they are' : `the clips go to ${folder}/`}`)}`,
)

// the stems of a music video, as the plan found them. Nothing is separated here: a stem that is gone is said
const stemFiles = (): Record<string, string> => {
    const data = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')) as Project
    return {
        ...Object.fromEntries(Object.entries({...data.stems, ...data.instrumentStems}).map(([stem, file]) => [stem, join(dir, file as string)])),
        song: songFileOf(dir),
    }
}

////////// LARGER, CLIP BY CLIP
const fileOf = (clip: {id: string}) => (options.upscale === 'none' ? join(dir, 'videos', `${clip.id}.mp4`) : join(dir, folder, `${clip.id}.mp4`))
if (options.upscale !== 'none') {
    mkdirSync(join(dir, folder), {recursive: true})
    log.section(`LARGER · ${options.upscale} · ${selected.length} clip(s)`)
    if (args.again) {
        const stamp = versionStamp()
        for (const clip of selected) archiveFiles(dir, `${clip.id}-${variant}-${stamp}`, [`${folder}/${clip.id}.mp4`, `${folder}/${clip.id}.mp4.json`])
    }
    const song = args.film ? undefined : stemFiles()
    // what this run renders, for the workspace to count the jobs that are done (#829)
    runEvent({type: 'jobs', kind: 'clip', ids: selected.filter(clip => !completeDerivative(fileOf(clip))).map(clip => clip.id)})
    for (const clip of selected) {
        const source = join(dir, 'videos', `${clip.id}.mp4`)
        const target = fileOf(clip)
        if (completeDerivative(target)) {
            log.step('Exists', styles.muted(`${folder}/${clip.id}.mp4`))
            continue
        }
        const info = await probeVideo(source)
        const size = targetSize(options.size, info.width, info.height)
        if (options.upscale === 'latent') await renderer.renderLatentUpscaled(clip.id, source, target, size)
        else if (options.upscale === 'model') await renderer.renderUpscaled(clip.id, source, target, options.model, size)
        else await renderer.renderRefined(clip, source, target, size, options.denoise, song)
    }
}

if (only.size) {
    log.step('Done', styles.muted(`--only: ${selected.length} clip(s), no final video`))
    process.exit(0)
}

////////// THE FINAL VIDEOS - next to the old ones, under their own name
log.section('THE FINAL VIDEOS')
const sources = requests.map(fileOf)
const target = join(dir, finalName(id!, variant))
const finishing = options.finish ? finishOf(config.finish === false ? true : config.finish) : undefined
const multiplier = options.fps !== FPS ? multiplierFor(options.fps)! : 1
const smooth = target.replace(/\.mp4$/, `-${options.fps}fps.mp4`)
if (!only.size) {
    const outputs = [target]
    if (options.fps !== FPS) outputs.push(smooth)
    if (finishing) {
        outputs.push(finishedName(target))
        if (options.fps !== FPS) outputs.push(finishedName(smooth))
    }
    const existing = outputs.filter(existsSync).map(file => relative(dir, file))
    if (existing.length) archiveFiles(dir, `refinish-${variant}-${versionStamp()}`, existing)
}
const interpolate = async (shown: {id: string; frames: number; shots?: {at: number}[]}[]) =>
    (
        await interpolateClips(renderer, shown, config.interpolationModel, options.fps, {
            folder: options.upscale === 'none' ? 'videos/interpolated' : `${folder}/interpolated`,
            sources,
        })
    ).files

if (args.film) {
    const film = filmConfig!
    const assembled = await assembleFilm({
        clips: filmAssemblyClips(dir, requests),
        projectDir: dir,
        target,
        levelMatching: film.levelMatching,
        sources,
    })
    log.step('Saved', `${target} ${styles.muted(`${assembled.width}x${assembled.height}, ${assembled.duration}`)}`)
    const score = SCORE_EXTENSIONS.map(ext => join(dir, 'input', `score.${ext}`)).find(file => existsSync(file))
    if (score) await addScore(target, score, film.scoreVolume)
    const videos = [target]
    const spans = requests.map((r, i) => ({
        id: r.id,
        start: assembled.starts[i]!,
        end: assembled.starts[i]! + secondsAt(assembled.used[i]! - assembled.skipped[i]!),
    }))
    if (finishing) videos.push(await finishCopy(target, finishing, spans))
    if (multiplier > 1) {
        const files = await interpolate(requests.map((r, i) => ({id: r.id, frames: assembled.used[i]!, shots: r.shots})))
        const more = await assembleSmoothFilm({
            clips: requests.map((r, i) => ({id: r.id, used: assembled.used[i]!, skipped: assembled.skipped[i]!})),
            files,
            multiplier,
            fps: options.fps,
            sound: target,
            target: smooth,
        })
        log.step('Saved', `${smooth} ${styles.muted(`${more.width}x${more.height}, ${more.frames} frames at ${options.fps} fps`)}`)
        videos.push(smooth)
        if (finishing) videos.push(await finishCopy(smooth, finishing, spans))
    }
    // the subtitles the film has: nothing is translated here
    const srt = join(dir, `${id}.srt`)
    if (existsSync(srt)) for (const video of videos) await addSubtitles(video, srt, film)
} else {
    const music = config as Awaited<ReturnType<typeof loadProjectConfig>>
    const songFile = songFileOf(dir)
    const result = await assembleFinal({clips: requests, projectDir: dir, songFile, songAudio: music.songAudio, target, sources})
    log.step('Saved', `${target} ${styles.muted(`${result.width}x${result.height}, ${result.frames} frames`)}`)
    const spans = requests.map(c => ({id: c.id, start: secondsAt(c.frameStart), end: secondsAt(c.frameStart + c.frames)}))
    if (finishing) await finishCopy(target, finishing, spans)
    if (multiplier > 1) {
        const files = await interpolate(requests)
        const more = await assembleFinal({
            clips: requests,
            projectDir: dir,
            songFile,
            songAudio: music.songAudio,
            target: smooth,
            interpolated: {files, multiplier, fps: options.fps},
        })
        log.step('Saved', `${smooth} ${styles.muted(`${more.width}x${more.height}, ${more.frames} frames at ${options.fps} fps`)}`)
        if (finishing) await finishCopy(smooth, finishing, spans)
    }
}
