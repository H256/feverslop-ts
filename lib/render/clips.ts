import {existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync} from 'node:fs'
import {basename, dirname, extname, join, relative} from 'node:path'
import {recordTiming} from '../timings.ts'
import {log, styles} from '../log.ts'
import {type AudioWorkflow, clipSeed, resolveSeed, type VideoWorkflowModule, type WorkflowResult} from '../../comfy/helpers.ts'
import {boundaryFrameAsset, type ClipRequest, CONTEXT_SETTLE} from '../compose.ts'
import {secondsAt} from '../frames.ts'
import {type AudioPrints, LIPSYNC_DIR, type LipsyncClip, lipsyncFile, lipsyncFingerprint, recordedLipsync} from '../lipsync.ts'
import {fingerprint} from '../provenance.ts'
import {extractFrame, framesOnGrid, probeVideo, trimHead} from '../assemble.ts'
import {backdropSeconds, hasBackdropRun} from '../leak.ts'
import {bestTake, checkClip, describe as describeFindings, type Finding} from '../clip-qa.ts'
import {clipSpec, type RenderSpec, songSpec, specId} from '../render-spec.ts'
import {matchColors} from '../colormatch.ts'
import {archiveFiles, versionStamp} from '../archive.ts'
import {runProcess} from '../process.ts'
import {produceMedia} from '../media-file.ts'
import {clipRequestRef} from '../previous-output.ts'
import {
    type Renderer,
    DEFAULT_SONG_DURATION,
    loadWorkflow,
    contextLength,
    stepOptions,
    type RenderWhat,
    type ClipContext,
    type Wan2gpPrepared,
} from '../render.ts'
import {WAN2GP_SEEDS, wan2gpClipSettings} from '../wan2gp-clip.ts'
import {wan2gpPictureOrder} from '../wan2gp-prompt.ts'
import {sequenceSheetDir, sheetAnchor} from '../sequenceSheet.ts'
import {pixelSize, type PixelSize} from '../../comfy/helpers.ts'

// The work of a Renderer (lib/render.ts, #841): the clips and the song: a clip, its preview, its takes and retries, the frames it goes on from. The renderer keeps the state; these take it as `r`.

export async function renderSong(r: Renderer, brief: {style: string; lyrics: string}, songFile: string) {
    if (existsSync(songFile)) return log.step('Exists', styles.muted('input/song.wav'))
    // not input/song.mp3: that name is where a song the user supplied by hand lives, and the download is
    // deleted after the conversion. ffmpeg detects mp3 or flac from the content, the extension is irrelevant.
    const downloaded = songFile.replace(/\.wav$/, '.generated.audio')

    const {seed, duration} = await r.render(
        {label: 'song', spec: songSpec(brief, r.config), kind: 'song', workflow: r.config.songWorkflow},
        downloaded,
        ['.mp3', '.flac'],
        async () => {
            const seed = resolveSeed(r.config.seed)
            const duration = r.config.songDuration === -1 ? DEFAULT_SONG_DURATION : r.config.songDuration
            const {default: audioWorkflow} = await loadWorkflow<{default: AudioWorkflow}>(r.config.songWorkflow)
            const result = audioWorkflow({
                style: brief.style,
                lyrics: brief.lyrics,
                seed,
                duration,
                filenamePrefix: `${r.remoteDir}/song`,
            })
            return {result, uploads: [], meta: {seed, duration}}
        },
    )

    await produceMedia(songFile, partial =>
        runProcess(['ffmpeg', '-y', '-v', 'error', '-i', downloaded, '-c:a', 'pcm_s16le', partial], {
            errorMessage: err => `ffmpeg failed to convert the generated song to wav:\n${err}`,
        }),
    )
    rmSync(downloaded)
    await Bun.write(`${songFile}.json`, JSON.stringify({workflow: r.config.songWorkflow, seed, duration, style: brief.style, lyrics: brief.lyrics}, null, 2))
    log.step('Saved', 'input/song.wav')
}

