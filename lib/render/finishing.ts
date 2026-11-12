import {existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync} from 'node:fs'
import {basename, dirname, extname, join, relative} from 'node:path'
import {log, styles} from '../log.ts'
import {type InterpolationWorkflow, type PixelSize, clipSeed, type VideoWorkflowModule, type WorkflowResult} from '../../comfy/helpers.ts'
import {boundaryFrameAsset, type ClipRequest} from '../compose.ts'
import {secondsAt} from '../frames.ts'
import {extractFrame, framesOnGrid, probeVideo} from '../assemble.ts'
import {paddedClip, withOriginalSound} from '../refinish.ts'
import {planRetake, type RetakeAsk, type RetakePlan, retakeFrames, retakePrompt, shotsIn, spliceVideo} from '../retake.ts'
import {freshness} from '../provenance.ts'
import {type RenderSpec, specId} from '../render-spec.ts'
import {fileFingerprint} from '../provenance.ts'
import {sceneScores, shotCuts, shotPieces} from '../interpolate.ts'
import {archiveFiles, versionStamp} from '../archive.ts'
import {runProcess} from '../process.ts'
import {type Renderer, RETAKE_LEAD, GUIDE_SCALE, smallerPicture, loadWorkflow} from '../render.ts'

// The work of a Renderer (lib/render.ts, #841): a clip made over: a part rendered again (retake), refined, upscaled, interpolated. The renderer keeps the state; these take it as `r`.

/**
 * Renders part of a clip again and puts it into the clip (--retake). The whole old clip goes to old/attempts first, so it stays a version
 * to go back to. The request it was made from does not change: the clip stays current. The frames around the part guide the render.
 */
