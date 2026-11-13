import {existsSync} from 'node:fs'
import {join} from 'node:path'
import {archiveFiles, versionStamp} from '../archive.ts'
import {assembleFinal, formatSlotRanges, previewSources} from '../assemble.ts'
import {clipChains, onlyClips, renderAll, warnClipsGoingOn, warnFixedSeed} from '../batch.ts'
import {boundaryFrameAsset, type ClipRequest} from '../compose.ts'
import type {ProjectConfig} from '../config.ts'
import {finishCopy, interpolateClips} from '../final-pass.ts'
import {finishOf} from '../finish.ts'
import {FPS, secondsAt} from '../frames.ts'
import {log, styles} from '../log.ts'
import type {ProjectStore} from '../project.ts'
import {freshness} from '../provenance.ts'
import {clipFingerprint, type PictureJob, Renderer} from '../render.ts'
import {clipEstimate, clipFailureRisks} from '../render-state.ts'
import type {RetakeAsk} from '../retake.ts'
import {runEvent} from '../run-events.ts'
import type {Settings} from '../settings.ts'
import {type ExportFormat, exportTimelines} from '../timeline-export.ts'
import {readTimings, recordTiming} from '../timings.ts'

// The end of a music video's run (index.ts, #841): its pictures and clips rendered as asked, the final video assembled - with the
// finish and another frame rate when the config asks - and the timeline exported for a video editor. What it renders is planned
// before; this only renders and puts together.

/** What the run has planned and been asked for, as the end of the run needs it. */
export type MusicRenderRun = {
    project: ProjectStore
    config: ProjectConfig
    settings: Settings
    args: {only: string; again: boolean; preview: boolean; strict: boolean; 'picture-anchor'?: string}
    render: Set<string>
    refreshKinds: Set<string>
    retake?: RetakeAsk
    clips: ClipRequest[]
    pictures: PictureJob[]
    stemFiles: Record<string, string>
    songFile: string
    exportFormats: string[]
    /** where a setting comes from, in the words of the run */
    from: (source: string) => string
    /** the pictures of the cast and the places, as the look stage renders them too */
    renderPictures: (renderer: Renderer, pictures: PictureJob[]) => Promise<void>
}