export async function renderClip(r: Renderer, clip: ClipRequest, stemFiles: Record<string, string>, preview = false) {
    if (preview) return r.renderClipPreview(clip, stemFiles)
    const file = `videos/${clip.id}.mp4`
    const target = join(r.projectDir, file)
    const spec = clipSpec(clip, r.projectDir, r.config)
    const request = specId(spec)
    const away = [file, `${file}.json`, boundaryFrameAsset(clip.id, 'ff'), boundaryFrameAsset(clip.id, 'lf')]
    if (existsSync(target) && !r.staleFile('clips', file, request, away)) {
        log.step('Exists', styles.muted(file))
        // it starts on the last frame of the clip before - rendered again since, that frame is another one
        const startFrame = clip.startsFrom ? join(r.projectDir, boundaryFrameAsset(clip.startsFrom, 'lf')) : undefined
        if (startFrame && existsSync(startFrame) && statSync(startFrame).mtimeMs > statSync(target).mtimeMs) {
            log.warn(`${file} starts on an older version of ${clip.startsFrom}'s last frame - delete it to render it again`)
        }
        // clips rendered before the boundary frames existed get them now
        return r.saveBoundaryFrames(clip, target)
    }

    const missing = clip.assets.pictures.filter(p => !existsSync(join(r.projectDir, p.file)))
    if (missing.some(p => p.kind === 'frame'))
        return log.warn(
            `${clip.id} skipped - it starts on the last frame of ${clip.startsFrom}, which is not rendered yet (${missing.find(p => p.kind === 'frame')!.file})`,
        )
    if (missing.length) return log.warn(`${clip.id} skipped - missing pictures: ${missing.map(p => p.file).join(', ')}`)
    const missingStems = clip.assets.audio.filter(a => !(a.stem && stemFiles[a.stem] && existsSync(stemFiles[a.stem]!)))
    if (missingStems.length) return log.warn(`${clip.id} skipped - missing stem file(s) for: ${missingStems.map(a => a.stem).join(', ')}`)
    if (!(stemFiles.song && existsSync(stemFiles.song))) return log.warn(`${clip.id} skipped - missing the full song (needed for MiniMaxH3AddGuide)`)

    // a seed given: a take again with a derived one (checkTakes), else the clip's own
    const prepare = async (forced?: number) => {
        // Upload the whole separated stem per track (not a per-clip cut) and let the workflow trim it to
        // this clip's span itself (TrimAudioDuration) - a pre-cut file can't account for the video model
        // rounding the render length up past clip.frames (see comfy/workflows/h3-ref2video.ts). The full,
        // unseparated song goes up too, always - MiniMaxH3AddGuide locks it into the AV latent so every
        // instrument gets some real audio grounding, not just the isolated tracks a character's own prop
        // happens to need (an idle instrument otherwise has no audio backing its idle prompt text at all).
        // song can be a hand-supplied song.mp3 or song.flac as well as the usual wav - keep its real extension on upload,
        // LoadAudio needs it to demux correctly
        const {uploads, songRemote, audios, vocals} = clipInputs(r, clip, stemFiles, true)
        const seed = forced ?? clipSeed(r.config.seed, clip.id)
        const {default: videoWorkflow, renderFrames, recommendedResolution} = await loadWorkflow<VideoWorkflowModule>(r.config.videoWorkflow)
        r.noteResolution(recommendedResolution)

        // Render at least the clip's frames, in a length the model accepts. The audio starts exactly on
        // the clip's first frame and covers the whole render, so the extra frames at the end follow the
        // real song too - they are cut off again when the final video is assembled.
        // context frames: the last frames of the clip before go in at the start, the render begins that much earlier
        const lead = context ? context.frames + CONTEXT_SETTLE : 0
        const frames = renderFrames?.(clip.frames + lead) ?? clip.frames + lead
        if (frames < clip.frames + lead) throw new Error(`${r.config.videoWorkflow}: renderFrames(${clip.frames + lead}) returned only ${frames} frames`)
        if (context) uploads.push({from: context.file, to: `${r.remoteDir}/${context.asset}`})
        const result = videoWorkflow({
            prompt: clip.prompt,
            // a pinned first frame (config.pinStartFrame) goes in as the guide only - as a reference picture too it is blended in twice
            pictures: clip.assets.pictures.filter(p => !((r.config.pinStartFrame || context) && p.kind === 'frame')).map(p => `${r.remoteDir}/${p.file}`),
            audios,
            ...vocals,
            // the full mix, locked into the AV latent via MiniMaxH3AddGuide - see comfy/workflows/h3-ref2video.ts
            song: songRemote,
            ...(context
                ? {startClip: `${r.remoteDir}/${context.asset}`}
                : r.config.pinStartFrame && clip.startsFrom
                  ? {startFrame: `${r.remoteDir}/${boundaryFrameAsset(clip.startsFrom, 'lf')}`}
                  : {}),
            songStart: secondsAt(clip.frameStart - lead),
            frames,
            duration: secondsAt(frames),
            seed,
            resolution: r.config.videoResolution,
            aspect: r.config.videoAspect,
            ...stepOptions(r.config),
            filenamePrefix: `${r.remoteDir}/videos/${clip.id}`,
        })
        return {result, uploads, meta: {seed, ...(result.size ? {size: result.size} : {})}}
    }
    // context frames (config.contextFrames): the tail of the clip before, cut out now so the job is made from it
    const context = clip.startsFrom && r.config.contextFrames > 0 ? await r.contextOf(clip.startsFrom, r.config.contextFrames) : undefined
    const what: RenderWhat = {label: `clip ${clip.id}`, spec, kind: 'clip', workflow: r.config.videoWorkflow, resolution: r.config.videoResolution}
    // its wan2gp form, for a wan2gp server (#1204): only when config.json names the template; the takes and retries after it stay as they were
    const wan2gp = r.config.renderEngine === 'wan2gp' ? () => wan2gpForm(r, clip, stemFiles, !!context) : undefined
    let {seed, size: expected} = await r.render(what, target, '.mp4', prepare, wan2gp)
    seed = await r.retryLeaks(what, clip.id, file, seed, prepare, `bun run leak-scan ${r.projectId} lists it again`)
    if (context) await r.joinContext(target, clip.id, clip.startsFrom!, context)
    seed = await r.checkTakes(clip.id, file, seed, clip, async derived => {
        const taken = (await r.render(what, target, '.mp4', () => prepare(derived))).seed
        if (context) await r.joinContext(target, clip.id, clip.startsFrom!, context)
        return taken
    })
    const rendered = await probeVideo(target)
    // every server has to deliver the size asked for - a clip of another size is scaled in the final video. The sizes
    // are computed by the workflow file, not by the server (comfy/helpers.ts, pixelSize); what still comes out at
    // another size is put away and fails, instead of being used
    if (expected && (rendered.width !== expected.width || rendered.height !== expected.height)) {
        await Bun.write(
            `${target}.json`,
            JSON.stringify(
                {
                    workflow: r.config.videoWorkflow,
                    seed,
                    fingerprint: request,
                    renderedFrames: rendered.frames,
                    size: `${rendered.width}x${rendered.height}`,
                    rejected: 'size',
                },
                null,
                2,
            ),
        )
        const keep = archiveFiles(r.projectDir, `size-${versionStamp()}-${file.replace(/[\/]/g, '-')}`, [
            file,
            `${file}.json`,
            boundaryFrameAsset(clip.id, 'ff'),
            boundaryFrameAsset(clip.id, 'lf'),
        ])
        throw new Error(
            `${file} came out at ${rendered.width}x${rendered.height}, ${r.config.videoWorkflow} renders ${JSON.stringify(r.config.videoResolution)} (${r.config.videoAspect}) at ${expected.width}x${expected.height} - put away in ${keep}; the server that rendered it computes another size`,
        )
    }
    if (rendered.frames < clip.frames) log.warn(`${file} has ${rendered.frames} frames, the clip needs ${clip.frames} - delete it and render again`)
    await Bun.write(
        `${target}.json`,
        JSON.stringify(
            {
                workflow: r.config.videoWorkflow,
                seed,
                resolution: r.config.videoResolution,
                ...(r.config.videoAspect !== '16:9' ? {aspect: r.config.videoAspect} : {}),
                ...(r.config.videoSteps !== -1 ? {steps: r.config.videoSteps} : {}),
                ...(r.config.videoRefineSteps !== -1 ? {refineSteps: r.config.videoRefineSteps} : {}),
                ...(clip.startsFrom ? {startsFrom: clip.startsFrom} : {}),
                // started on the last frames of the clip before, its head cut off - as the film's sidecar says it (lib/film/render.ts)
                ...(context ? {contextFrames: context.frames} : {}),
                frameStart: clip.frameStart,
                frames: clip.frames, // used in the final video
                fingerprint: request, // what it was made from (lib/provenance.ts) - another one now makes it stale
                renderedFrames: rendered.frames,
                size: `${rendered.width}x${rendered.height}`,
                request: clipRequestRef(clip.id),
            },
            null,
            2,
        ),
    )
    log.step('Saved', `${file} ${styles.muted(`${rendered.frames} frames, ${clip.frames} used · ${r.took(target)}`)}`)
    await r.saveBoundaryFrames(clip, target, rendered.frames)
}

