import type {ComfyApi} from '@saintno/comfyui-sdk'
import {copyFileSync, existsSync, readFileSync, renameSync, writeFileSync} from 'node:fs'
import {basename, join} from 'node:path'
import {type Timing} from './timings.ts'
import type {describeMachine, GraphSetup} from './graph.ts'
import {log} from './log.ts'
import {aboveRecommended, type PixelSize, type RecommendedResolution, type VideoWorkflowModule, type WorkflowResult} from '../comfy/helpers.ts'
import {type RenderConfig, workflowPath} from './config.ts'
import {type ClipRequest, CONTEXT_SETTLE} from './compose.ts'
import {type RetakeAsk, type RetakePlan} from './retake.ts'
import {isOwnFile, isUserFile, recordedEditedPrompt, recordedPrompt} from './provenance.ts'
import {anchorSpec, clipSpec, lookAnchorSpec, pictureSpec, type RenderSpec, sequenceSpec, specId} from './render-spec.ts'
import {archiveFiles, pictureFiles, versionStamp} from './archive.ts'
import {
    characterLookSequencePrompt,
    characterSequencePrompt,
    expressionOf,
    locationSequencePrompt,
    LOOK_SEQUENCE_FRAMES,
    SEQUENCE_FRAMES,
    sequenceSheetDir,
    sheetAnchor,
    sheetVideo,
} from './sequenceSheet.ts'
import {type ComfyServer} from './settings.ts'
import {runProcess} from './process.ts'
import {messageOf} from './text.ts'

// the workflow default max_duration (seconds) when songDuration is -1 in config.json
export const DEFAULT_SONG_DURATION = 360

// how long connecting to a server may take, and how long a server that was reachable may stay silent while a job is
// waited for (a restart takes a while) before the run stops - the queued job is recorded and picked up by the next run
// the frames before a part of a clip rendered again that its render starts on (--retake), 5 + 17·k: 22 of them ran out of memory
// in MiniMaxH3AddGuide on a 32 GB card in a two-pass job, also with its memory freed before
export const RETAKE_LEAD = 5
// the guides of a part of a clip are encoded on the card next to everything else: at 2 MP that ran out of memory on 32 GB (--retake). The node brings them to the size of its latent anyway
export const GUIDE_SCALE = "scale='min(iw,960)':-2"
export const smallerPicture = (file: string) => {
    const partial = file.replace(/\.png$/, '.small.png')
    return runProcess(['ffmpeg', '-y', '-v', 'error', '-i', file, '-vf', GUIDE_SCALE, partial], {
        errorMessage: err => `ffmpeg could not make ${file} smaller:\n${err}`,
    }).then(() => renameSync(partial, file))
}
// the shot a further view of a place comes from (renderExtraView): long enough for one slow move, in a length the model takes
export const EXTRA_VIEW_FRAMES = 73
export const CONNECT_TIMEOUT_MS = 60 * 1000
export const SERVER_SILENT_MS = 5 * 60 * 1000

export async function loadWorkflow<T extends {default: unknown}>(name: string): Promise<T> {
    const path = workflowPath(name)
    if (!path) throw new Error(`workflow name must resolve inside comfy/workflows: ${name}`)
    const module = await import(path)
    if (typeof module.default !== 'function') throw new Error(`comfy/workflows/${name}.ts has no default export function`)
    return module
}

const workflowHashes = new Map<string, string>()

/** A hash of the workflow file - a workflow that was edited is another one for the statistics until it has run once. */
export async function workflowHash(name: string) {
    const path = workflowPath(name)
    if (!path) throw new Error(`workflow name must resolve inside comfy/workflows: ${name}`)
    if (!workflowHashes.has(name)) workflowHashes.set(name, Bun.hash(await Bun.file(path).text()).toString(16))
    return workflowHashes.get(name)!
}

/** The context frames of the end of a clip of `used` frames: `wanted` at most, 5 + 17·k, CONTEXT_SETTLE short of its end - 0 when it is too short. */
export function contextLength(wanted: number, used: number) {
    let frames = Math.min(wanted, used - CONTEXT_SETTLE)
    while (frames > 5 && frames % 17 !== 5) frames--
    return frames < 5 ? 0 : frames
}