export async function retake(
    r: Renderer,
    clip: {id: string; frames: number; shots?: {at: number}[]; prompt: string},
    ask: RetakeAsk,
    wantedLead: number,
    job: (
        plan: RetakePlan,
        guides: {
            prompt: string
            startClip?: string
            startFrame?: string
            endFrame?: {image: string; at: number}
            uploads: {from: string; to: string}[]
            seed: number
            filenamePrefix: string
        },
    ) => Promise<{result: WorkflowResult; uploads: {from: string; to: string}[]; meta: {seed: number}}>,
    renderFrames: (frames: number) => number,
) {
    const file = `videos/${clip.id}.mp4`
    const video = join(r.projectDir, file)
    if (!existsSync(video)) throw new Error(`${clip.id} is not rendered yet - there is nothing to render part of`)
    const info = await probeVideo(video)
    const fileFrames = framesOnGrid(info)
    const cuts = shotCuts(
        clip.frames,
        (clip.shots ?? []).map(s => s.at),
        await sceneScores(video),
    )
    const plan = planRetake(retakeFrames(ask, fileFrames, cuts), fileFrames, wantedLead, renderFrames)
    const work = `assets/clips/${clip.id}_retake`
    mkdirSync(join(r.projectDir, 'assets', 'clips'), {recursive: true})
    const uploads: {from: string; to: string}[] = []
    const remote = (name: string) => {
        uploads.push({from: join(r.projectDir, name), to: `${r.remoteDir}/${name}`})
        return `${r.remoteDir}/${name}`
    }
    const guides: {startClip?: string; startFrame?: string; endFrame?: {image: string; at: number}} = {}
    if (plan.lead) {
        const head = `${work}_head.mp4`
        await runProcess(
            [
                'ffmpeg',
                '-y',
                '-v',
                'error',
                '-i',
                video,
                '-vf',
                `trim=start_frame=${plan.first - plan.lead}:end_frame=${plan.first},setpts=PTS-STARTPTS,${GUIDE_SCALE}`,
                '-an',
                '-c:v',
                'libx264',
                '-crf',
                '10',
                '-pix_fmt',
                'yuv420p',
                join(r.projectDir, head),
            ],
            {errorMessage: err => `ffmpeg could not cut the frames before the part of ${clip.id}:\n${err}`},
        )
        guides.startClip = remote(head)
    } else if (plan.singleStart) {
        const before = `${work}_before.png`
        await extractFrame(video, plan.first - 1, join(r.projectDir, before))
        await smallerPicture(join(r.projectDir, before))
        guides.startFrame = remote(before)
    }
    if (plan.endAt !== undefined) {
        const after = `${work}_after.png`
        await extractFrame(video, plan.end, join(r.projectDir, after))
        await smallerPicture(join(r.projectDir, after))
        guides.endFrame = {image: remote(after), at: plan.endAt}
    }
    log.warn(
        '--retake is not proven yet: on a 32 GB Radeon its two-pass job ran out of memory while encoding the guides, and one try took the server down (#157) - try it on one short part first',
    )
    log.step(
        'Part',
        `${clip.id} ${styles.muted(`frames ${plan.first}-${plan.end} of ${fileFrames}, ${plan.lead ? `${plan.lead} frames before it` : plan.singleStart ? 'the frame before it' : 'from its start'}${plan.endAt !== undefined ? ', the frame after it' : ''} as guides - ${plan.render} frames rendered`)}`,
    )
    const prompt = retakePrompt(clip.prompt, shotsIn(plan, cuts))
    const rendered = join(r.projectDir, `${work}.mp4`)
    const seed = clipSeed(r.config.seed, clip.id)
    const spec: RenderSpec = {kind: 'clip', id: clip.id, parts: ['retake', plan.first, plan.end, prompt, r.config.videoWorkflow, fileFingerprint(video)]}
    await r.render<{seed: number}>(
        {label: `part of ${clip.id}`, spec, kind: 'clip', workflow: r.config.videoWorkflow, resolution: r.config.videoResolution},
        rendered,
        '.mp4',
        () => job(plan, {...guides, prompt, uploads, seed, filenamePrefix: `${r.remoteDir}/videos/${clip.id}-retake`}),
    )
    // The server has consumed these local inputs; they are guide media, not project assets.
    for (const upload of uploads) {
        try {
            rmSync(upload.from, {force: true})
        } catch {
            /* a guide that cannot be removed must not lose the retake */
        }
    }

    const spliced = join(r.projectDir, `${work}_spliced.mp4`)
    await spliceVideo({original: video, rendered, plan, width: info.width, height: info.height, target: spliced})
    const record = existsSync(`${video}.json`) ? (JSON.parse(readFileSync(`${video}.json`, 'utf8')) as Record<string, unknown> & {retakes?: unknown[]}) : {}
    const keep = archiveFiles(r.projectDir, `${clip.id}-${versionStamp()}`, [
        file,
        `${file}.json`,
        boundaryFrameAsset(clip.id, 'ff'),
        boundaryFrameAsset(clip.id, 'lf'),
    ])
    renameSync(spliced, video)
    await Bun.write(
        `${video}.json`,
        JSON.stringify({...record, retakes: [...(record.retakes ?? []), {first: plan.first, end: plan.end, seed, at: new Date().toISOString()}]}, null, 2),
    )
    rmSync(rendered, {force: true})
    const frames = await probeVideo(video)
    log.step('Saved', `${file} ${styles.muted(`frames ${plan.first}-${plan.end} are new, the old clip is in ${keep}`)}`)
    // the first and last frame of a clip after a part of it changed: made again from the file
    await r.saveBoundaryFrames(clip, video, frames.frames)
}

/**
 * A finished clip made larger with the second pass of a two-pass render (comfy/workflows/h3-refine.ts), with its prompt, pictures and, in a music video, its
 * tracks and song. It keeps its own sound and its own length. `song`: the stems and the song of a music video.
 */
