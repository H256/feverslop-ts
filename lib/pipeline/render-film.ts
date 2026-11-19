import {versionStamp} from '../archive.ts'
import {previewSources} from '../assemble.ts'
import {clipChains, onlyClips, warnClipsGoingOn, warnFixedSeed} from '../batch.ts'
import {archiveClip, archivePreview} from '../film/archive.ts'
import {addScore, assembleFilm, assembleSmoothFilm, SCORE_EXTENSIONS} from '../film/assemble.ts'
import {askFilmJson as askJson} from '../film/json.ts'
import {filmRenderConfig, renderAll} from '../film/pictures.ts'
import {filmAssemblyClips, filmClipFreshness, FilmRenderer} from '../film/render.ts'
import {addSubtitles, subtitleCues, subtitlePrompt, subtitleTexts, toSrt} from '../film/subtitles.ts'
import {timelineEdl} from '../film/timeline.ts'
import {finishCopy, interpolateClips} from '../final-pass.ts'
import {finishOf} from '../finish.ts'
import {FPS, secondsAt} from '../frames.ts'
import {log, styles} from '../log.ts'
import {type PictureAsk, renderPictures} from './pictures.ts'
import {sayStaleClips, serverNames, startRenderer} from './render-steps.ts'
import {clipFailureRisks} from '../render-state.ts'
import {eachFileOnce} from '../provenance.ts'
import {runEvent} from '../run-events.ts'
import {filmStatus} from '../status.ts'
import {readTimings} from '../timings.ts'
import {existsSync} from 'node:fs'
import {join} from 'node:path'
import type {FilmClipRequest} from '../film/compose.ts'
import type {LoadedFilmConfig} from '../film/config.ts'
import type {FilmPictureJob} from '../film/pictures.ts'
import type {FilmStore} from '../film/store.ts'
import type {Screenplay} from '../film/types.ts'
import type {RetakeAsk} from '../retake.ts'
import type {Settings} from '../settings.ts'

// The end of a film's run (film.ts steps 11-12, #841): its pictures and clips rendered as asked, the film assembled - with its score,
// the finish, another frame rate, its subtitles and its edit list. What it renders is planned before; this only renders and puts
// together.

/** What the film's run has planned and been asked for, as its end needs it - and how its clips are planned again once the sheets are there. */
export type FilmRenderRun = {
    film: FilmStore
    config: LoadedFilmConfig
    settings: Settings
    args: PictureAsk & {preview: boolean; strict: boolean}
    render: Set<string>
    refresh: Set<string>
    only: Set<string>
    retake: RetakeAsk | undefined
    screenplay: Screenplay
    pictures: FilmPictureJob[]
    requests: FilmClipRequest[]
    replan: () => Promise<FilmClipRequest[]>
}