/**
 * The frames the job of a clip renders - what its timing records: the clip's own, the context frames before them when it
 * goes on from a clip (config.contextFrames; the clip before taken as long enough), in a length the workflow takes.
 */
export async function renderedFrames(clip: {frames: number; startsFrom?: string}, config: Pick<RenderConfig, 'videoWorkflow' | 'contextFrames'>) {
    const context = clip.startsFrom && config.contextFrames > 0 ? contextLength(config.contextFrames, Infinity) : 0
    const lead = context ? context + CONTEXT_SETTLE : 0
    const {renderFrames} = await loadWorkflow<VideoWorkflowModule>(config.videoWorkflow)
    return renderFrames?.(clip.frames + lead) ?? clip.frames + lead
}

// description: the plain visual description (characterDescriptions/locationDescriptions), not the image prompt -
// used as the subject of the sequence-sheet video prompt (see renderSequenceSheet), which needs to say what the
// subject looks like without the medium/style/pose/background language the image prompt carries.
/** The id of the request a clip is rendered from (lib/render-spec.ts) - what its sidecar records and the final video compares. */
/** The steps of config.json for a workflow's options - only what is set; -1 leaves the workflow's own. */
export const stepOptions = (config: Pick<RenderConfig, 'videoSteps' | 'videoRefineSteps'>) => ({
    ...(config.videoSteps !== -1 ? {steps: config.videoSteps} : {}),
    ...(config.videoRefineSteps !== -1 ? {refineSteps: config.videoRefineSteps} : {}),
})

export const clipFingerprint = (
    clip: ClipRequest,
    projectDir: string,
    config: Pick<RenderConfig, 'videoWorkflow' | 'videoResolution'> & Partial<Pick<RenderConfig, 'videoAspect' | 'videoSteps' | 'videoRefineSteps'>>,
) => specId(clipSpec(clip, projectDir, config))

// look: another look of the character `base` (a film's states) - with sequence sheets its sheet starts on base's anchor and
// shows the change, instead of an anchor drawn from the prompt (renderSequenceSheet)
export type PictureJob = {
    kind: 'character' | 'location' | 'prop'
    id: string
    name: string
    file: string
    prompt: string
    description: string
    seed?: number
    views?: string[]
    look?: {base: string; change: string}
}

type SheetConfig = Pick<RenderConfig, 'imageWorkflow' | 'imageResolution' | 'sequenceWorkflow'>

/** What a picture's reference sheet is made from and where its files go - what it is rendered from, and what says whether the sheet there is stale. */
export function sheetPlan(picture: PictureJob, projectDir: string, config: SheetConfig) {
    const dir = sequenceSheetDir(picture.kind, picture.id)
    // with / also on Windows: anchorFile goes to the server as part of a path (a Linux ComfyUI refused "assets\sequence\…")
    const anchorFile = sheetAnchor(dir)
    const anchorTarget = join(projectDir, anchorFile)
    const videoFile = sheetVideo(dir)
    const videoTarget = join(projectDir, videoFile)
    // the sheet is made from the anchor - the user's own picture (tools/replace-character) as it is, else from the prompt it is rendered from
    const anchorIsUsers = isUserFile(anchorTarget)
    // another look of a character starts on the anchor of its normal picture: no anchor of its own is drawn, its video shows the change
    const look = picture.look && picture.kind === 'character' && !anchorIsUsers ? picture.look : undefined
    const baseAnchorFile = look && sheetAnchor(sequenceSheetDir(picture.kind, look.base))
    const baseAnchorTarget = baseAnchorFile && join(projectDir, baseAnchorFile)
    const sequenceFrames = look ? LOOK_SEQUENCE_FRAMES : SEQUENCE_FRAMES
    // a sheet made before the expression came from its words keeps the one it was drawn with - else it would count as stale
    const expression = expressionOf(recordedPrompt(join(projectDir, picture.file)))
    const {prompt: sequencePrompt, beatTimes} = look
        ? characterLookSequencePrompt(look.change, LOOK_SEQUENCE_FRAMES, expression)
        : picture.kind === 'character'
          ? characterSequencePrompt(picture.description, SEQUENCE_FRAMES, expression)
          : locationSequencePrompt(picture.description, SEQUENCE_FRAMES, picture.views)
    const anchor = look ? lookAnchorSpec(picture.id, baseAnchorTarget!, look.change) : anchorSpec(picture, config, anchorIsUsers ? anchorTarget : undefined)
    const anchorFingerprint = specId(anchor)
    const sequence = sequenceSpec('sequence', picture.id, anchor, sequencePrompt, config.sequenceWorkflow)
    const sheetFingerprint = specId(sequenceSpec('sheet', picture.id, anchor, sequencePrompt, config.sequenceWorkflow))
    return {
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
    }
}