export async function renderRefined(
    r: Renderer,
    clip: {id: string; prompt: string; frames: number; frameStart: number; assets: {pictures: {kind: string; file: string}[]; audio?: {stem?: string}[]}},
    source: string,
    target: string,
    size: PixelSize,
    denoise: number,
    song?: Record<string, string>,
) {
    const missing = clip.assets.pictures.filter(p => p.kind !== 'frame' && !existsSync(join(r.projectDir, p.file)))
    if (missing.length) throw new Error(`${clip.id}: missing pictures: ${missing.map(p => p.file).join(', ')}`)
    const stems = (clip.assets.audio ?? []).map(a => a.stem!)
    const lost = stems.filter(stem => !song?.[stem] || !existsSync(song[stem]!))
    if (song && lost.length) throw new Error(`${clip.id}: missing stem file(s): ${lost.join(', ')}`)
    if (song && !existsSync(song.song!)) throw new Error(`${clip.id}: the song is missing: ${song.song}`)
    const {default: refine, renderFrames} = await loadWorkflow<typeof import('../../comfy/workflows/h3-refine.ts')>('h3-refine')
    const info = await probeVideo(source)
    const frames = framesOnGrid(info)
    const length = renderFrames(frames)
    // what goes up is the clip, or the clip filled up to a length the model takes
    const work = `${target.replace(/\.mp4$/, '')}`
    const clipFile = length === frames ? source : `${work}.padded.mp4`
    if (length !== frames) await paddedClip(source, clipFile, length - frames)
    const remoteClip = `${r.remoteDir}/${relative(r.projectDir, target)
        .replace(/\\/g, '/')
        .replace(/\.mp4$/, '.source.mp4')}`
    const rendered = `${work}.rendered.mp4`
    const spec: RenderSpec = {kind: 'clip', id: clip.id, parts: ['refine', fileFingerprint(source), clip.prompt, size, denoise]}
    const songRemote = song ? `${r.remoteDir}/stems/song${extname(song.song!)}` : undefined
    const {seed} = await r.render(
        {label: `refine ${clip.id}`, spec, kind: 'clip', workflow: 'h3-refine', resolution: `${size.width}x${size.height}`},
        rendered,
        '.mp4',
        async () => {
            const seed = clipSeed(r.config.seed, clip.id)
            const pictures = clip.assets.pictures.filter(p => p.kind !== 'frame')
            const result = refine({
                prompt: clip.prompt,
                pictures: pictures.map(p => `${r.remoteDir}/${p.file}`),
                video: remoteClip,
                frames: length,
                size,
                aspect: r.config.videoAspect,
                denoise,
                ...(song
                    ? {
                          audios: stems.map(stem => `${r.remoteDir}/stems/${stem}.wav`),
                          song: songRemote,
                          songStart: secondsAt(clip.frameStart),
                          duration: secondsAt(length),
                      }
                    : {}),
                seed,
                filenamePrefix: `${r.remoteDir}/refined/${basename(dirname(target))}/${clip.id}`,
            })
            const uploads = [
                ...pictures.map(p => ({from: join(r.projectDir, p.file), to: `${r.remoteDir}/${p.file}`})),
                {from: clipFile, to: remoteClip},
                ...(song ? [...stems.map(stem => ({from: song[stem]!, to: `${r.remoteDir}/stems/${stem}.wav`})), {from: song.song!, to: songRemote!}] : []),
            ]
            return {result, uploads, meta: {seed}}
        },
    )
    await withOriginalSound(rendered, source, frames, length !== frames, target)
    rmSync(rendered, {force: true})
    if (clipFile !== source) rmSync(clipFile, {force: true})
    await Bun.write(
        `${target}.json`,
        JSON.stringify(
            {
                complete: true,
                bytes: statSync(target).size,
                workflow: 'h3-refine',
                seed,
                denoise,
                size: `${size.width}x${size.height}`,
                frames,
                source: relative(r.projectDir, source).replace(/\\/g, '/'),
                sourceFingerprint: fileFingerprint(source),
            },
            null,
            2,
        ),
    )
    log.step('Saved', `${relative(r.projectDir, target).replace(/\\/g, '/')} ${styles.muted(`${size.width}x${size.height} · ${r.took(rendered)}`)}`)
}