export async function renderFilm(run: FilmRenderRun) {
    const {film, config, settings, args, render, refresh, only, retake, screenplay, pictures, replan} = run
    // the requests, planned again once the sheets of this run are there: the clips read their views from them
    let {requests} = run
    /////////// 11 · RENDERING WITH COMFYUI
    if (render.has('images') || render.has('videos') || retake) {
        const renderConfig = filmRenderConfig(config)
        // the project id is part of ComfyUI's folder - "film-" keeps it apart from a music video of the same name
        using renderer = new FilmRenderer(`film-${film.id}`, film.dir, renderConfig, settings.comfy)
        log.section('11 · RENDERING WITH COMFYUI')
        log.step(
            'Config',
            styles.muted(
                `seed ${config.seed}, images ${config.imageResolution} (${renderConfig.imageWorkflow})${config.sequenceSheets ? `, sequence sheets (${renderConfig.sequenceWorkflow})` : ''}`,
            ),
        )
        // what was made from another request than the plan has now is rendered again - the old ones are kept (lib/provenance.ts)
        await startRenderer(renderer, settings, {refresh, again: args.again, retake, pictureAnchor: args['picture-anchor']})
        if (retake) {
            const clip = requests.find(r => r.id === retake.clip)
            if (!clip) throw new Error(`--retake: no clip ${retake.clip} - the clips are ${requests.map(r => r.id).join(', ')}`)
            await renderer.renderFilmRetake(clip, retake)
        }
        if (render.has('images')) {
            await renderPictures(renderer, pictures, {dir: film.dir, config: renderConfig, servers: serverNames(settings), render, only, args})
        }
        // a sheet rendered just now gets its views read, and the clips their view, before they are rendered
        if (render.has('images') && render.has('videos') && config.sequenceSheets && !config.locationViews) requests = await replan()
        // clips need all their pictures, so they start after the pictures - free the image model's VRAM first
        if (render.has('videos')) {
            if (render.has('images')) await renderer.freeMemory()
            const selected = onlyClips(requests, only)
            log.step('Clips', `${selected.length}${only.size ? styles.muted(` of ${requests.length} (--only)`) : ''}`)
            for (const risk of clipFailureRisks(
                readTimings(),
                selected.filter(c => args.again || !existsSync(join(film.dir, 'videos', `${c.id}.mp4`))),
                renderConfig.videoWorkflow,
                serverNames(settings),
            ))
                log.warn(risk)
            // a clip that starts on the last frame of the one before waits for it: those render one after the other, each chain next to the others
            const renderClips = (clips: typeof requests) =>
                renderAll(clipChains(clips), async chain => {
                    for (const clip of chain)
                        await (args.preview
                            ? renderer.renderFilmPreview(clip)
                            : renderer.renderFilmClip(
                                  clip,
                                  requests.find(r => r.id === clip.startsFrom),
                              ))
                })
            // on request, and only for the clips named: they are put away in old/attempts/ and rendered again, with a new seed
            if (args.again) {
                warnFixedSeed(config.seed)
                const stamp = versionStamp()
                for (const clip of selected)
                    log.step(
                        'Again',
                        `${clip.id} ${styles.muted(`- the old one is in ${(args.preview ? archivePreview : archiveClip)(film.dir, clip.id, stamp)}`)}`,
                    )
                // a preview leaves no last frame behind - the clips after it are not affected
                if (!args.preview) warnClipsGoingOn(selected, requests)
            }
            // what this run renders, for the workspace to count the jobs that are done (#829)
            const folder = args.preview ? 'previews' : 'videos'
            runEvent({type: 'jobs', kind: 'clip', ids: selected.filter(c => args.again || !existsSync(join(film.dir, folder, `${c.id}.mp4`))).map(c => c.id)})
            await renderClips(selected)
        }
    }

    /////////// 12 · ASSEMBLING THE FILM
    if (render.has('final') && args.preview) {
        // a quick look at cut, timing and continuity: from the previews with their own sound, without finish, score or subtitles, and never the film
        log.section('12 · THE PREVIEW VIDEO')
        const target = join(film.dir, `${film.id}-preview.mp4`)
        const result = await assembleFilm({
            clips: requests.map(r => ({id: r.id, frames: r.frames})),
            projectDir: film.dir,
            target,
            sources: await previewSources(film.dir, requests),
        })
        log.step('Saved', `${target} ${styles.muted(`${result.width}x${result.height}, ${result.frames} frames, ${result.duration}`)}`)
    } else if (render.has('final')) {
        log.section('12 · ASSEMBLING THE FILM')
        const selected = onlyClips(requests, only)
        // some of the clips only: a try-out, never the film itself
        const target = join(film.dir, only.size ? `${film.id}-partial.mp4` : `${film.id}.mp4`)
        log.step('Sound', styles.muted('the sound the model made for each clip, with a short fade at every cut'))
        // a clip made from another picture, workflow or start frame than the plan has now is still a clip: said here, an error only with --strict
        const filmConfig = filmRenderConfig(config)
        sayStaleClips(
            eachFileOnce(() => selected.filter(r => filmClipFreshness(r, film.dir, filmConfig) === 'stale').map(r => r.id)),
            args.strict,
        )
        const result = await assembleFilm({clips: filmAssemblyClips(film.dir, selected), projectDir: film.dir, target, levelMatching: config.levelMatching})

        // a score in input/ is mixed under the film
        const score = SCORE_EXTENSIONS.map(ext => film.input(`score.${ext}`)).find(file => existsSync(file))
        if (score) {
            await addScore(target, score, config.scoreVolume)
            log.step('Score', `${score} ${styles.muted(`under the film at ${config.scoreVolume} dB, ducking under the dialogue`)}`)
        }

        // the finish and a film at another frame rate, as in the music video (lib/final-pass.ts) - before the subtitles, which every
        // one of the films then gets: burned in after the grade and the grain, the text stays clean
        const videos = [target]
        const finishing = finishOf(config.finish)
        // where each clip is in the film - the same seconds at every frame rate
        const spans = selected.map((r, i) => ({id: r.id, start: result.starts[i]!, end: result.starts[i]! + secondsAt(result.used[i]! - result.skipped[i]!)}))
        if (finishing) videos.push(await finishCopy(target, finishing, spans))
        if (config.finalFps !== FPS) {
            using smoother = new FilmRenderer(`film-${film.id}`, film.dir, filmRenderConfig(config), settings.comfy)
            const {files, multiplier} = await interpolateClips(
                smoother,
                selected.map((r, i) => ({id: r.id, frames: result.used[i]!, shots: r.shots})),
                config.interpolationModel,
                config.finalFps,
            )
            const smooth = target.replace(/\.mp4$/, `-${config.finalFps}fps.mp4`)
            const more = await assembleSmoothFilm({
                clips: selected.map((r, i) => ({id: r.id, used: result.used[i]!, skipped: result.skipped[i]!})),
                files,
                multiplier,
                fps: config.finalFps,
                sound: target,
                target: smooth,
            })
            log.step(
                'Saved',
                `${smooth} ${styles.muted(`${more.width}x${more.height}, ${more.frames} frames at ${config.finalFps} fps, ${more.seconds.toFixed(3)}s`)}`,
            )
            videos.push(smooth)
            if (finishing) videos.push(await finishCopy(smooth, finishing, spans))
        }

        // subtitles: the screenplay's own translations, or the film's lines translated into the language in config.json
        let translated = film.data.subtitles
        if (config.subtitles !== 'script' && config.subtitles !== 'off') {
            translated = await film.step('subtitles', '12a · TRANSLATING THE SUBTITLES', async () => {
                const {lines, options} = subtitlePrompt(screenplay, config.subtitles)
                if (!lines.length) return {}
                const answer = await askJson<Record<string, unknown>>(options)
                return Object.fromEntries(
                    lines.flatMap(l =>
                        typeof answer[l.key] === 'string' && (answer[l.key] as string).trim() ? [[l.key, (answer[l.key] as string).trim()]] : [],
                    ),
                )
            })
        }
        await Bun.write(join(film.dir, 'output', 'timeline.edl'), timelineEdl(screenplay.title, selected, result))
        const cues = subtitleCues(selected, result.starts, subtitleTexts(screenplay, translated, config.subtitles), result)
        if (cues.length) {
            const srt = target.replace(/\.mp4$/, '.srt')
            await Bun.write(srt, toSrt(cues))
            for (const video of videos) await addSubtitles(video, srt, config)
            log.step(
                'Subtitles',
                `${srt} ${styles.muted(`${cues.length} cues, ${config.burnSubtitles ? 'burned into the picture' : 'also a track in the mp4'}${videos.length > 1 ? ` of all ${videos.length} films` : ''} - timing is estimated`)}`,
            )
        } else if (config.subtitles !== 'off') {
            log.step(
                'Subtitles',
                styles.muted(
                    config.subtitles === 'script'
                        ? 'none - the screenplay has no translations under its lines (config.json: "subtitles": "en" translates them)'
                        : 'none - every line is in that language already',
                ),
            )
        }
        log.step(
            'Saved',
            `${target} ${styles.muted(`${result.width}x${result.height}, ${result.frames} frames, ${result.duration}${only.size ? ` - ${selected.length} of ${requests.length} clips (--only)` : ''}`)}`,
        )
    }

    // the next step, as bun run status says it - so that following only the "Next" lines leads to a film (#828)
    {
        const {next} = await filmStatus(film.id, {store: film, config, settings}).catch(() => ({next: undefined}))
        if (next?.command) log.next(next.command)
    }
}