/**
 * Puts a picture away so that it is rendered again (--again): the picture, and of a reference sheet its video and frames. The anchor
 * stays - the same person or place from other views - unless `newAnchor` asks for another one. A look's anchor is a frame of its sheet.
 * An anchor drawn from an edited prompt goes too: the picture is rendered from the plan's prompt now, and kept it would be taken
 * as the user's own (isUserFile) - the plan would never draw its own anchor again. The user's own anchor stays: its prompt is a note.
 */
const editedAnchor = (file: string) => recordedEditedPrompt(file) !== undefined && !isOwnFile(file)

export function putAwayPicture(picture: PictureJob, projectDir: string, config: Pick<RenderConfig, 'sequenceSheets'>, newAnchor: boolean) {
    const sheet = config.sequenceSheets && picture.kind !== 'prop' ? sequenceSheetDir(picture.kind, picture.id) : undefined
    const keepAnchor = !newAnchor && !picture.look && !(sheet && editedAnchor(join(projectDir, sheetAnchor(sheet))))
    const anchorFiles = sheet ? [sheetAnchor(sheet), `${sheetAnchor(sheet)}.json`] : []
    const files = pictureFiles(projectDir, picture, sheet).filter(file => !(keepAnchor && anchorFiles.includes(file)))
    const keep = archiveFiles(projectDir, `${picture.id}-${versionStamp()}`, files)
    // the anchor stays where it is - and a copy goes with the version: its sheet was made from it, and putting the version back
    // (the workspace's Make current) needs it, whatever anchor is there by then
    if (keepAnchor) for (const file of anchorFiles) if (existsSync(join(projectDir, file))) copyFileSync(join(projectDir, file), join(keep, basename(file)))
    return keep
}

/** A picture rendered from a prompt the user edited: kept as it is (lib/provenance.ts), whatever the plan's own prompt says - the edited prompt is in its sidecar. */
export function pinEditedPicture(picture: PictureJob, projectDir: string, editedPrompt: string) {
    const sheet = sequenceSheetDir(picture.kind, picture.id)
    for (const file of [`${picture.file}.json`, `${sheetAnchor(sheet)}.json`]) {
        const path = join(projectDir, file)
        if (!existsSync(path)) continue
        writeFileSync(path, JSON.stringify({...JSON.parse(readFileSync(path, 'utf8')), pinned: true, editedPrompt}, null, 2))
    }
}

/**
 * Which pictures a run with --only renders: the ones it names, or all when it names none of them (--only then is about clips). With
 * --again every name has to be a picture when no clips are rendered - every one is GPU time, a typo must not pass.
 */
export function namedPictures<P extends {id: string}>(pictures: P[], only: Set<string>, mustBePictures: boolean): P[] {
    const named = pictures.filter(p => only.has(p.id))
    if (mustBePictures) {
        const unknown = [...only].filter(id => !pictures.some(p => p.id === id))
        if (unknown.length) throw new Error(`--only: no picture ${unknown.join(', ')} - the pictures are ${pictures.map(p => p.id).join(', ')}`)
    }
    return named.length ? named : pictures
}

/** The id of the request a picture is rendered from, as its sidecar records it: its reference sheet with sequence sheets - a prop stays one plain picture - else the picture. */
export const pictureFingerprint = (picture: PictureJob, projectDir: string, config: SheetConfig & Pick<RenderConfig, 'sequenceSheets'>) =>
    config.sequenceSheets && picture.kind !== 'prop' ? sheetPlan(picture, projectDir, config).sheetFingerprint : specId(pictureSpec(picture, config))