/** The job of a music-video clip, or of a part of it: the same pictures, stems and song, from `songStart` on. */
export async function clipJob(
    r: Renderer,
    clip: ClipRequest,
    stemFiles: Record<string, string>,
    job: {
        prompt: string
        songStart: number
        frames: number
        seed: number
        startFrame?: string
        startClip?: string
        endFrame?: {image: string; at: number}
        preview?: {scale: number; steps?: number}
        filenamePrefix: string
        extraUploads?: {from: string; to: string}[]
        workflow: VideoWorkflowModule
    },
) {
    const {uploads, songRemote, audios, vocals} = clipInputs(r, clip, stemFiles, false)
    uploads.push(...(job.extraUploads ?? []))
    const result = job.workflow.default({
        prompt: job.prompt,
        pictures: clip.assets.pictures.filter(p => p.kind !== 'frame').map(p => `${r.remoteDir}/${p.file}`),
        audios,
        ...vocals,
        song: songRemote,
        ...(job.startClip ? {startClip: job.startClip} : job.startFrame ? {startFrame: job.startFrame} : {}),
        ...(job.endFrame ? {endFrame: job.endFrame} : {}),
        ...(job.preview ? {preview: job.preview} : {}),
        songStart: job.songStart,
        frames: job.frames,
        duration: secondsAt(job.frames),
        seed: job.seed,
        resolution: r.config.videoResolution,
        aspect: r.config.videoAspect,
        ...stepOptions(r.config),
        filenamePrefix: job.filenamePrefix,
    })
    return {result, uploads, meta: {seed: job.seed}}
}

