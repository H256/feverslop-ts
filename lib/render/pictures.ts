import {copyFileSync, existsSync, mkdirSync, readdirSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {log, styles} from '../log.ts'
import {type ImageWorkflow, resolveSeed, type SequenceWorkflow} from '../../comfy/helpers.ts'
import {extractFrame, probeVideo} from '../assemble.ts'
import {freshness, incompleteClip, recordedFingerprint} from '../provenance.ts'
import {pictureSpec, type RenderSpec, specId} from '../render-spec.ts'
import {fileFingerprint} from '../provenance.ts'
import {archiveFiles, versionStamp} from '../archive.ts'
import {
    composeSheet,
    lookSheetFrames,
    selectFrameIndices,
    sequenceSheetDir,
    sheetAnchor,
    sheetFrame,
    sheetFrames,
    sheetLayout,
    sheetViews,
} from '../sequenceSheet.ts'
import {type Renderer, EXTRA_VIEW_FRAMES, loadWorkflow, type PictureJob, sheetPlan} from '../render.ts'

// The work of a Renderer (lib/render.ts, #841): the pictures of characters and places: one picture, a reference sheet, an extra view of a place. The renderer keeps the state; these take it as `r`.

/**
 * An existing file made from another request than the one planned now (see lib/provenance.ts): said, and with
 * --refresh=<kind> put away in old/attempts and rendered again. True when the file has to be rendered again.
 */
export function staleFile(r: Renderer, kind: 'pictures' | 'clips', file: string, current: string, away: string[]): boolean {
    if (kind === 'clips' && incompleteClip(join(r.projectDir, file))) {
        const keep = archiveFiles(r.projectDir, `stale-${versionStamp()}-${file.replace(/[\/]/g, '-')}`, away)
        log.warn(`${file} has no readable sidecar; incomplete take kept in ${keep}, rendering again. Own videos need a sidecar with source: "user"`)
        return true
    }
    if (freshness(join(r.projectDir, file), current) !== 'stale') return false
    if (!r.refresh.has(kind)) {
        log.warn(
            `${file} was made from another prompt, workflow or picture than the plan has now - it is used as it is; --refresh=${kind} renders it again (the old one is kept in old/attempts)`,
        )
        return false
    }
    const keep = archiveFiles(r.projectDir, `stale-${versionStamp()}-${file.replace(/[\/]/g, '-')}`, away)
    log.step('Stale', `${styles.name(file)} ${styles.muted(`- put away in ${keep}, rendered again`)}`)
    return true
}

export async function renderPicture(r: Renderer, picture: PictureJob) {
    const target = join(r.projectDir, picture.file)
    const spec = pictureSpec(picture, r.config)
    const current = specId(spec)
    if (existsSync(target) && !r.staleFile('pictures', picture.file, current, [picture.file, `${picture.file}.json`]))
        return log.step('Exists', styles.muted(picture.file))

    const {seed} = await r.render(
        {label: `${picture.kind} ${picture.id}`, spec, kind: 'picture', workflow: r.config.imageWorkflow, resolution: r.config.imageResolution},
        target,
        '.png',
        async () => {
            const seed = picture.seed ?? resolveSeed(r.config.seed)
            const {default: imageWorkflow} = await loadWorkflow<{default: ImageWorkflow}>(r.config.imageWorkflow)
            const result = imageWorkflow({
                prompt: picture.prompt,
                seed,
                resolution: r.config.imageResolution,
                orientation: picture.kind === 'character' ? 'portrait' : 'landscape',
                filenamePrefix: `${r.remoteDir}/${picture.kind}s/${picture.id}`,
            })
            return {result, uploads: [], meta: {seed}}
        },
    )
    await Bun.write(
        `${target}.json`,
        JSON.stringify({workflow: r.config.imageWorkflow, seed, resolution: r.config.imageResolution, prompt: picture.prompt, fingerprint: current}, null, 2),
    )
    log.step('Saved', `${picture.file} ${styles.muted(r.took(target))}`)
}

/**
 * Same result file as renderPicture (picture.file - what every clip references), but built from several
 * angles instead of one flat hero image: renders the hero image as usual (the "anchor"), turns it into a
 * short silent turnaround video (comfy/workflows/h3-sequence-to-sheet.ts), samples a few of its beats as
 * frames, and composites them into one multi-angle reference sheet. See lib/sequenceSheet.ts for why this
 * helps - a single static location/character picture reused in every shot for the whole song reads as
 * repetitive; several angles give the video model more to draw a shot's framing from.
 */
export async function renderSequenceSheet(r: Renderer, picture: PictureJob) {
    const target = join(r.projectDir, picture.file)

    const {
        dir,
        anchorFile,
        anchorTarget,
        videoFile,
        videoTarget,
        anchorIsUsers,
        look,
        baseAnchorFile,
        baseAnchorTarget,
        sequenceFrames,
        sequencePrompt,
        beatTimes,
        anchor,
        anchorFingerprint,
        sequence,
        sheetFingerprint,
    } = sheetPlan(picture, r.projectDir, r.config)
    if (existsSync(target)) {
        const frameFiles = existsSync(join(r.projectDir, sheetFrames(dir)))
            ? readdirSync(join(r.projectDir, sheetFrames(dir))).map(f => join(sheetFrames(dir), f))
            : []
        // the anchor goes too only when it changed: a sheet made again for its own prompt keeps its place or person - drawn
        // anew from another seed, last-rehearsal's places came back as other rooms. A look's anchor is a frame of its sheet.
        const anchorKept = anchorIsUsers || (!look && recordedFingerprint(anchorTarget) === anchorFingerprint)
        const away = [
            picture.file,
            `${picture.file}.json`,
            videoFile,
            `${videoFile}.json`,
            ...frameFiles,
            ...(anchorKept ? [] : [anchorFile, `${anchorFile}.json`]),
        ]
        if (!r.staleFile('pictures', picture.file, sheetFingerprint, away)) return log.step('Exists', styles.muted(picture.file))
    }
    if (baseAnchorTarget && !existsSync(baseAnchorTarget))
        return log.warn(`${picture.id} skipped - its sheet starts on the anchor of ${look!.base}, which is not rendered yet (${baseAnchorFile})`)
    mkdirSync(join(r.projectDir, dir), {recursive: true})

    if (!look && !existsSync(anchorTarget)) {
        const {seed} = await r.render(
            {
                label: `${picture.kind} ${picture.id} anchor`,
                spec: anchor,
                kind: 'picture',
                workflow: r.config.imageWorkflow,
                resolution: r.config.imageResolution,
            },
            anchorTarget,
            '.png',
            async () => {
                const seed = picture.seed ?? resolveSeed(r.config.seed)
                const {default: imageWorkflow} = await loadWorkflow<{default: ImageWorkflow}>(r.config.imageWorkflow)
                const result = imageWorkflow({
                    prompt: picture.prompt,
                    seed,
                    resolution: r.config.imageResolution,
                    orientation: picture.kind === 'character' ? 'portrait' : 'landscape',
                    filenamePrefix: `${r.remoteDir}/${dir}/anchor`,
                })
                return {result, uploads: [], meta: {seed}}
            },
        )
        await Bun.write(
            `${anchorTarget}.json`,
            JSON.stringify(
                {
                    workflow: r.config.imageWorkflow,
                    seed,
                    resolution: r.config.imageResolution,
                    prompt: picture.prompt,
                    fingerprint: anchorFingerprint,
                },
                null,
                2,
            ),
        )
    }

    if (!existsSync(videoTarget)) {
        const {seed} = await r.render(
            {label: `${picture.kind} ${picture.id} sequence`, spec: sequence, kind: 'picture', workflow: r.config.sequenceWorkflow},
            videoTarget,
            '.mp4',
            async () => {
                const seed = resolveSeed(r.config.seed)
                const {default: sequenceWorkflow} = await loadWorkflow<{default: SequenceWorkflow}>(r.config.sequenceWorkflow)
                const result = sequenceWorkflow({
                    prompt: sequencePrompt,
                    startFrame: `${r.remoteDir}/${baseAnchorFile ?? anchorFile}`,
                    frames: sequenceFrames,
                    orientation: picture.kind === 'character' ? 'portrait' : 'landscape',
                    resolution: -1,
                    seed,
                    filenamePrefix: `${r.remoteDir}/${dir}/sequence`,
                })
                return {result, uploads: [{from: baseAnchorTarget ?? anchorTarget, to: `${r.remoteDir}/${baseAnchorFile ?? anchorFile}`}], meta: {seed}}
            },
        )
        await Bun.write(
            `${videoTarget}.json`,
            JSON.stringify({workflow: r.config.sequenceWorkflow, seed, frames: sequenceFrames, beatTimes, prompt: sequencePrompt}, null, 2),
        )
    }

    const framesDir = join(r.projectDir, sheetFrames(dir))
    mkdirSync(framesDir, {recursive: true})
    // the workflow may render another length than asked for (the video model only takes certain frame counts) -
    // the frames are picked from the video as it really is, not from the length that was requested
    const rendered = await probeVideo(videoTarget)
    if (rendered.frames !== sequenceFrames)
        log.warn(
            `${videoFile} has ${rendered.frames} frames, ${sequenceFrames} were requested - the sheet frames are picked from the ${rendered.frames} it has`,
        )
    const frameIndices = look ? lookSheetFrames(beatTimes, rendered.frames) : selectFrameIndices(beatTimes, rendered.frames)
    const framePaths = await Promise.all(
        frameIndices.map(async (frameIndex, i) => {
            const framePath = join(r.projectDir, sheetFrame(dir, i))
            if (!existsSync(framePath)) await extractFrame(videoTarget, frameIndex, framePath)
            return framePath
        }),
    )

    // a look's anchor is its first view in the new look - what a look built on this one would start on
    if (look) {
        copyFileSync(framePaths[0]!, anchorTarget)
        await Bun.write(`${anchorTarget}.json`, JSON.stringify({from: baseAnchorFile, change: look.change, fingerprint: anchorFingerprint}, null, 2))
    }
    const {columns, panel} = sheetLayout(picture.kind === 'character' ? 'character' : 'location')
    await composeSheet(framePaths, target, panel, columns)
    await Bun.write(
        `${target}.json`,
        JSON.stringify(
            {
                workflow: r.config.sequenceWorkflow,
                frames: sequenceFrames,
                beatTimes,
                prompt: sequencePrompt,
                fingerprint: sheetFingerprint,
            },
            null,
            2,
        ),
    )
    log.step('Saved', `${picture.file} ${styles.muted(r.took(videoTarget))}`)
}

/**
 * One more view of a place: a short shot that starts on the place's anchor - or on another of its views (`from`, a picture in the
 * project), for a view one move from the anchor does not reach - and moves to what is asked for, and the last frame of it. From a
 * picture of the place, so the look stays the same. Kept next to the sheet (views/view-<n>.png), with its name, what it shows and
 * what it started from beside it.
 */
export async function renderExtraView(r: Renderer, locationId: string, n: number, name: string, shows: string, from?: string): Promise<string> {
    const sheet = sequenceSheetDir('location', locationId)
    const anchor = from ?? sheetAnchor(sheet)
    const video = `${sheetViews(sheet)}/view-${n}.mp4`
    const picture = `${sheetViews(sheet)}/view-${n}.png`
    const prompt = `The camera moves through this same place in one slow, unbroken move and comes to rest ${name}, where it shows ${shows}. The same place, the same light, the same fixtures throughout: nothing is added or doubled. Nobody is in the picture.`
    mkdirSync(join(r.projectDir, dirname(video)), {recursive: true})
    const spec: RenderSpec = {
        kind: 'sequence',
        id: `${locationId}-view-${n}`,
        parts: [prompt, r.config.sequenceWorkflow, fileFingerprint(join(r.projectDir, anchor))],
    }
    const {seed} = await r.render(
        {label: `view ${n} of ${locationId}`, spec, kind: 'picture', workflow: r.config.sequenceWorkflow},
        join(r.projectDir, video),
        '.mp4',
        async () => {
            const seed = resolveSeed(r.config.seed)
            const {default: sequenceWorkflow} = await loadWorkflow<{default: SequenceWorkflow}>(r.config.sequenceWorkflow)
            const result = sequenceWorkflow({
                prompt,
                startFrame: `${r.remoteDir}/${anchor}`,
                frames: EXTRA_VIEW_FRAMES,
                orientation: 'landscape',
                resolution: -1,
                seed,
                filenamePrefix: `${r.remoteDir}/${video.replace(/\.mp4$/, '')}`,
            })
            return {result, uploads: [{from: join(r.projectDir, anchor), to: `${r.remoteDir}/${anchor}`}], meta: {seed}}
        },
    )
    const rendered = await probeVideo(join(r.projectDir, video))
    await extractFrame(join(r.projectDir, video), rendered.frames - 1, join(r.projectDir, picture))
    await Bun.write(
        join(r.projectDir, `${picture}.json`),
        JSON.stringify({name, shows, seed, prompt, workflow: r.config.sequenceWorkflow, from: anchor}, null, 2),
    )
    log.step('Saved', `${picture} ${styles.muted(r.took(join(r.projectDir, video)))}`)
    return picture
}