export type Server = ComfyServer & {api: ComfyApi}

/** What a render is, for the log and the statistics: the kind of result and the workflow (config name) that makes it. */
export type RenderWhat = {label: string; spec: RenderSpec; kind: Timing['kind']; workflow: string; resolution?: Timing['resolution']}

// the end of the clip before, cut out for a clip rendered with context frames (Renderer.contextOf): the short video, its
// ComfyUI input name, its frames, and the clip it is from with the frames of that clip the final video shows
export type ClipContext = {file: string; asset: string; frames: number; video: string; used: number}

// the nodes ComfyUI reported while a job ran, in order - for the phase times
export type Trace = {classType: string; at: number}[]

/**
 * Who gets a free server first: a waiter pinned to one (a job already queued there, resumed from an earlier run) before
 * any new render - its server is doing that job anyway, the run only has to fetch it. In the order they came otherwise.
 * Without this a stopped run's finished jobs were only fetched at the end of the next one: every free server went to a new clip.
 */
export const dispatchOrder = <T extends {pin?: string}>(waiting: T[]) => [...waiting.filter(w => w.pin), ...waiting.filter(w => !w.pin)]

/**
 * The server a waiter gets: the first one that is free and not down - with a pin only that one, unless it is down (a job
 * resumed on a server that has gone away is rendered again elsewhere).
 */
export const pickServer = <S extends {name: string}>(
    servers: S[],
    busy: Set<string>,
    down: Set<string>,
    pin?: string,
    held: ReadonlyMap<string, number> = new Map(),
) => servers.find(s => !busy.has(s.name) && !down.has(s.name) && (pin ? down.has(pin) || s.name === pin : !held.get(s.name)))

// how long a server may take to answer the question whether it is there at all, after a job on it failed
export const PROBE_TIMEOUT_MS = 10_000

/**
 * Whether a recorded job is picked up again on the next run. A failed job stays in ComfyUI's history, so resuming it
 * would report the same error again for ever, whatever was changed since (the workflow, the config, a freed GPU) -
 * only a job that is queued, running or finished is worth waiting for.
 */
/**
 * The status board line of a job after a poll of the server: what the last WebSocket event said ("running KSampler #3, step
 * 4/8") stays; without one, the poll decides - "running" or how many jobs are ahead. A resumed job heard no event yet, and
 * a two-pass step takes minutes: it showed "queued" while it ran (#337).
 */
export function boardStatus(state: 'queued' | 'running' | 'finished' | 'failed' | 'unknown', current: string, ahead?: number): string {
    if (current.startsWith('running')) return current
    if (state === 'running') return 'running'
    if (state === 'queued') return `queued, ${ahead ?? 0} job(s) ahead`
    return current
}

export function resumesJob(state: 'queued' | 'running' | 'finished' | 'failed' | 'unknown'): boolean {
    return state === 'queued' || state === 'running' || state === 'finished'
}

/**
 * Renders on one or more ComfyUI servers, one job per server at a time: each render takes the first free server,
 * a resumed job waits for the server it was queued on.
 */
/**
 * A path on the ComfyUI server written with a backslash - in an upload's target or anywhere in the workflow - or undefined.
 * The servers are Windows and Linux: path.join gives \ on Windows, which only a Windows ComfyUI takes. Every path that
 * goes to a server is built with /.
 */
export function backslashedRemotePath(uploads: {to: string}[], prompt: unknown): string | undefined {
    const upload = uploads.find(u => u.to.includes('\\'))
    if (upload) return upload.to
    const found = (value: unknown): string | undefined => {
        if (typeof value === 'string') return value.startsWith('feverslop-ts/') && value.includes('\\') ? value : undefined
        if (value && typeof value === 'object')
            for (const v of Object.values(value)) {
                const hit = found(v)
                if (hit) return hit
            }
        return undefined
    }
    return found(prompt)
}