/** A finished clip made larger with the latent upscaler alone (comfy/workflows/h3-latent-upscale.ts): nothing sampled. It keeps its own sound and its own length. */
export async function renderLatentUpscaled(r: Renderer, clipId: string, source: string, target: string, size: PixelSize) {
    const {default: upscale} = await loadWorkflow<typeof import('../../comfy/workflows/h3-latent-upscale.ts')>('h3-latent-upscale')
    const {renderFrames} = await loadWorkflow<typeof import('../../comfy/workflows/h3-refine.ts')>('h3-refine')
    const frames = framesOnGrid(await probeVideo(source))
    const length = renderFrames(frames)
    const clipFile = length === frames ? source : target.replace(/\.mp4$/, '.padded.mp4')
    if (length !== frames) await paddedClip(source, clipFile, length - frames)
    const remoteClip = `${r.remoteDir}/${relative(r.projectDir, target)
        .replace(/\\/g, '/')
        .replace(/\.mp4$/, '.source.mp4')}`
    const rendered = target.replace(/\.mp4$/, '.rendered.mp4')
    const spec: RenderSpec = {kind: 'clip', id: clipId, parts: ['latent', fileFingerprint(source), size]}
    await r.render(
        {label: `latent upscale ${clipId}`, spec, kind: 'clip', workflow: 'h3-latent-upscale', resolution: `${size.width}x${size.height}`},
        rendered,
        '.mp4',
        async () => ({
            result: upscale({video: remoteClip, size, filenamePrefix: `${r.remoteDir}/refined/${basename(dirname(target))}/${clipId}`}),
            uploads: [{from: clipFile, to: remoteClip}],
            meta: {},
        }),
    )
    await withOriginalSound(rendered, source, frames, length !== frames, target)
    rmSync(rendered, {force: true})
    if (clipFile !== source) rmSync(clipFile, {force: true})
    await Bun.write(
        `${target}.json`,
        JSON.stringify(
            {
                complete: true,
                bytes: statSync(target).size,
                workflow: 'h3-latent-upscale',
                size: `${size.width}x${size.height}`,
                frames,
                source: relative(r.projectDir, source).replace(/\\/g, '/'),
                sourceFingerprint: fileFingerprint(source),
            },
            null,
            2,
        ),
    )
    log.step('Saved', `${relative(r.projectDir, target).replace(/\\/g, '/')} ${styles.muted(`${size.width}x${size.height}`)}`)
}

/** A finished clip made larger with an upscale model on ComfyUI, frame by frame (comfy/workflows/video-upscale.ts). It keeps its own sound. */
export async function renderUpscaled(r: Renderer, clipId: string, source: string, target: string, model: string, size: PixelSize) {
    const {default: upscale} = await loadWorkflow<typeof import('../../comfy/workflows/video-upscale.ts')>('video-upscale')
    const remoteClip = `${r.remoteDir}/${relative(r.projectDir, target)
        .replace(/\\/g, '/')
        .replace(/\.mp4$/, '.source.mp4')}`
    const rendered = target.replace(/\.mp4$/, '.rendered.mp4')
    const spec: RenderSpec = {kind: 'clip', id: clipId, parts: ['upscale', fileFingerprint(source), model, size]}
    await r.render(
        {label: `upscale ${clipId}`, spec, kind: 'clip', workflow: 'video-upscale', resolution: `${size.width}x${size.height}`},
        rendered,
        '.mp4',
        async () => ({
            result: upscale({video: remoteClip, model, size, filenamePrefix: `${r.remoteDir}/refined/${basename(dirname(target))}/${clipId}`}),
            uploads: [{from: source, to: remoteClip}],
            meta: {},
        }),
    )
    await withOriginalSound(rendered, source, 0, false, target)
    rmSync(rendered, {force: true})
    await Bun.write(
        `${target}.json`,
        JSON.stringify(
            {
                complete: true,
                bytes: statSync(target).size,
                workflow: 'video-upscale',
                model,
                size: `${size.width}x${size.height}`,
                source: relative(r.projectDir, source).replace(/\\/g, '/'),
                sourceFingerprint: fileFingerprint(source),
            },
            null,
            2,
        ),
    )
    log.step('Saved', `${relative(r.projectDir, target).replace(/\\/g, '/')} ${styles.muted(`${size.width}x${size.height}`)}`)
}