/**
 * A clip as a cheap render into previews/ (--preview): never a file of videos/, it leaves no first or last frame behind and stays out of
 * what is current or stale of the clips - its own record has the request it was made from, so the page can say whether it is the plan's. A clip that goes on from another starts on the last frame of that one's preview or render, and says it is approximate.
 */
export async function renderClipPreview(r: Renderer, clip: ClipRequest, stemFiles: Record<string, string>) {
    const file = `previews/${clip.id}.mp4`
    const target = join(r.projectDir, file)
    // what it is made from, as a clip's own render records it: one of an older plan is made again with --refresh=videos (#1117)
    const request = specId(clipSpec(clip, r.projectDir, r.config))
    if (existsSync(target) && !r.staleFile('clips', file, request, [file, `${file}.json`])) return log.step('Exists', styles.muted(file))
    const missing = clip.assets.pictures.filter(p => p.kind !== 'frame' && !existsSync(join(r.projectDir, p.file)))
    if (missing.length) return log.warn(`${clip.id}: no preview - missing pictures: ${missing.map(p => p.file).join(', ')}`)
    if (!(stemFiles.song && existsSync(stemFiles.song))) return log.warn(`${clip.id}: no preview - missing the full song`)
    const start = clip.startsFrom ? await r.previewStart(clip.startsFrom) : undefined
    if (clip.startsFrom && !start) return log.warn(`${clip.id}: no preview - it goes on from ${clip.startsFrom}, which has neither a preview nor a render yet`)
    const preview = r.config.preview
    const spec: RenderSpec = {
        ...clipSpec(clip, r.projectDir, r.config),
        parts: ['preview', preview, clip.prompt, clip.frames, r.config.videoWorkflow, start ?? ''],
    }
    const what: RenderWhat = {label: `preview ${clip.id}`, spec, kind: 'clip', workflow: r.config.videoWorkflow, resolution: `preview ${preview.scale}`}
    mkdirSync(dirname(target), {recursive: true})
    const {seed} = await r.render(what, target, '.mp4', async () => {
        const workflow = await loadWorkflow<VideoWorkflowModule>(r.config.videoWorkflow)
        r.noteResolution(workflow.recommendedResolution)
        const frames = workflow.renderFrames?.(clip.frames) ?? clip.frames
        const remote = start && `${r.remoteDir}/${start}`
        return r.clipJob(clip, stemFiles, {
            prompt: clip.prompt,
            songStart: secondsAt(clip.frameStart),
            frames,
            seed: clipSeed(r.config.seed, clip.id),
            preview,
            workflow,
            filenamePrefix: `${r.remoteDir}/previews/${clip.id}`,
            ...(start ? {startFrame: remote, extraUploads: [{from: join(r.projectDir, start), to: remote!}]} : {}),
        })
    })
    // what it was made from, as a clip's own render records it: the page says whether the preview still is the plan's (#1117)
    await r.savePreviewRecord(clip, target, seed, request)
}

/** The picture a preview starts on: the last frame of the clip before as the preview shows it - its preview, else its render. */
export async function previewStart(r: Renderer, id: string): Promise<string | undefined> {
    const source = [`previews/${id}.mp4`, `videos/${id}.mp4`].find(file => existsSync(join(r.projectDir, file)))
    if (!source) return undefined
    const video = join(r.projectDir, source)
    // a sidecar that is half written (a run stopped in the middle of it) is no sidecar: the video's own frames count
    let record: {frames?: number} = {}
    try {
        if (existsSync(`${video}.json`)) record = JSON.parse(readFileSync(`${video}.json`, 'utf8')) as {frames?: number}
    } catch {
        // read as nothing
    }
    const frames = Math.min(record.frames ?? Infinity, framesOnGrid(await probeVideo(video)))
    const frame = `previews/${id}_lf.png`
    mkdirSync(join(r.projectDir, 'previews'), {recursive: true})
    await extractFrame(video, frames - 1, join(r.projectDir, frame))
    return frame
}