import * as serversWork from './render/servers.ts'
import * as picturesWork from './render/pictures.ts'
import * as clipsWork from './render/clips.ts'
import * as finishingWork from './render/finishing.ts'

export class Renderer implements Disposable {
    resolutionNoted = false
    /** Says once per run that videoResolution is above the size the workflow's model is made for - it is rendered as set all the same. */
    noteResolution(recommended: RecommendedResolution | undefined) {
        if (this.resolutionNoted || !aboveRecommended(this.config.videoResolution, recommended)) return
        this.resolutionNoted = true
        const [width, height] = recommended!.split('x').map(Number) as [number, number]
        log.warn(
            `official recommended resolution is ${((width * height) / 2 ** 20).toFixed(2)} MP (${recommended}) for this turbo workflow (${this.config.videoWorkflow}) - videoResolution ${JSON.stringify(this.config.videoResolution)} is rendered as set`,
        )
    }

    // everything of a project goes into its own subfolder of ComfyUI's input/output
    readonly remoteDir: string
    ready?: Promise<Server[]>
    connected: Server[] = []
    machines = new Map<string, ReturnType<typeof describeMachine>>() // server name -> GPU and versions
    lastModels = new Map<string, string>() // server name -> the models its last job used (another set means a cold start)
    renderMs = new Map<string, number>() // target -> time spent on its ComfyUI job(s)
    busy = new Set<string>() // server names
    // servers that stopped answering in this run (a crashed ComfyUI behind its proxy): no job goes to them any more, or the
    // next jobs fail on them one after the other the moment they get them - 33 of 41 clips of tribal-261019 (#331)
    down = new Set<string>()
    // A server held for the jobs of an earlier run recorded on it (announceResumes): a new job does not get it until those
    // have taken it or turned out not to be resumable. All renders start at once and whoever asks first gets a server - a
    // new clip, with no pending file to read, asked first, and a finished job of the run before waited hours (#335)
    held = new Map<string, number>() // server name -> jobs still to come for it
    announced = new Map<string, string>() // target -> the server it is held on
    waiting: {pin?: string; resolve: (server: Server) => void; reject: (error: Error) => void}[] = []
    stopQueueNote?: () => void
    /** What is rendered again although it exists, when it is stale: "pictures" and/or "clips" (--refresh) - the old ones are put away in old/attempts. */
    refresh = new Set<string>()

    constructor(
        readonly projectId: string,
        readonly projectDir: string,
        readonly config: RenderConfig,
        readonly servers: ComfyServer[],
    ) {
        if (!servers.length) throw new Error('No ComfyUI server configured - run: bun run setup comfy')
        this.remoteDir = `feverslop-ts/${projectId}`
    }

    [Symbol.dispose]() {
        this.stopQueueNote?.()
        for (const server of this.connected) server.api.destroy()
    }

    /**
     * A run that puts something away before it renders - --again, --refresh, --retake, a picture of the user's own - asks the servers
     * first: one that cannot render leaves the project as it was, instead of a clip in old/ and none in its place (#816).
     */
    async serversFirst() {
        await this.connect()
    }

    // connects on the first render, so a run where everything exists works without a server
    connect() {
        return serversWork.connect(this)
    }

    connectServer(server: ComfyServer): Promise<Server> {
        return serversWork.connectServer(this, server)
    }

    announceResumes(targets: string[]) {
        return serversWork.announceResumes(this, targets)
    }

    settle(target: string) {
        return serversWork.settle(this, target)
    }

    // the first free server - with a pin only that one (see pickServer)
    acquire(pin?: string) {
        return serversWork.acquire(this, pin)
    }

    allDown() {
        return serversWork.allDown(this)
    }

    answers(server: Server): Promise<boolean> {
        return serversWork.answers(this, server)
    }

    markDown(server: Server) {
        return serversWork.markDown(this, server)
    }

    release(server: Server) {
        return serversWork.release(this, server)
    }

    dispatch() {
        return serversWork.dispatch(this)
    }

    // Unloads models and frees VRAM on every connected server - call between phases that load different models
    // (e.g. images -> videos), so the next phase's model has room without ComfyUI swapping it in under pressure.
    freeMemory() {
        return serversWork.freeMemory(this)
    }