/** A part of a music-video clip rendered again, with the song at its place. */
export async function renderClipRetake(r: Renderer, clip: ClipRequest, stemFiles: Record<string, string>, ask: RetakeAsk) {
    const workflow = await loadWorkflow<VideoWorkflowModule>(r.config.videoWorkflow)
    r.noteResolution(workflow.recommendedResolution)
    if (!(stemFiles.song && existsSync(stemFiles.song))) throw new Error(`${clip.id}: the full song is missing`)
    await r.retake(
        {...clip, shots: clip.shots},
        ask,
        RETAKE_LEAD,
        async (plan, guides) => {
            const job = await r.clipJob(clip, stemFiles, {
                prompt: guides.prompt,
                songStart: secondsAt(clip.frameStart + plan.first - plan.lead),
                frames: plan.render,
                seed: guides.seed,
                workflow,
                filenamePrefix: guides.filenamePrefix,
                startClip: guides.startClip,
                startFrame: guides.startFrame,
                endFrame: guides.endFrame,
                extraUploads: guides.uploads,
            })
            return job
        },
        frames => workflow.renderFrames?.(frames) ?? frames,
    )
}

/**
 * A rendered clip with `multiplier` times its frames (frame interpolation, comfy/workflows/frame-interpolate.ts), written
 * to `target` at FPS * multiplier. Only the frames the final video uses, cut into the clip's shots where the picture cuts. Rendered again when
 * the clip, its cuts, the model or the multiplier changed.
 */
export async function renderInterpolation(
    r: Renderer,
    clip: {id: string; frames: number; shots?: {at: number}[]},
    model: string,
    multiplier: number,
    target: string,
    source?: string,
) {
    const video = source ?? join(r.projectDir, 'videos', `${clip.id}.mp4`)
    if (!existsSync(video)) throw new Error(`${clip.id}: ${video} is not rendered yet`)
    // the cuts as the picture has them - the model cuts near the planned time, not on it (lib/interpolate.ts)
    const pieces = shotPieces(
        clip.frames,
        shotCuts(
            clip.frames,
            (clip.shots ?? []).map(s => s.at),
            await sceneScores(video),
        ),
    )
    const spec: RenderSpec = {kind: 'interpolation', id: clip.id, parts: [fileFingerprint(video), pieces, model, multiplier]}
    if (existsSync(target) && freshness(target, specId(spec)) === 'current') return log.step('Exists', basename(target))
    mkdirSync(dirname(target), {recursive: true})
    await r.render({label: `interpolation ${clip.id}`, spec, kind: 'interpolation', workflow: 'frame-interpolate'}, target, '.mp4', async () => {
        // another version of a clip under its own name on the server: it must not be taken for this one
        const remote = `${r.remoteDir}/${source ? relative(r.projectDir, source).replace(/\\/g, '/') : `videos/${clip.id}.mp4`}`
        const {default: interpolate} = await loadWorkflow<{default: InterpolationWorkflow}>('frame-interpolate')
        const result = interpolate({
            video: remote,
            pieces,
            model,
            multiplier,
            filenamePrefix: `${r.remoteDir}/${source ? `${relative(r.projectDir, dirname(source)).replace(/\\/g, '/')}/interpolated` : 'interpolated'}/${clip.id}`,
        })
        return {result, uploads: [{from: video, to: remote}], meta: {}}
    })
    const rendered = await probeVideo(target)
    const expected = clip.frames * multiplier
    if (rendered.frames !== expected) log.warn(`${basename(target)} has ${rendered.frames} frames, ${expected} expected`)
    await Bun.write(
        `${target}.json`,
        JSON.stringify(
            {workflow: 'frame-interpolate', model, multiplier, pieces, frames: rendered.frames, fps: rendered.fps, fingerprint: specId(spec)},
            null,
            2,
        ),
    )
    log.step('Saved', `${basename(target)} ${styles.muted(`${rendered.frames} frames at ${rendered.fps} fps · ${r.took(target)}`)}`)
}
