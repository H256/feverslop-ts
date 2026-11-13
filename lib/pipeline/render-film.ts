import {archiveFiles, versionStamp} from '../archive.ts'
import {previewSources} from '../assemble.ts'
import {clipChains, onlyClips, warnClipsGoingOn, warnFixedSeed} from '../batch.ts'
import {archiveClip} from '../film/archive.ts'
import {addScore, assembleFilm, assembleSmoothFilm, SCORE_EXTENSIONS} from '../film/assemble.ts'
import {askFilmJson as askJson} from '../film/json.ts'
import {filmRenderConfig, pictureSeed, renderAll} from '../film/pictures.ts'
import {filmAssemblyClips, filmClipFreshness, FilmRenderer} from '../film/render.ts'
import {addSubtitles, subtitleCues, subtitlePrompt, subtitleTexts, toSrt} from '../film/subtitles.ts'
import {timelineEdl} from '../film/timeline.ts'
import {finishCopy, interpolateClips} from '../final-pass.ts'
import {finishOf} from '../finish.ts'
import {FPS, secondsAt} from '../frames.ts'
import {log, styles} from '../log.ts'
import {hasOwnAnchor, installOwnPicture} from '../own-picture.ts'
import {clipFailureRisks} from '../render-state.ts'
import {namedPictures, type PictureJob, pinEditedPicture, putAwayPicture} from '../render.ts'
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
    args: {
        only: string
        again: boolean
        preview: boolean
        refresh: string
        strict: boolean
        'new-anchor': boolean
        'picture-anchor'?: string
        'picture-prompt'?: string
    }
    render: Set<string>
    retake: RetakeAsk | undefined
    screenplay: Screenplay
    pictures: FilmPictureJob[]
    requests: FilmClipRequest[]
    replan: () => Promise<FilmClipRequest[]>
}