    staleFile(kind: 'pictures' | 'clips', file: string, current: string, away: string[]): boolean {
        return picturesWork.staleFile(this, kind, file, current, away)
    }

    // Characters are portrait, locations landscape - saved to the placeholder paths the clips reference
    renderPicture(picture: PictureJob) {
        return picturesWork.renderPicture(this, picture)
    }

    renderSequenceSheet(picture: PictureJob) {
        return picturesWork.renderSequenceSheet(this, picture)
    }

    // Generates input/song.wav with the configured songWorkflow (YuE2 by default). The workflow only saves mp3/flac
    // (no wav), so the download is converted with ffmpeg - the rest of the pipeline only ever sees a wav file,
    // exactly as with a song the user supplied themselves.
    renderSong(brief: {style: string; lyrics: string}, songFile: string) {
        return clipsWork.renderSong(this, brief, songFile)
    }

    // stemFiles: the isolated stems of the whole song (stems/vocals.wav, stems/drums.wav, ...) plus a "song"
    // entry for the whole, unseparated song - vocals is needed by clips with a singer, others by whichever
    // tracks this clip's prompt references ("song" when stems weren't separated at all, see lib/compose.ts).
    renderClip(clip: ClipRequest, stemFiles: Record<string, string>, preview = false) {
        return clipsWork.renderClip(this, clip, stemFiles, preview)
    }