export async function savePreviewRecord(r: Renderer, clip: {id: string; frames: number; startsFrom?: string}, target: string, seed: number, request?: string) {
    const rendered = await probeVideo(target)
    await Bun.write(
        `${target}.json`,
        JSON.stringify(
            {
                preview: true,
                workflow: r.config.videoWorkflow,
                seed,
                ...(request ? {fingerprint: request} : {}),
                ...r.config.preview,
                ...(clip.startsFrom ? {approximate: true, startsFrom: clip.startsFrom} : {}),
                frames: clip.frames,
                renderedFrames: rendered.frames,
                size: `${rendered.width}x${rendered.height}`,
            },
            null,
            2,
        ),
    )
    log.step(
        'Saved',
        `previews/${clip.id}.mp4 ${styles.muted(`${rendered.width}x${rendered.height}, ${clip.frames} frames${clip.startsFrom ? ' - approximate' : ''} · ${r.took(target)}`)}`,
    )
}

/**
 * A clip that came out as the reference pictures lined up on their grey backdrop depends on the seed: the one that did
 * is put away (old/leaks/) and the clip rendered again, up to config.leakRetries times. Returns the seed of the clip
 * kept. `rescan`: what the warning says finds it again - the music video's and the film's clips.
 */
export async function retryLeaks<M extends {seed: number}>(
    r: Renderer,
    what: RenderWhat,
    id: string,
    file: string,
    seed: number,
    prepare: () => Promise<{result: WorkflowResult; uploads: {from: string; to: string}[]; meta: M}>,
    rescan: string,
): Promise<number> {
    const target = join(r.projectDir, file)
    for (let tries = 0; r.config.leakRetries > 0; tries++) {
        const leaked = await backdropSeconds(target)
        if (!hasBackdropRun(leaked)) break
        const where = `${leaked.length} sample(s) between ${leaked[0]!.toFixed(1)} and ${leaked.at(-1)!.toFixed(1)} s`
        if (r.config.seed !== -1) {
            log.warn(
                `${file} has a grey studio backdrop (${where}) - the seed is fixed in config.json, so rendering it again gives the same clip. Use "seed": -1, or --again with another seed`,
            )
            break
        }
        const put = join(r.projectDir, 'old', 'leaks', `${id}-seed-${seed}.mp4`)
        if (tries >= r.config.leakRetries) {
            log.warn(`${file} still has a grey studio backdrop (${where}) after ${tries} more render(s) - kept as it is, ${rescan}`)
            break
        }
        mkdirSync(dirname(put), {recursive: true})
        renameSync(target, put)
        recordTiming({kind: 'clip', name: r.config.videoWorkflow, seconds: 0, outcome: 'retry', reason: 'leak'})
        log.warn(
            `${file} has a grey studio backdrop (${where}) - rendered again with another seed (${tries + 1} of ${r.config.leakRetries}); the first one is in ${styles.muted(`old/leaks/${basename(put)}`)}`,
        )
        seed = (await r.render(what, target, '.mp4', prepare)).seed
    }
    return seed
}

/**
 * What else a clip came out with (lib/clip-qa.ts): black frames, a picture that stands still, a jump its plan has no cut for - in
 * the frames the video shows. Measured on every clip and kept next to it (videos/<id>.checks.json). A jump is only said: our clips
 * jump at their planned cuts a little early or late, and a retry for it would cost a render for little. With config.qaRetries a
 * clip with black or standing frames is rendered again with a derived seed (seed + 7919·k, not a new random one), and the better
 * take kept - the other is put away in old/qa/. `again`: the clip rendered (and its head cut) with that seed. Returns the seed
 * of the take kept.
 */