export async function renderAndAssemble(run: MusicRenderRun) {
    const {project, config, settings, args, render, refreshKinds, retake, clips, pictures, stemFiles, songFile, exportFormats, from, renderPictures} = run
    ////////// RENDERING WITH COMFYUI
    if (render.has('images') || render.has('videos') || retake) {
        const only = new Set(args.only.split(',').filter(Boolean))
        using renderer = new Renderer(project.id, project.dir, config, settings.comfy)
        renderer.refresh = refreshKinds
        log.section('13 · RENDERING WITH COMFYUI')
        log.step(
            'Config',
            styles.muted(
                `seed ${config.seed}, images ${config.imageResolution} (${config.imageWorkflow}), video ${config.videoResolution} (${config.videoWorkflow})${config.sequenceSheets ? `, sequence sheets (${config.sequenceWorkflow})` : ''}`,
            ),
        )
        log.step('Servers', `${settings.comfy.map(s => `${styles.name(s.name)} ${styles.muted(s.url)}`).join(', ')} ${from(settings.sources.comfy)}`)
        if (args.again || refreshKinds.size || retake || args['picture-anchor']) await renderer.serversFirst()

        if (retake) {
            const clip = clips.find(c => c.id === retake.clip)
            if (!clip) throw new Error(`--retake: no clip ${retake.clip} - the clips are ${clips.map(c => c.id).join(', ')}`)
            await renderer.renderClipRetake(clip, stemFiles, retake)
        }

        // everything at once - the renderer runs one job per server and queues the rest
        if (render.has('images')) await renderPictures(renderer, pictures)
        // clips need all their pictures, so they start after the pictures - free the image model's VRAM first
        if (render.has('videos')) {
            if (render.has('images')) await renderer.freeMemory()
            const selected = onlyClips(clips, only)
            log.step('Clips', `${selected.length}${only.size ? styles.muted(` of ${clips.length} (--only)`) : ''}`)
            // on request, and only for the clips named: the old version is put away in old/attempts/, then the clip is rendered again
            if (args.again) {
                warnFixedSeed(config.seed)
                const stamp = versionStamp()
                for (const clip of selected) {
                    const keep = archiveFiles(
                        project.dir,
                        `${clip.id}${args.preview ? '-preview' : ''}-${stamp}`,
                        args.preview
                            ? [join('previews', `${clip.id}.mp4`), join('previews', `${clip.id}.mp4.json`)]
                            : [
                                  join('videos', `${clip.id}.mp4`),
                                  join('videos', `${clip.id}.mp4.json`),
                                  boundaryFrameAsset(clip.id, 'ff'),
                                  boundaryFrameAsset(clip.id, 'lf'),
                              ],
                    )
                    log.step('Again', `${clip.id} ${styles.muted(`- the old one is in ${keep}`)}`)
                    recordTiming({kind: 'clip', name: config.videoWorkflow, seconds: 0, outcome: 'again', reason: 'again'})
                }
                // a preview leaves no last frame behind - the clips after it are not affected
                if (!args.preview) warnClipsGoingOn(selected, clips)
            }
            const clipFolder = args.preview ? 'previews' : 'videos'
            const todoClips = selected.filter(c => args.again || !existsSync(join(project.dir, clipFolder, `${c.id}.mp4`)))
            log.step(
                'Estimate',
                styles.muted(
                    await clipEstimate(
                        todoClips,
                        config,
                        settings.comfy.map(server => server.name),
                    ),
                ),
            )
            for (const risk of clipFailureRisks(
                readTimings(),
                todoClips,
                config.videoWorkflow,
                settings.comfy.map(server => server.name),
            ))
                log.warn(risk)
            // a clip that starts on the last frame of the one before waits for it: those clips render one after the other,
            // each chain next to the others
            // the jobs an earlier run left queued on a server get it before any new clip does (#335) - the head of each chain
            // asks for a server at once; a later clip of a chain waits for the one before it and holds nothing
            const chains = clipChains(selected)
            const videoOf = (c: {id: string}) => join(project.dir, clipFolder, `${c.id}.mp4`)
            // what this run renders, for the workspace to count the jobs that are done (#829)
            runEvent({type: 'jobs', kind: 'clip', ids: todoClips.map(c => c.id)})
            await renderer.announceResumes(
                chains
                    .map(chain => chain[0]!)
                    .filter(c => todoClips.includes(c))
                    .map(videoOf),
            )
            await renderAll(chains, async chain => {
                try {
                    for (const clip of chain) await renderer.renderClip(clip, stemFiles, args.preview)
                } finally {
                    // a clip that ends without asking for a server (it exists, it is skipped, it failed early) holds none
                    renderer.settle(videoOf(chain[0]!))
                }
            })
        }
    }

    ////////// ASSEMBLING THE FINAL VIDEO
    if (render.has('final') && args.preview) {
        // a quick look at cut, timing and continuity: from the previews, without the finish or another frame rate, and never the final video
        log.section('14 · THE PREVIEW VIDEO')
        const target = join(project.dir, `${project.id}-preview.mp4`)
        const result = await assembleFinal({
            clips,
            projectDir: project.dir,
            songFile,
            songAudio: config.songAudio,
            target,
            sources: await previewSources(project.dir, clips),
        })
        log.step('Saved', `${target} ${styles.muted(`${result.width}x${result.height}, ${result.frames} frames, ${result.seconds.toFixed(3)}s`)}`)
    } else if (render.has('final')) {
        log.section('14 · ASSEMBLING THE FINAL VIDEO')
        log.step('Audio', config.songAudio ? 'original song' : styles.muted('the clips\' own audio ("songAudio": false)'))
        const target = join(project.dir, `${project.id}.mp4`)
        // a clip made from another request than the plan has now is still a clip: said here, an error only with --strict
        const stale = clips
            .filter(c => freshness(join(project.dir, 'videos', `${c.id}.mp4`), clipFingerprint(c, project.dir, config)) === 'stale')
            .map(c => c.id)
        if (stale.length) {
            const message = `${stale.length} clip(s) were made from another prompt, picture or start frame than the plan has now: ${formatSlotRanges(stale)} - render them again with --render=videos --refresh=clips`
            if (args.strict) throw new Error(message)
            log.warn(message)
        }
        const result = await assembleFinal({clips, projectDir: project.dir, songFile, songAudio: config.songAudio, target})
        log.step('Saved', `${target} ${styles.muted(`${result.width}x${result.height}, ${result.frames} frames, ${result.seconds.toFixed(3)}s`)}`)
        // the light grade and sharpen ("finish"): a copy next to each final video, which itself stays as it is
        const finishing = finishOf(config.finish)
        // where each clip is in the final video - the same seconds at every frame rate
        const spans = clips.map(c => ({id: c.id, start: secondsAt(c.frameStart), end: secondsAt(c.frameStart + c.frames)}))
        if (finishing) await finishCopy(target, finishing, spans)

        // a second video at another frame rate ("finalFps"): every clip gets more frames on ComfyUI, shot by shot (lib/final-pass.ts)
        if (config.finalFps !== FPS) {
            using smoother = new Renderer(project.id, project.dir, config, settings.comfy)
            const {files, multiplier} = await interpolateClips(smoother, clips, config.interpolationModel, config.finalFps)
            const smooth = join(project.dir, `${project.id}-${config.finalFps}fps.mp4`)
            const more = await assembleFinal({
                clips,
                projectDir: project.dir,
                songFile,
                songAudio: config.songAudio,
                target: smooth,
                interpolated: {files, multiplier, fps: config.finalFps},
            })
            log.step(
                'Saved',
                `${smooth} ${styles.muted(`${more.width}x${more.height}, ${more.frames} frames at ${config.finalFps} fps, ${more.seconds.toFixed(3)}s`)}`,
            )
            if (finishing) await finishCopy(smooth, finishing, spans)
        }
    }

    ////////// EXPORTING THE TIMELINE FOR A VIDEO EDITOR
    if (exportFormats.length) {
        log.section('15 · EXPORTING THE TIMELINE')
        const written = await exportTimelines({
            formats: exportFormats as ExportFormat[],
            clips,
            projectDir: project.dir,
            projectName: project.id,
            songFile,
            songAudio: config.songAudio,
        })
        for (const [format, file] of Object.entries(written)) log.step(format === 'mlt' ? 'Shotcut / Kdenlive' : 'OpenShot', file)
    }
}