    clipJob(
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
            preview?: {scale: number; steps: number}
            filenamePrefix: string
            extraUploads?: {from: string; to: string}[]
            workflow: VideoWorkflowModule
        },
    ) {
        return clipsWork.clipJob(this, clip, stemFiles, job)
    }

    renderClipPreview(clip: ClipRequest, stemFiles: Record<string, string>) {
        return clipsWork.renderClipPreview(this, clip, stemFiles)
    }

    previewStart(id: string): Promise<string | undefined> {
        return clipsWork.previewStart(this, id)
    }

    savePreviewRecord(clip: {id: string; frames: number; startsFrom?: string}, target: string, seed: number) {
        return clipsWork.savePreviewRecord(this, clip, target, seed)
    }

    retake(
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
        return finishingWork.retake(this, clip, ask, wantedLead, job, renderFrames)
    }

    renderExtraView(locationId: string, n: number, name: string, shows: string, from?: string): Promise<string> {
        return picturesWork.renderExtraView(this, locationId, n, name, shows, from)
    }

    renderRefined(
        clip: {id: string; prompt: string; frames: number; frameStart: number; assets: {pictures: {kind: string; file: string}[]; audio?: {stem?: string}[]}},
        source: string,
        target: string,
        size: PixelSize,
        denoise: number,
        song?: Record<string, string>,
    ) {
        return finishingWork.renderRefined(this, clip, source, target, size, denoise, song)
    }

    renderLatentUpscaled(clipId: string, source: string, target: string, size: PixelSize) {
        return finishingWork.renderLatentUpscaled(this, clipId, source, target, size)
    }

    renderUpscaled(clipId: string, source: string, target: string, model: string, size: PixelSize) {
        return finishingWork.renderUpscaled(this, clipId, source, target, model, size)
    }

    renderClipRetake(clip: ClipRequest, stemFiles: Record<string, string>, ask: RetakeAsk) {
        return finishingWork.renderClipRetake(this, clip, stemFiles, ask)
    }

    renderInterpolation(clip: {id: string; frames: number; shots?: {at: number}[]}, model: string, multiplier: number, target: string, source?: string) {
        return finishingWork.renderInterpolation(this, clip, model, multiplier, target, source)
    }

    retryLeaks<M extends {seed: number}>(
        what: RenderWhat,
        id: string,
        file: string,
        seed: number,
        prepare: () => Promise<{result: WorkflowResult; uploads: {from: string; to: string}[]; meta: M}>,
        rescan: string,
    ): Promise<number> {
        return clipsWork.retryLeaks(this, what, id, file, seed, prepare, rescan)
    }

    checkTakes(
        id: string,
        file: string,
        seed: number,
        clip: {frames: number; shots: {at: number}[]},
        again: (seed: number) => Promise<number>,
    ): Promise<number> {
        return clipsWork.checkTakes(this, id, file, seed, clip, again)
    }

    joinContext(target: string, id: string, startsFrom: string, context: ClipContext) {
        return clipsWork.joinContext(this, target, id, startsFrom, context)
    }

    contextOf(id: string, wanted: number, shown?: number): Promise<ClipContext | undefined> {
        return clipsWork.contextOf(this, id, wanted, shown)
    }

    /**
     * Saves the first and the last frame the clip contributes to the final video: frame 0 and frame `clip.frames - 1` -
     * not the file's last frame, the frames after it are only padding for the model's lengths (see assembleFinal).
     */
    // renderedFrames: set for a clip just rendered - its frames are always rewritten; without, only missing ones are made
    saveBoundaryFrames(clip: {id: string; frames: number}, video: string, renderedFrames?: number) {
        return clipsWork.saveBoundaryFrames(this, clip, video, renderedFrames)
    }

    framesUsed(clip: {frames: number}, available: number) {
        return clipsWork.framesUsed(this, clip, available)
    }

    render<M>(
        what: RenderWhat,
        target: string,
        extension: string | string[],
        prepare: () => Promise<{result: WorkflowResult; uploads: {from: string; to: string}[]; meta: M}>,
    ): Promise<M> {
        return serversWork.render(this, what, target, extension, prepare)
    }

    keepRender(what: RenderWhat, server: Server, job: PendingJob<unknown> | undefined, trace: Trace, started: number, failure?: Error) {
        return serversWork.keepRender(this, what, server, job, trace, started, failure)
    }

    took(target: string) {
        return serversWork.took(this, target)
    }

    // a queued job only exists on its own server - files from before several servers: the first one. undefined
    // when that server is no longer reachable/configured - the job is then rendered again from scratch.
    homeOf<M>(label: string, pending: PendingJob<M>, servers: Server[]): Server | undefined {
        return serversWork.homeOf(this, label, pending, servers)
    }

    resumeOrQueue<M>(
        label: string,
        server: Server,
        pendingFile: string,
        pending: PendingJob<M> | undefined,
        prepare: () => Promise<{result: WorkflowResult; uploads: {from: string; to: string}[]; meta: M}>,
        request?: string,
    ): Promise<PendingJob<M>> {
        return serversWork.resumeOrQueue(this, label, server, pendingFile, pending, prepare, request)
    }

    downloadResult<M>(label: string, target: string, extension: string | string[], server: Server, pending: PendingJob<M>, trace: Trace) {
        return serversWork.downloadResult(this, label, target, extension, server, pending, trace)
    }

    jobState(arg0: Server, promptId: string): Promise<'queued' | 'running' | 'finished' | 'failed' | 'unknown'> {
        return serversWork.jobState(this, arg0, promptId)
    }

    waitForJob(label: string, server: Server, job: PendingJob<unknown>, trace: Trace) {
        return serversWork.waitForJob(this, label, server, job, trace)
    }
}

/** The recorded job of a render, or undefined when there is none - or when the file is damaged (a stop in the middle of a write). */
export async function readPending<M>(file: string): Promise<PendingJob<M> | undefined> {
    if (!existsSync(file)) return undefined
    try {
        return await Bun.file(file).json()
    } catch (e) {
        log.warn(`${basename(file)} is damaged (${messageOf(e)}) - ignored, the clip is queued again`)
        return undefined
    }
}

export type PendingJob<M> = {
    request?: string // fingerprint of the request the job was queued for (lib/provenance.ts) - missing in files from before
    promptId: string
    server?: {name: string; url: string} // missing in files from before several servers
    output: string // output node id
    nodes: Record<string, string> // node id -> class_type, for the progress display
    meta: M
    queuedAt: number
    attachedAt?: number // when a later run took the job up again (lib/comfy-cancel.ts jobsQueuedSince)
    variant?: string // the id of the graph's knobs and what the graph says (lib/graph.ts) - for the statistics
    setup?: GraphSetup
    cold?: boolean // the first job on that server with these models
}

export const formatClock = (time: number) => new Date(time).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})