export async function checkTakes(
    r: Renderer,
    id: string,
    file: string,
    seed: number,
    clip: {frames: number; shots: {at: number}[]},
    again: (seed: number) => Promise<number>,
): Promise<number> {
    const target = join(r.projectDir, file)
    const cuts = clip.shots.map(s => s.at).filter(at => at > 0)
    const hard = (findings: Finding[]) => findings.filter(f => f.kind !== 'cut')
    const shown = (folder: string) => relative(r.projectDir, folder).replace(/\\/g, '/')
    const best = await bestTake({
        target,
        seed,
        retries: r.config.qaRetries,
        check: () => checkClip(target, cuts, clip.frames),
        again: async derived => {
            recordTiming({kind: 'clip', name: r.config.videoWorkflow, seconds: 0, outcome: 'retry', reason: 'qa'})
            return again(derived)
        },
        putAway: takeSeed => join(r.projectDir, 'old', 'qa', `${id}-seed-${takeSeed}`),
        said: event =>
            event.kind === 'again'
                ? log.warn(
                      `${file} has ${describeFindings(event.findings)} - rendered again with seed ${event.seed} (${event.attempt} of ${r.config.qaRetries}); this take is in ${styles.muted(shown(event.put))}`,
                  )
                : log.step(
                      'Kept',
                      `${file} ${styles.muted(`the take with seed ${event.seed} - the one with seed ${event.worse} has ${describeFindings(event.findings) || 'more found'}, it is in ${shown(event.put)}`)}`,
                  ),
    })
    seed = best.seed
    const findings = best.findings
    if (hard(findings).length)
        log.warn(
            `${file} has ${describeFindings(hard(findings))}${r.config.qaRetries ? ' - kept as the best take' : ' - "qaRetries": 1 in config.json renders such a clip again with another seed'}`,
        )
    const jumps = findings.filter(f => f.kind === 'cut')
    if (jumps.length) log.line(styles.muted(`        · ${id}: ${describeFindings(jumps)} where the plan has no cut - look at it if it matters`))
    writeFileSync(target.replace(/\.mp4$/, '.checks.json'), JSON.stringify({version: 1, seed, findings}, null, 2))
    return seed
}

/**
 * The head of a clip rendered with context frames is the clip before again: cut off, so the file starts on this clip's
 * own first frame like every other one.
 */
export async function joinContext(r: Renderer, target: string, id: string, startsFrom: string, context: ClipContext) {
    await trimHead(target, context.frames + CONTEXT_SETTLE)
    // drawn on its own, the clip has its own exposure: matched as a whole to the last frames of the clip before, so
    // the cut that is no cut shows no step in brightness or color (lib/colormatch.ts)
    const filter = await matchColors(target, context.video, context.used - 4, context.used - 1)
    log.line(styles.muted(`        · ${id}: colors matched to ${startsFrom} - ${filter}`))
}

/**
 * `wanted` frames of the end of the clip `id`, as a short video for the guide of the next clip: they end CONTEXT_SETTLE
 * frames before the last frame the clip gives the final video - those are drawn again after the batch and cut off with
 * the head, so the flash right after the batch is never seen. Fewer when the clip is shorter (5 + 17·k, at least 5).
 * undefined when the clip is not rendered: the next clip is skipped. `shown`: the frames of it the final video shows,
 * when that is not the `frames` of its sidecar (a film clip with dialogue shows all it has).
 */
export async function contextOf(r: Renderer, id: string, wanted: number, shown?: number): Promise<ClipContext | undefined> {
    const video = join(r.projectDir, 'videos', `${id}.mp4`)
    const sidecar = `${video}.json`
    if (!existsSync(video) || !existsSync(sidecar)) return undefined
    let used = shown
    if (used === undefined) {
        try {
            used = (JSON.parse(readFileSync(sidecar, 'utf8')) as {frames: number}).frames
        } catch {
            return undefined // a half-written sidecar: no context rather than a throw
        }
    }
    const frames = contextLength(wanted, used)
    if (!frames) return undefined
    const asset = `assets/clips/${id}_tail${frames}.mp4`
    const file = join(r.projectDir, asset)
    mkdirSync(dirname(file), {recursive: true})
    await runProcess(
        [
            'ffmpeg',
            '-y',
            '-v',
            'error',
            '-i',
            video,
            '-vf',
            `trim=start_frame=${used - CONTEXT_SETTLE - frames}:end_frame=${used - CONTEXT_SETTLE},setpts=PTS-STARTPTS`,
            '-an',
            '-c:v',
            'libx264',
            '-crf',
            '10',
            '-pix_fmt',
            'yuv420p',
            file,
        ],
        {errorMessage: err => `ffmpeg could not cut the last ${frames} frames of ${id}:\n${err}`},
    )
    return {file, asset, frames, video, used}
}

export async function saveBoundaryFrames(r: Renderer, clip: {id: string; frames: number}, video: string, renderedFrames?: number) {
    const [first, last] = [boundaryFrameAsset(clip.id, 'ff'), boundaryFrameAsset(clip.id, 'lf')]
    if (renderedFrames === undefined && existsSync(join(r.projectDir, first)) && existsSync(join(r.projectDir, last))) return
    mkdirSync(join(r.projectDir, dirname(first)), {recursive: true})
    const frames = r.framesUsed(clip, renderedFrames ?? (await probeVideo(video)).frames)
    await extractFrame(video, 0, join(r.projectDir, first))
    await extractFrame(video, frames - 1, join(r.projectDir, last))
    log.step('Saved', `${first}, ${last} ${styles.muted(`frames 0 and ${frames - 1}`)}`)
}