export async function renderFilm(run: FilmRenderRun) {
    const {film, config, settings, args, render, retake, screenplay, pictures, replan} = run
    // the requests, planned again once the sheets of this run are there: the clips read their views from them
    let {requests} = run
    /////////// 11 · RENDERING WITH COMFYUI
    if (render.has('images') || render.has('videos') || retake) {
        const renderConfig = filmRenderConfig(config)
        // the project id is part of ComfyUI's folder - "film-" keeps it apart from a music video of the same name
        using renderer = new FilmRenderer(`film-${film.id}`, film.dir, renderConfig, settings.comfy)
        // what was made from another request than the plan has now is rendered again - the old ones are kept (lib/provenance.ts)
        renderer.refresh = new Set(args.refresh.split(',').filter(Boolean))
        log.section('11 · RENDERING WITH COMFYUI')
        log.step(
            'Config',
            styles.muted(
                `seed ${config.seed}, images ${config.imageResolution} (${renderConfig.imageWorkflow})${config.sequenceSheets ? `, sequence sheets (${renderConfig.sequenceWorkflow})` : ''}`,
            ),
        )
        log.step('Servers', settings.comfy.map(s => `${styles.name(s.name)} ${styles.muted(s.url)}`).join(', '))
        if (args.again || renderer.refresh.size || retake || args['picture-anchor']) await renderer.serversFirst()
        if (retake) {
            const clip = requests.find(r => r.id === retake.clip)
            if (!clip) throw new Error(`--retake: no clip ${retake.clip} - the clips are ${requests.map(r => r.id).join(', ')}`)
            await renderer.renderFilmRetake(clip, retake)
        }
        if (render.has('images')) {
            log.step('Pictures', `${pictures.length}${config.sequenceSheets ? styles.muted(' (multi-angle reference sheets)') : ''}`)
            const renderPicture = (picture: PictureJob) =>
                config.sequenceSheets && picture.kind !== 'prop' ? renderer.renderSequenceSheet(picture) : renderer.renderPicture(picture)
            const only = new Set(args.only.split(',').filter(Boolean))
            const named = namedPictures(pictures, only, args.again && !render.has('videos'))
            // an edited prompt: this one picture, from these words, kept as it is from then on
            const edited = args['picture-prompt'] ? await Bun.file(args['picture-prompt']).text() : undefined
            if (edited !== undefined && named.length !== 1) throw new Error('--picture-prompt goes with one picture in --only')
            const chosen = edited === undefined ? named : named.map(p => ({...p, prompt: edited}))
            if (args.again && pictures.some(p => only.has(p.id))) {
                warnFixedSeed(config.seed)
                // a new anchor for an edited prompt - but the user's own anchor stays, its prompt is a note (lib/own-picture.ts)
                const newAnchor = (picture: PictureJob) =>
                    args['new-anchor'] || !!args['picture-anchor'] || (edited !== undefined && !hasOwnAnchor(picture, film.dir, config.sequenceSheets))
                for (const picture of chosen)
                    log.step(
                        'Again',
                        `${picture.id} ${styles.muted(`- the old one is in ${putAwayPicture(picture, film.dir, renderConfig, newAnchor(picture))}`)}`,
                    )
            }
            if (args['picture-anchor'])
                log.step(
                    'Own',
                    `${chosen[0]!.id} ${styles.muted(`- your picture is ${await installOwnPicture(chosen[0]!, film.dir, config.sequenceSheets, args['picture-anchor'])}`)}`,
                )
            await renderAll(
                chosen.filter(p => !p.baseId),
                renderPicture,
            )
            // another look of a character is drawn with the seed of the normal picture - that keeps the face; it waits for it
            await renderAll(
                chosen.filter(p => p.baseId),
                p => renderPicture({...p, seed: pictureSeed(film.dir, p.baseId!)}),
            )
            if (edited !== undefined) pinEditedPicture(chosen[0]!, film.dir, edited)
        }
        // a sheet rendered just now gets its views read, and the clips their view, before they are rendered
        if (render.has('images') && render.has('videos') && config.sequenceSheets && !config.locationViews) requests = await replan()
        // clips need all their pictures, so they start after the pictures - free the image model's VRAM first
        if (render.has('videos')) {
            if (render.has('images')) await renderer.freeMemory()
            const only = new Set(args.only.split(',').filter(Boolean))
            const selected = onlyClips(requests, only)
            log.step('Clips', `${selected.length}${only.size ? styles.muted(` of ${requests.length} (--only)`) : ''}`)
            for (const risk of clipFailureRisks(
                readTimings(),
                selected.filter(c => args.again || !existsSync(join(film.dir, 'videos', `${c.id}.mp4`))),
                renderConfig.videoWorkflow,
                settings.comfy.map(server => server.name),
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
                        `${clip.id} ${styles.muted(`- the old one is in ${args.preview ? archiveFiles(film.dir, `${clip.id}-preview-${stamp}`, [join('previews', `${clip.id}.mp4`), join('previews', `${clip.id}.mp4.json`)]) : archiveClip(film.dir, clip.id, stamp)}`)}`,
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
        const only = new Set(args.only.split(',').filter(Boolean))
        const selected = onlyClips(requests, only)
        // some of the clips only: a try-out, never the film itself
        const target = join(film.dir, only.size ? `${film.id}-partial.mp4` : `${film.id}.mp4`)
        log.step('Sound', styles.muted('the sound the model made for each clip, with a short fade at every cut'))
        // a clip made from another picture, workflow or start frame than the plan has now is still a clip: said here, an error only with --strict
        const filmConfig = filmRenderConfig(config)
        const stale = selected.filter(r => filmClipFreshness(r, film.dir, filmConfig) === 'stale').map(r => r.id)
        if (stale.length) {
            const message = `${stale.length} clip(s) were made from another prompt, picture or start frame than the plan has now: ${stale.join(', ')} - render them again with --render=videos --refresh=clips`
            if (args.strict) throw new Error(message)
            log.warn(message)
        }
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
        const {next} = await filmStatus(film.id).catch(() => ({next: undefined}))
        if (next?.command) log.next(next.command)
    }

    return {}
}