/** How many frames of the file the video uses. A clip rendered too short (warned about above) ends on its own last frame. */
export function framesUsed(r: Renderer, clip: {frames: number}, available: number) {
    return Math.min(clip.frames, available)
}

/**
 * The lip-sync preview of one clip of the cut (lib/lipsync.ts): a render of the configured video workflow at config.lipsyncScale of its
 * pixels, its own steps - only the size is smaller, so the latents and the work are. The vocals stem and the full song go in as in a real
 * clip. It is a file of previews/lipsync/, never of videos/ or previews/: nothing real goes stale by it. One made from another request
 * (the prompt, the cut, the size, the audio) is put away and rendered again; the same one is left as it is.
 */
export async function renderLipsync(
    r: Renderer,
    clip: LipsyncClip,
    stemFiles: Record<string, string>,
    prints: AudioPrints,
    {scale, again = false}: {scale: number; again?: boolean},
) {
    const file = lipsyncFile(clip.id)
    const target = join(r.projectDir, file)
    const request = fingerprint(...lipsyncFingerprint(clip, {...r.config, lipsyncScale: scale}, prints))
    const made = recordedLipsync(target)
    if (!again && made?.fingerprint === request) return log.step('Exists', styles.muted(file))
    if (!(stemFiles[clip.track] && existsSync(stemFiles[clip.track]!)))
        return log.warn(`${clip.id}: no lip-sync preview - missing the ${clip.track === 'song' ? 'full song' : `${clip.track} stem`}`)
    if (!(stemFiles.song && existsSync(stemFiles.song))) return log.warn(`${clip.id}: no lip-sync preview - missing the full song`)
    if (existsSync(target)) {
        const keep = archiveFiles(r.projectDir, `${clip.id}-lipsync-${versionStamp()}`, [file, `${file}.json`])
        log.step('Again', `${clip.id} ${styles.muted(`- the old one is in ${keep}`)}`)
    }
    const spec: RenderSpec = {kind: 'clip', id: `lipsync-${clip.id}`, parts: [request]}
    const what: RenderWhat = {
        label: `lip-sync preview ${clip.id}`,
        spec,
        kind: 'clip',
        workflow: r.config.videoWorkflow,
        resolution: `lipsync ${scale}`,
    }
    mkdirSync(dirname(target), {recursive: true})
    // what clipJob takes of a clip: the audio tracks to upload - the dummy has no picture
    const asClip = {
        assets: {pictures: [], audio: [{label: '<Audio 1>', file: '', songStart: clip.start, songEnd: clip.end, stem: clip.track}]},
    } as unknown as ClipRequest
    const {seed} = await r.render(what, target, '.mp4', async () => {
        const workflow = await loadWorkflow<VideoWorkflowModule>(r.config.videoWorkflow)
        r.noteResolution(workflow.recommendedResolution)
        const frames = workflow.renderFrames?.(clip.frames) ?? clip.frames
        return r.clipJob(asClip, stemFiles, {
            prompt: clip.prompt,
            songStart: secondsAt(clip.frameStart),
            frames,
            seed: clipSeed(r.config.seed, clip.id),
            // the scale only: the steps are the ones the workflow and config.json have
            preview: {scale: scale},
            workflow,
            filenamePrefix: `${r.remoteDir}/${LIPSYNC_DIR}/${clip.id}`,
        })
    })
    const rendered = await probeVideo(target)
    await Bun.write(
        `${target}.json`,
        JSON.stringify(
            {
                lipsync: true,
                workflow: r.config.videoWorkflow,
                seed,
                scale: scale,
                fingerprint: request,
                frameStart: clip.frameStart,
                frames: clip.frames,
                renderedFrames: rendered.frames,
                size: `${rendered.width}x${rendered.height}`,
            },
            null,
            2,
        ),
    )
    log.step('Saved', `${file} ${styles.muted(`${rendered.width}x${rendered.height}, ${clip.frames} frames · ${r.took(target)}`)}`)
} /**
 * What a music-video clip's job puts on the server and names to its workflow (#1008): its pictures (the frame pictures only when
 * `withFrames`), one whole stem per track and the full song under its real extension - the same for a render, a preview and a retake.
 */
/**
 * A clip in its wan2gp form (#1204): the same prompt and pictures, its stems cut here to the clip's span (wan2gp takes them as audio
 * references, not whole songs to trim), the size the ComfyUI workflow would render at. The whole song as a guide has no counterpart.
 */
async function wan2gpForm(
    r: Renderer,
    clip: ClipRequest,
    stemFiles: Record<string, string>,
    context: boolean,
): Promise<Wan2gpPrepared<{seed: number; size?: PixelSize}>> {
    const template = r.config.videoWorkflowWan2gp!
    const {renderFrames, recommendedResolution} = await loadWorkflow<VideoWorkflowModule>(r.config.videoWorkflow)
    const frames = renderFrames?.(clip.frames) ?? clip.frames
    // wan2gp takes seeds up to 2^32 - 1, ours go to 2^48: the same clip seed gives the same wan2gp seed, and that is the one recorded
    const seed = clipSeed(r.config.seed, clip.id) % WAN2GP_SEEDS
    const pinned = r.config.pinStartFrame && clip.startsFrom ? join(r.projectDir, boundaryFrameAsset(clip.startsFrom, 'lf')) : undefined
    // the short prompt numbers the pictures in wan2gp's order (people first, the place last); the full prompt in the clip's own
    const shown = clip.assets.pictures.filter(p => !(pinned && p.kind === 'frame'))
    const pictures = clip.wan2gpPrompt
        ? wan2gpPictureOrder(clip.assets.pictures)
              .map(i => clip.assets.pictures[i]!)
              .filter(p => shown.includes(p))
        : shown
    const input = {
        template,
        prompt: clip.wan2gpPrompt ?? clip.prompt,
        pictures: pictures.map(p => wan2gpPicture(r.projectDir, p)),
        ...(pinned ? {startFrame: pinned} : {}),
        contextFrames: context,
        frames,
        fps: 24,
        seed,
        size: pixelSize(r.config.videoResolution, r.config.videoAspect, recommendedResolution ?? '1344x768'),
    }
    // asked first without the sound: a clip without a wan2gp form cuts nothing
    const refused = wan2gpClipSettings(input)
    if (typeof refused === 'string') return refused
    // the clip's stems mixed into one soundtrack over the clip's span (the render length, not only the frames used)
    const stems = clip.assets.audio.map(a => stemFiles[a.stem!]!)
    let soundtrack: string | undefined
    if (stems.length) {
        const dir = join(r.projectDir, 'output', 'wan2gp')
        mkdirSync(dir, {recursive: true})
        soundtrack = join(dir, `${clip.id}-sound.wav`)
        const span = ['-ss', String(secondsAt(clip.frameStart)), '-t', String(secondsAt(frames))]
        const mix = stems.length > 1 ? ['-filter_complex', `amix=inputs=${stems.length}:normalize=0`] : []
        await runProcess(['ffmpeg', '-y', '-v', 'error', ...stems.flatMap(stem => [...span, '-i', stem]), ...mix, soundtrack], {
            errorMessage: stderr => `${clip.id}: mixing the sound for wan2gp failed: ${stderr}`,
        })
    }
    const settings = wan2gpClipSettings({...input, ...(soundtrack ? {soundtrack} : {})})
    return typeof settings === 'string' ? settings : {settings, meta: {seed}, engine: `wan2gp:${template}`}
}

/**
 * A picture as wan2gp gets it: a person's single full-body picture (the anchor of their sequence sheet) instead of the 2x3 reference
 * sheet - the sheet's backdrop and frontal poses came through on wan2gp (#1204, B and R3), and the clip that showed both people right
 * (R6) had the anchors. A person without a sequence sheet, and every other picture, goes as it is.
 */
function wan2gpPicture(projectDir: string, picture: {kind: string; id: string; file: string}): string {
    const anchor = picture.kind === 'character' ? join(projectDir, sheetAnchor(sequenceSheetDir('character', picture.id))) : undefined
    return anchor && existsSync(anchor) ? anchor : join(projectDir, picture.file)
}

function clipInputs(r: Renderer, clip: ClipRequest, stemFiles: Record<string, string>, withFrames: boolean) {
    const songRemote = `${r.remoteDir}/stems/song${extname(stemFiles.song!)}`
    const uploads = [
        ...clip.assets.pictures.filter(p => withFrames || p.kind !== 'frame').map(p => ({from: join(r.projectDir, p.file), to: `${r.remoteDir}/${p.file}`})),
        ...clip.assets.audio.map(a => ({from: stemFiles[a.stem!]!, to: `${r.remoteDir}/stems/${a.stem}.wav`})),
        {from: stemFiles.song!, to: songRemote},
    ]
    return {
        uploads,
        songRemote,
        audios: clip.assets.audio.map(a => `${r.remoteDir}/stems/${a.stem}.wav`),
        vocals: clip.assets.audio.some(a => a.stem === 'vocals') ? {vocals: `${r.remoteDir}/stems/vocals.wav`} : {},
    }
}
