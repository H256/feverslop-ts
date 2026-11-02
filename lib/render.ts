import {nameService} from "./service-error.ts";
import {ComfyApi, type ImageInfo} from "@saintno/comfyui-sdk";
import {copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync} from "node:fs";
import {basename, dirname, extname, join, posix, relative} from "node:path";
import {recordTiming, type Timing} from "./timings.ts";
import {accumulatePhases, describeGraph, describeMachine, type Graph, type GraphSetup} from "./graph.ts";
import {formatDuration, log, startSpinner, styles} from "./log.ts";
import {aboveRecommended, type AudioWorkflow, type ImageWorkflow, type InterpolationWorkflow, type PixelSize, type RecommendedResolution, clipSeed, resolveSeed, type SequenceWorkflow, type VideoWorkflowModule, type WorkflowResult} from "../comfy/helpers.ts";
import {type RenderConfig, workflowDir} from "./config.ts";
import {boundaryFrameAsset, type ClipRequest, CONTEXT_SETTLE} from "./compose.ts";
import {secondsAt} from "./frames.ts";
import {extractFrame, framesOnGrid, probeVideo, trimHead} from "./assemble.ts";
import {paddedClip, withOriginalSound} from "./refinish.ts";
import {planRetake, type RetakeAsk, type RetakePlan, retakeFrames, retakePrompt, shotsIn, spliceVideo} from "./retake.ts";
import {backdropSeconds, hasBackdropRun} from "./leak.ts";
import {freshness, isUserFile, recordedFingerprint, recordedPrompt} from "./provenance.ts";
import {anchorSpec, clipSpec, lookAnchorSpec, pictureSpec, type RenderSpec, sequenceSpec, songSpec, specId} from "./render-spec.ts";
import {fileFingerprint} from "./provenance.ts";
import {matchColors} from "./colormatch.ts";
import {sceneScores, shotCuts, shotPieces} from "./interpolate.ts";
import {archiveFiles, pictureFiles, versionStamp} from "./archive.ts";
import {characterLookSequencePrompt, characterSequencePrompt, composeSheet, expressionOf, locationSequencePrompt, LOOK_SEQUENCE_FRAMES, lookSheetFrames, selectFrameIndices, SEQUENCE_FRAMES, sequenceSheetDir, sheetAnchor, sheetFrame, sheetFrames, sheetLayout, sheetVideo, sheetViews} from "./sequenceSheet.ts";
import {type ComfyServer, probeComfy} from "./settings.ts";
import {runProcess} from "./process.ts";
import {clipRequestRef} from "./previous-output.ts";

// the workflow default max_duration (seconds) when songDuration is -1 in config.json
const DEFAULT_SONG_DURATION = 360

// how long connecting to a server may take, and how long a server that was reachable may stay silent while a job is
// waited for (a restart takes a while) before the run stops - the queued job is recorded and picked up by the next run
// the frames before a part of a clip rendered again that its render starts on (--retake), 5 + 17·k: 22 of them ran out of memory
// in MiniMaxH3AddGuide on a 32 GB card in a two-pass job, also with its memory freed before
export const RETAKE_LEAD = 5
// the guides of a part of a clip are encoded on the card next to everything else: at 2 MP that ran out of memory on 32 GB (--retake). The node brings them to the size of its latent anyway
const GUIDE_SCALE = "scale='min(iw,960)':-2"
const smallerPicture = (file: string) => {
    const partial = file.replace(/\.png$/, '.small.png')
    return runProcess(['ffmpeg', '-y', '-v', 'error', '-i', file, '-vf', GUIDE_SCALE, partial], {errorMessage: err => `ffmpeg could not make ${file} smaller:\n${err}`}).then(() => renameSync(partial, file))
}
// the shot a further view of a place comes from (renderExtraView): long enough for one slow move, in a length the model takes
const EXTRA_VIEW_FRAMES = 73
const CONNECT_TIMEOUT_MS = 60 * 1000
const SERVER_SILENT_MS = 5 * 60 * 1000

async function loadWorkflow<T extends { default: unknown }>(name: string): Promise<T> {
    const module = await import(join(workflowDir, `${name}.ts`))
    if (typeof module.default !== 'function') throw new Error(`comfy/workflows/${name}.ts has no default export function`)
    return module
}

const workflowHashes = new Map<string, string>()

/** A hash of the workflow file - a workflow that was edited is another one for the statistics until it has run once. */
export async function workflowHash(name: string) {
    if (!workflowHashes.has(name)) workflowHashes.set(name, Bun.hash(await Bun.file(join(workflowDir, `${name}.ts`)).text()).toString(16))
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
export async function renderedFrames(clip: { frames: number, startsFrom?: string }, config: Pick<RenderConfig, 'videoWorkflow' | 'contextFrames'>) {
    const context = clip.startsFrom && config.contextFrames > 0 ? contextLength(config.contextFrames, Infinity) : 0
    const lead = context ? context + CONTEXT_SETTLE : 0
    const {renderFrames} = await loadWorkflow<VideoWorkflowModule>(config.videoWorkflow)
    return renderFrames?.(clip.frames + lead) ?? clip.frames + lead
}

// description: the plain visual description (characterDescriptions/locationDescriptions), not the image prompt -
// used as the subject of the sequence-sheet video prompt (see renderSequenceSheet), which needs to say what the
// subject looks like without the medium/style/pose/background language the image prompt carries.
/** The id of the request a clip is rendered from (lib/render-spec.ts) - what its sidecar records and the final video compares. */
export const clipFingerprint = (clip: ClipRequest, projectDir: string, config: Pick<RenderConfig, 'videoWorkflow' | 'videoResolution'> & Partial<Pick<RenderConfig, 'videoAspect'>>) =>
    specId(clipSpec(clip, projectDir, config))

// look: another look of the character `base` (a film's states) - with sequence sheets its sheet starts on base's anchor and
// shows the change, instead of an anchor drawn from the prompt (renderSequenceSheet)
export type PictureJob = { kind: 'character' | 'location' | 'prop', id: string, name: string, file: string, prompt: string, description: string, seed?: number, views?: string[], look?: { base: string, change: string } }

type SheetConfig = Pick<RenderConfig, 'imageWorkflow' | 'imageResolution' | 'sequenceWorkflow'>

/** What a picture's reference sheet is made from and where its files go - what it is rendered from, and what says whether the sheet there is stale. */
function sheetPlan(picture: PictureJob, projectDir: string, config: SheetConfig) {
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
    const {prompt: sequencePrompt, beatTimes} = look ? characterLookSequencePrompt(look.change, LOOK_SEQUENCE_FRAMES, expression)
        : picture.kind === 'character' ? characterSequencePrompt(picture.description, SEQUENCE_FRAMES, expression)
        : locationSequencePrompt(picture.description, SEQUENCE_FRAMES, picture.views)
    const anchor = look ? lookAnchorSpec(picture.id, baseAnchorTarget!, look.change) : anchorSpec(picture, config, anchorIsUsers ? anchorTarget : undefined)
    const anchorFingerprint = specId(anchor)
    const sequence = sequenceSpec('sequence', picture.id, anchor, sequencePrompt, config.sequenceWorkflow)
    const sheetFingerprint = specId(sequenceSpec('sheet', picture.id, anchor, sequencePrompt, config.sequenceWorkflow))
    return {dir, anchorFile, anchorTarget, videoFile, videoTarget, anchorIsUsers, look, baseAnchorFile, baseAnchorTarget, sequenceFrames, sequencePrompt, beatTimes, anchor, anchorFingerprint, sequence, sheetFingerprint}
}

/**
 * Puts a picture away so that it is rendered again (--again): the picture, and of a reference sheet its video and frames. The anchor
 * stays - the same person or place from other views - unless `newAnchor` asks for another one. A look's anchor is a frame of its sheet.
 */
export function putAwayPicture(picture: PictureJob, projectDir: string, config: Pick<RenderConfig, 'sequenceSheets'>, newAnchor: boolean) {
    const sheet = config.sequenceSheets && picture.kind !== 'prop' ? sequenceSheetDir(picture.kind, picture.id) : undefined
    const keepAnchor = !newAnchor && !picture.look
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
export function namedPictures<P extends { id: string }>(pictures: P[], only: Set<string>, mustBePictures: boolean): P[] {
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

type Server = ComfyServer & { api: ComfyApi }

/** What a render is, for the log and the statistics: the kind of result and the workflow (config name) that makes it. */
export type RenderWhat = { label: string, spec: RenderSpec, kind: Timing['kind'], workflow: string, resolution?: Timing['resolution'] }

// the end of the clip before, cut out for a clip rendered with context frames (Renderer.contextOf): the short video, its
// ComfyUI input name, its frames, and the clip it is from with the frames of that clip the final video shows
export type ClipContext = { file: string, asset: string, frames: number, video: string, used: number }

// the nodes ComfyUI reported while a job ran, in order - for the phase times
type Trace = { classType: string, at: number }[]

/**
 * Who gets a free server first: a waiter pinned to one (a job already queued there, resumed from an earlier run) before
 * any new render - its server is doing that job anyway, the run only has to fetch it. In the order they came otherwise.
 * Without this a stopped run's finished jobs were only fetched at the end of the next one: every free server went to a new clip.
 */
export const dispatchOrder = <T extends { pin?: string }>(waiting: T[]) => [...waiting.filter(w => w.pin), ...waiting.filter(w => !w.pin)]

/**
 * The server a waiter gets: the first one that is free and not down - with a pin only that one, unless it is down (a job
 * resumed on a server that has gone away is rendered again elsewhere).
 */
export const pickServer = <S extends { name: string }>(servers: S[], busy: Set<string>, down: Set<string>, pin?: string, held: ReadonlyMap<string, number> = new Map()) =>
    servers.find(s => !busy.has(s.name) && !down.has(s.name) && (pin ? down.has(pin) || s.name === pin : !held.get(s.name)))

// how long a server may take to answer the question whether it is there at all, after a job on it failed
const PROBE_TIMEOUT_MS = 10_000

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
export function backslashedRemotePath(uploads: { to: string }[], prompt: unknown): string | undefined {
    const upload = uploads.find(u => u.to.includes('\\'))
    if (upload) return upload.to
    const found = (value: unknown): string | undefined => {
        if (typeof value === 'string') return value.startsWith('feverslop-ts/') && value.includes('\\') ? value : undefined
        if (value && typeof value === 'object') for (const v of Object.values(value)) { const hit = found(v); if (hit) return hit }
        return undefined
    }
    return found(prompt)
}

export class Renderer implements Disposable {
    private resolutionNoted = false
    /** Says once per run that videoResolution is above the size the workflow's model is made for - it is rendered as set all the same. */
    protected noteResolution(recommended: RecommendedResolution | undefined) {
        if (this.resolutionNoted || !aboveRecommended(this.config.videoResolution, recommended)) return
        this.resolutionNoted = true
        const [width, height] = recommended!.split('x').map(Number) as [number, number]
        log.warn(`official recommended resolution is ${(width * height / 2 ** 20).toFixed(2)} MP (${recommended}) for this turbo workflow (${this.config.videoWorkflow}) - videoResolution ${JSON.stringify(this.config.videoResolution)} is rendered as set`)
    }

    // everything of a project goes into its own subfolder of ComfyUI's input/output
    readonly remoteDir: string
    private ready?: Promise<Server[]>
    private connected: Server[] = []
    private machines = new Map<string, ReturnType<typeof describeMachine>>()   // server name -> GPU and versions
    private lastModels = new Map<string, string>()   // server name -> the models its last job used (another set means a cold start)
    private renderMs = new Map<string, number>()   // target -> time spent on its ComfyUI job(s)
    private busy = new Set<string>()        // server names
    // servers that stopped answering in this run (a crashed ComfyUI behind its proxy): no job goes to them any more, or the
    // next jobs fail on them one after the other the moment they get them - 33 of 41 clips of tribal-261019 (#331)
    private down = new Set<string>()
    // A server held for the jobs of an earlier run recorded on it (announceResumes): a new job does not get it until those
    // have taken it or turned out not to be resumable. All renders start at once and whoever asks first gets a server - a
    // new clip, with no pending file to read, asked first, and a finished job of the run before waited hours (#335)
    private held = new Map<string, number>()       // server name -> jobs still to come for it
    private announced = new Map<string, string>()  // target -> the server it is held on
    private waiting: { pin?: string, resolve: (server: Server) => void, reject: (error: Error) => void }[] = []
    private stopQueueNote?: () => void
    /** What is rendered again although it exists, when it is stale: "pictures" and/or "clips" (--refresh) - the old ones are put away in old/attempts. */
    refresh = new Set<string>()

    constructor(readonly projectId: string, readonly projectDir: string, readonly config: RenderConfig, readonly servers: ComfyServer[]) {
        if (!servers.length) throw new Error('No ComfyUI server configured - run: bun run setup comfy')
        this.remoteDir = `feverslop-ts/${projectId}`
    }

    [Symbol.dispose]() {
        this.stopQueueNote?.()
        for (const server of this.connected) server.api.destroy()
    }

    // connects on the first render, so a run where everything exists works without a server
    private connect() {
        this.ready ??= (async () => {
            // the SDK would wait forever for a server that isn't there - so every server is asked first
            const problems = await Promise.all(this.servers.map(server => probeComfy(server).then(stats => void this.machines.set(server.name, describeMachine(stats)), (e: Error) => e.message)))
            const reachable = this.servers.filter((server, i) => {
                if (problems[i]) log.warn(`ComfyUI ${server.name} (${server.url}) is unreachable - ${problems[i]}`)
                return !problems[i]
            })
            const connections = await Promise.allSettled(reachable.map(server => this.connectServer(server)))
            for (const c of connections) {
                if (c.status === 'fulfilled') this.connected.push(c.value)
                else log.warn((c.reason as Error).message)
            }
            if (!this.connected.length) {
                throw new Error(`No ComfyUI server reachable (${this.servers.map(s => s.url).join(', ')}) - start ComfyUI, or check the servers with: bun run setup comfy`)
            }
            this.stopQueueNote = startSpinner(() => this.waiting.length ? `${this.waiting.length} queued` : '', {note: true})
            return this.connected
        })()
        return this.ready
    }

    private connectServer(server: ComfyServer): Promise<Server> {
        // A fixed client id per project and server: ComfyUI sends a job's progress to the client that queued it,
        // so after a restart the progress of a resumed job still arrives.
        // ComfyUI sends nothing while it loads a large model - with the default 10 s timeout the SDK
        // would call the connection dead. Completion doesn't depend on the connection anyway (see waitForJob).
        const api = new ComfyApi(server.url, `feverslop-ts-${this.projectId}-${server.name}`, {
            wsTimeout: 10 * 60 * 1000,
            ...(server.credentials ? {credentials: server.credentials} : {}),
        })
        return new Promise((resolve, reject) => {
            // waitForReady() never returns when the connection fails - nor when the server accepts it but one of the
            // endpoints the SDK asks while connecting (e.g. /manager/version) never answers
            const fail = (message: string) => {
                clearTimeout(timer)
                off()
                api.destroy()
                reject(new Error(`ComfyUI ${server.name} (${server.url}): ${message}`))
            }
            const timer = setTimeout(() => fail(`no connection within ${CONNECT_TIMEOUT_MS / 1000} s - the server answers, but not completely (restarting? stuck custom node?)`), CONNECT_TIMEOUT_MS)
            const off = api.on('connection_error', () => fail('connection failed'))
            api.init(5, 2000).waitForReady().then(() => {
                clearTimeout(timer)
                off()
                resolve({...server, api})
            }, (e: unknown) => fail(e instanceof Error ? e.message : String(e)))
        })
    }

    /**
     * Before the renders start: every target with a job of an earlier run recorded in its pending file holds that server for
     * it - see `held`. Only for renders that will ask for a server; the hold goes with settle().
     */
    async announceResumes(targets: string[]) {
        const servers = await this.connect()
        for (const target of targets) {
            const pending = await readPending<unknown>(`${target}.pending.json`)
            const name = pending?.server?.name ?? (pending ? this.servers[0]?.name : undefined)
            if (!name || !servers.some(s => s.name === name) || this.announced.has(target)) continue
            this.announced.set(target, name)
            this.held.set(name, (this.held.get(name) ?? 0) + 1)
        }
    }

    /** The job of `target` has its server, or will not resume: the hold of announceResumes goes. */
    settle(target: string) {
        const name = this.announced.get(target)
        if (!name) return
        this.announced.delete(target)
        const left = (this.held.get(name) ?? 1) - 1
        if (left > 0) this.held.set(name, left)
        else this.held.delete(name)
        this.dispatch()
    }

    // the first free server - with a pin only that one (see pickServer)
    private acquire(pin?: string) {
        return new Promise<Server>((resolve, reject) => {
            if (this.connected.length && this.connected.every(s => this.down.has(s.name))) return reject(this.allDown())
            this.waiting.push({pin, resolve, reject})
            this.dispatch()
        })
    }

    private allDown() {
        return new Error(`no ComfyUI server answers any more (${[...this.down].join(', ')}) - start them again and run again; finished files are kept, the rest goes on from there`)
    }

    /** Whether a server still answers at all - asked after a job on it failed. */
    private async answers(server: Server): Promise<boolean> {
        let timer: ReturnType<typeof setTimeout> | undefined
        const timeout = new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), PROBE_TIMEOUT_MS) })
        try {
            return await Promise.race([server.api.getSystemStats().then(() => true, () => false), timeout])
        } finally {
            clearTimeout(timer)
        }
    }

    /** No job goes to `server` any more in this run; with no server left, everybody still waiting is told so. */
    private markDown(server: Server) {
        if (this.down.has(server.name)) return
        this.down.add(server.name)
        const left = this.connected.filter(s => !this.down.has(s.name)).map(s => s.name)
        log.warn(`ComfyUI ${server.name} (${server.url}) does not answer - no more jobs go to it in this run${left.length ? `, they go to ${left.join(', ')}` : ''}. Start it again and run again to use it`)
        if (!left.length) {
            for (const waiter of this.waiting.splice(0)) waiter.reject(this.allDown())
            return
        }
        this.dispatch()
    }

    private release(server: Server) {
        this.busy.delete(server.name)
        this.dispatch()
    }

    private dispatch() {
        for (const waiter of dispatchOrder(this.waiting)) {
            const free = pickServer(this.connected, this.busy, this.down, waiter.pin, this.held)
            if (!free) continue
            this.busy.add(free.name)
            this.waiting.splice(this.waiting.indexOf(waiter), 1)
            waiter.resolve(free)
        }
    }

    // Unloads models and frees VRAM on every connected server - call between phases that load different models
    // (e.g. images -> videos), so the next phase's model has room without ComfyUI swapping it in under pressure.
    async freeMemory() {
        if (!this.connected.length) return
        log.step('✨ Freeing VRAM', styles.muted(this.connected.map(s => s.name).join(', ')))
        await Promise.all(this.connected.map(async server => {
            try {
                const freed = await server.api.freeMemory(true, true)
                log.step(freed ? '✨ Freed' : '✗ Free failed', styles.muted(`VRAM on ${server.name}`))
            } catch (e) {
                log.warn(`${server.name}: failed to free VRAM - ${(e as Error).message}`)
            }
        }))
    }

    /**
     * An existing file made from another request than the one planned now (see lib/provenance.ts): said, and with
     * --refresh=<kind> put away in old/attempts and rendered again. True when the file has to be rendered again.
     */
    staleFile(kind: 'pictures' | 'clips', file: string, current: string, away: string[]): boolean {
        if (freshness(join(this.projectDir, file), current) !== 'stale') return false
        if (!this.refresh.has(kind)) {
            log.warn(`${file} was made from another prompt, workflow or picture than the plan has now - it is used as it is; --refresh=${kind} renders it again (the old one is kept in old/attempts)`)
            return false
        }
        const keep = archiveFiles(this.projectDir, `stale-${versionStamp()}-${file.replace(/[\/]/g, '-')}`, away)
        log.step('Stale', `${styles.name(file)} ${styles.muted(`- put away in ${keep}, rendered again`)}`)
        return true
    }

    // Characters are portrait, locations landscape - saved to the placeholder paths the clips reference
    async renderPicture(picture: PictureJob) {
        const target = join(this.projectDir, picture.file)
        const spec = pictureSpec(picture, this.config)
        const current = specId(spec)
        if (existsSync(target) && !this.staleFile('pictures', picture.file, current, [picture.file, `${picture.file}.json`])) return log.step('Exists', styles.muted(picture.file))

        const {seed} = await this.render({label: `${picture.kind} ${picture.id}`, spec, kind: 'picture', workflow: this.config.imageWorkflow, resolution: this.config.imageResolution}, target, '.png', async () => {
            const seed = picture.seed ?? resolveSeed(this.config.seed)
            const {default: imageWorkflow} = await loadWorkflow<{ default: ImageWorkflow }>(this.config.imageWorkflow)
            const result = imageWorkflow({
                prompt: picture.prompt,
                seed,
                resolution: this.config.imageResolution,
                orientation: picture.kind === 'character' ? 'portrait' : 'landscape',
                filenamePrefix: `${this.remoteDir}/${picture.kind}s/${picture.id}`,
            })
            return {result, uploads: [], meta: {seed}}
        })
        await Bun.write(`${target}.json`, JSON.stringify({workflow: this.config.imageWorkflow, seed, resolution: this.config.imageResolution, prompt: picture.prompt, fingerprint: current}, null, 2))
        log.step('Saved', `${picture.file} ${styles.muted(this.took(target))}`)
    }

    /**
     * Same result file as renderPicture (picture.file - what every clip references), but built from several
     * angles instead of one flat hero image: renders the hero image as usual (the "anchor"), turns it into a
     * short silent turnaround video (comfy/workflows/h3-sequence-to-sheet.ts), samples a few of its beats as
     * frames, and composites them into one multi-angle reference sheet. See lib/sequenceSheet.ts for why this
     * helps - a single static location/character picture reused in every shot for the whole song reads as
     * repetitive; several angles give the video model more to draw a shot's framing from.
     */
    async renderSequenceSheet(picture: PictureJob) {
        const target = join(this.projectDir, picture.file)

        const {dir, anchorFile, anchorTarget, videoFile, videoTarget, anchorIsUsers, look, baseAnchorFile, baseAnchorTarget, sequenceFrames, sequencePrompt, beatTimes, anchor, anchorFingerprint, sequence, sheetFingerprint} = sheetPlan(picture, this.projectDir, this.config)
        if (existsSync(target)) {
            const frameFiles = existsSync(join(this.projectDir, sheetFrames(dir))) ? readdirSync(join(this.projectDir, sheetFrames(dir))).map(f => join(sheetFrames(dir), f)) : []
            // the anchor goes too only when it changed: a sheet made again for its own prompt keeps its place or person - drawn
            // anew from another seed, last-rehearsal's places came back as other rooms. A look's anchor is a frame of its sheet.
            const anchorKept = anchorIsUsers || (!look && recordedFingerprint(anchorTarget) === anchorFingerprint)
            const away = [picture.file, `${picture.file}.json`, videoFile, `${videoFile}.json`, ...frameFiles, ...(anchorKept ? [] : [anchorFile, `${anchorFile}.json`])]
            if (!this.staleFile('pictures', picture.file, sheetFingerprint, away)) return log.step('Exists', styles.muted(picture.file))
        }
        if (baseAnchorTarget && !existsSync(baseAnchorTarget)) return log.warn(`${picture.id} skipped - its sheet starts on the anchor of ${look!.base}, which is not rendered yet (${baseAnchorFile})`)
        mkdirSync(join(this.projectDir, dir), {recursive: true})

        if (!look && !existsSync(anchorTarget)) {
            const {seed} = await this.render({label: `${picture.kind} ${picture.id} anchor`, spec: anchor, kind: 'picture', workflow: this.config.imageWorkflow, resolution: this.config.imageResolution}, anchorTarget, '.png', async () => {
                const seed = picture.seed ?? resolveSeed(this.config.seed)
                const {default: imageWorkflow} = await loadWorkflow<{ default: ImageWorkflow }>(this.config.imageWorkflow)
                const result = imageWorkflow({
                    prompt: picture.prompt,
                    seed,
                    resolution: this.config.imageResolution,
                    orientation: picture.kind === 'character' ? 'portrait' : 'landscape',
                    filenamePrefix: `${this.remoteDir}/${dir}/anchor`,
                })
                return {result, uploads: [], meta: {seed}}
            })
            await Bun.write(`${anchorTarget}.json`, JSON.stringify({workflow: this.config.imageWorkflow, seed, resolution: this.config.imageResolution, prompt: picture.prompt, fingerprint: anchorFingerprint}, null, 2))
        }

        if (!existsSync(videoTarget)) {
            const {seed} = await this.render({label: `${picture.kind} ${picture.id} sequence`, spec: sequence, kind: 'picture', workflow: this.config.sequenceWorkflow}, videoTarget, '.mp4', async () => {
                const seed = resolveSeed(this.config.seed)
                const {default: sequenceWorkflow} = await loadWorkflow<{ default: SequenceWorkflow }>(this.config.sequenceWorkflow)
                const result = sequenceWorkflow({
                    prompt: sequencePrompt,
                    startFrame: `${this.remoteDir}/${baseAnchorFile ?? anchorFile}`,
                    frames: sequenceFrames,
                    orientation: picture.kind === 'character' ? 'portrait' : 'landscape',
                    resolution: -1,
                    seed,
                    filenamePrefix: `${this.remoteDir}/${dir}/sequence`,
                })
                return {result, uploads: [{from: baseAnchorTarget ?? anchorTarget, to: `${this.remoteDir}/${baseAnchorFile ?? anchorFile}`}], meta: {seed}}
            })
            await Bun.write(`${videoTarget}.json`, JSON.stringify({workflow: this.config.sequenceWorkflow, seed, frames: sequenceFrames, beatTimes, prompt: sequencePrompt}, null, 2))
        }

        const framesDir = join(this.projectDir, sheetFrames(dir))
        mkdirSync(framesDir, {recursive: true})
        // the workflow may render another length than asked for (the video model only takes certain frame counts) -
        // the frames are picked from the video as it really is, not from the length that was requested
        const rendered = await probeVideo(videoTarget)
        if (rendered.frames !== sequenceFrames) log.warn(`${videoFile} has ${rendered.frames} frames, ${sequenceFrames} were requested - the sheet frames are picked from the ${rendered.frames} it has`)
        const frameIndices = look ? lookSheetFrames(beatTimes, rendered.frames) : selectFrameIndices(beatTimes, rendered.frames)
        const framePaths = await Promise.all(frameIndices.map(async (frameIndex, i) => {
            const framePath = join(this.projectDir, sheetFrame(dir, i))
            if (!existsSync(framePath)) await extractFrame(videoTarget, frameIndex, framePath)
            return framePath
        }))

        // a look's anchor is its first view in the new look - what a look built on this one would start on
        if (look) {
            copyFileSync(framePaths[0]!, anchorTarget)
            await Bun.write(`${anchorTarget}.json`, JSON.stringify({from: baseAnchorFile, change: look.change, fingerprint: anchorFingerprint}, null, 2))
        }
        const {columns, panel} = sheetLayout(picture.kind === 'character' ? 'character' : 'location')
        await composeSheet(framePaths, target, panel, columns)
        await Bun.write(`${target}.json`, JSON.stringify({
            workflow: this.config.sequenceWorkflow, frames: sequenceFrames, beatTimes, prompt: sequencePrompt, fingerprint: sheetFingerprint,
        }, null, 2))
        log.step('Saved', `${picture.file} ${styles.muted(this.took(videoTarget))}`)
    }

    // Generates input/song.wav with the configured songWorkflow (YuE2 by default). The workflow only saves mp3/flac
    // (no wav), so the download is converted with ffmpeg - the rest of the pipeline only ever sees a wav file,
    // exactly as with a song the user supplied themselves.
    async renderSong(brief: { style: string, lyrics: string }, songFile: string) {
        if (existsSync(songFile)) return log.step('Exists', styles.muted('input/song.wav'))
        // not input/song.mp3: that name is where a song the user supplied by hand lives, and the download is
        // deleted after the conversion. ffmpeg detects mp3 or flac from the content, the extension is irrelevant.
        const downloaded = songFile.replace(/\.wav$/, '.generated.audio')

        const {seed, duration} = await this.render({label: 'song', spec: songSpec(brief, this.config), kind: 'song', workflow: this.config.songWorkflow}, downloaded, ['.mp3', '.flac'], async () => {
            const seed = resolveSeed(this.config.seed)
            const duration = this.config.songDuration === -1 ? DEFAULT_SONG_DURATION : this.config.songDuration
            const {default: audioWorkflow} = await loadWorkflow<{ default: AudioWorkflow }>(this.config.songWorkflow)
            const result = audioWorkflow({
                style: brief.style,
                lyrics: brief.lyrics,
                seed,
                duration,
                filenamePrefix: `${this.remoteDir}/song`,
            })
            return {result, uploads: [], meta: {seed, duration}}
        })

        await runProcess(['ffmpeg', '-y', '-v', 'error', '-i', downloaded, '-c:a', 'pcm_s16le', songFile], {
            errorMessage: err => `ffmpeg failed to convert the generated song to wav:\n${err}`,
        })
        rmSync(downloaded)
        await Bun.write(`${songFile}.json`, JSON.stringify({workflow: this.config.songWorkflow, seed, duration, style: brief.style, lyrics: brief.lyrics}, null, 2))
        log.step('Saved', 'input/song.wav')
    }

    // stemFiles: the isolated stems of the whole song (stems/vocals.wav, stems/drums.wav, ...) plus a "song"
    // entry for the whole, unseparated song - vocals is needed by clips with a singer, others by whichever
    // tracks this clip's prompt references ("song" when stems weren't separated at all, see lib/compose.ts).
    async renderClip(clip: ClipRequest, stemFiles: Record<string, string>, preview = false) {
        if (preview) return this.renderClipPreview(clip, stemFiles)
        const file = `videos/${clip.id}.mp4`
        const target = join(this.projectDir, file)
        const spec = clipSpec(clip, this.projectDir, this.config)
        const request = specId(spec)
        const away = [file, `${file}.json`, boundaryFrameAsset(clip.id, 'ff'), boundaryFrameAsset(clip.id, 'lf')]
        if (existsSync(target) && !this.staleFile('clips', file, request, away)) {
            log.step('Exists', styles.muted(file))
            // it starts on the last frame of the clip before - rendered again since, that frame is another one
            const startFrame = clip.startsFrom ? join(this.projectDir, boundaryFrameAsset(clip.startsFrom, 'lf')) : undefined
            if (startFrame && existsSync(startFrame) && statSync(startFrame).mtimeMs > statSync(target).mtimeMs) {
                log.warn(`${file} starts on an older version of ${clip.startsFrom}'s last frame - delete it to render it again`)
            }
            // clips rendered before the boundary frames existed get them now
            return this.saveBoundaryFrames(clip, target)
        }

        const missing = clip.assets.pictures.filter(p => !existsSync(join(this.projectDir, p.file)))
        if (missing.some(p => p.kind === 'frame')) return log.warn(`${clip.id} skipped - it starts on the last frame of ${clip.startsFrom}, which is not rendered yet (${missing.find(p => p.kind === 'frame')!.file})`)
        if (missing.length) return log.warn(`${clip.id} skipped - missing pictures: ${missing.map(p => p.file).join(', ')}`)
        const withVocals = clip.assets.audio.some(a => a.stem === 'vocals')
        const missingStems = clip.assets.audio.filter(a => !(a.stem && stemFiles[a.stem] && existsSync(stemFiles[a.stem]!)))
        if (missingStems.length) return log.warn(`${clip.id} skipped - missing stem file(s) for: ${missingStems.map(a => a.stem).join(', ')}`)
        if (!(stemFiles.song && existsSync(stemFiles.song))) return log.warn(`${clip.id} skipped - missing the full song (needed for MiniMaxH3AddGuide)`)

        const prepare = async () => {
            const pictureUploads = clip.assets.pictures.map(p => ({from: join(this.projectDir, p.file), to: `${this.remoteDir}/${p.file}`}))
            // Upload the whole separated stem per track (not a per-clip cut) and let the workflow trim it to
            // this clip's span itself (TrimAudioDuration) - a pre-cut file can't account for the video model
            // rounding the render length up past clip.frames (see comfy/workflows/h3-ref2video.ts). The full,
            // unseparated song goes up too, always - MiniMaxH3AddGuide locks it into the AV latent so every
            // instrument gets some real audio grounding, not just the isolated tracks a character's own prop
            // happens to need (an idle instrument otherwise has no audio backing its idle prompt text at all).
            // song can be a hand-supplied song.mp3 or song.flac as well as the usual wav - keep its real extension on upload,
            // LoadAudio needs it to demux correctly
            const songRemote = `${this.remoteDir}/stems/song${extname(stemFiles.song!)}`
            const uploads = [
                ...pictureUploads,
                ...clip.assets.audio.map(a => ({from: stemFiles[a.stem!]!, to: `${this.remoteDir}/stems/${a.stem}.wav`})),
                {from: stemFiles.song!, to: songRemote},
            ]
            const seed = clipSeed(this.config.seed, clip.id)
            const {default: videoWorkflow, renderFrames, recommendedResolution} = await loadWorkflow<VideoWorkflowModule>(this.config.videoWorkflow)
            this.noteResolution(recommendedResolution)

            // Render at least the clip's frames, in a length the model accepts. The audio starts exactly on
            // the clip's first frame and covers the whole render, so the extra frames at the end follow the
            // real song too - they are cut off again when the final video is assembled.
            // context frames: the last frames of the clip before go in at the start, the render begins that much earlier
            const lead = context ? context.frames + CONTEXT_SETTLE : 0
            const frames = renderFrames?.(clip.frames + lead) ?? clip.frames + lead
            if (frames < clip.frames + lead) throw new Error(`${this.config.videoWorkflow}: renderFrames(${clip.frames + lead}) returned only ${frames} frames`)
            if (context) uploads.push({from: context.file, to: `${this.remoteDir}/${context.asset}`})
            const result = videoWorkflow({
                prompt: clip.prompt,
                // a pinned first frame (config.pinStartFrame) goes in as the guide only - as a reference picture too it is blended in twice
                pictures: clip.assets.pictures.filter(p => !((this.config.pinStartFrame || context) && p.kind === 'frame')).map(p => `${this.remoteDir}/${p.file}`),
                audios: clip.assets.audio.map(a => `${this.remoteDir}/stems/${a.stem}.wav`),
                ...(withVocals ? {vocals: `${this.remoteDir}/stems/vocals.wav`} : {}),
                // the full mix, locked into the AV latent via MiniMaxH3AddGuide - see comfy/workflows/h3-ref2video.ts
                song: songRemote,
                ...(context ? {startClip: `${this.remoteDir}/${context.asset}`} : this.config.pinStartFrame && clip.startsFrom ? {startFrame: `${this.remoteDir}/${boundaryFrameAsset(clip.startsFrom, 'lf')}`} : {}),
                songStart: secondsAt(clip.frameStart - lead),
                frames,
                duration: secondsAt(frames),
                seed,
                resolution: this.config.videoResolution,
                aspect: this.config.videoAspect,
                filenamePrefix: `${this.remoteDir}/videos/${clip.id}`,
            })
            return {result, uploads, meta: {seed, ...(result.size ? {size: result.size} : {})}}
        }
        // context frames (config.contextFrames): the tail of the clip before, cut out now so the job is made from it
        const context = clip.startsFrom && this.config.contextFrames > 0 ? await this.contextOf(clip.startsFrom, this.config.contextFrames) : undefined
        const what: RenderWhat = {label: `clip ${clip.id}`, spec, kind: 'clip', workflow: this.config.videoWorkflow, resolution: this.config.videoResolution}
        let {seed, size: expected} = await this.render(what, target, '.mp4', prepare)
        seed = await this.retryLeaks(what, clip.id, file, seed, prepare, `bun run leak-scan ${this.projectId} lists it again`)
        if (context) await this.joinContext(target, clip.id, clip.startsFrom!, context)
        const rendered = await probeVideo(target)
        // every server has to deliver the size asked for - a clip of another size is scaled in the final video. The sizes
        // are computed by the workflow file, not by the server (comfy/helpers.ts, pixelSize); what still comes out at
        // another size is put away and fails, instead of being used
        if (expected && (rendered.width !== expected.width || rendered.height !== expected.height)) {
            const keep = archiveFiles(this.projectDir, `size-${versionStamp()}-${file.replace(/[\/]/g, '-')}`, [file])
            throw new Error(`${file} came out at ${rendered.width}x${rendered.height}, ${this.config.videoWorkflow} renders ${JSON.stringify(this.config.videoResolution)} (${this.config.videoAspect}) at ${expected.width}x${expected.height} - put away in ${keep}; the server that rendered it computes another size`)
        }
        if (rendered.frames < clip.frames) log.warn(`${file} has ${rendered.frames} frames, the clip needs ${clip.frames} - delete it and render again`)
        await Bun.write(`${target}.json`, JSON.stringify({
            workflow: this.config.videoWorkflow,
            seed,
            resolution: this.config.videoResolution,
            ...(this.config.videoAspect !== '16:9' ? {aspect: this.config.videoAspect} : {}),
            ...(clip.startsFrom ? {startsFrom: clip.startsFrom} : {}),
            // started on the last frames of the clip before, its head cut off - as the film's sidecar says it (lib/film/render.ts)
            ...(context ? {contextFrames: context.frames} : {}),
            frameStart: clip.frameStart,
            frames: clip.frames,            // used in the final video
            fingerprint: request,           // what it was made from (lib/provenance.ts) - another one now makes it stale
            renderedFrames: rendered.frames,
            size: `${rendered.width}x${rendered.height}`,
            request: clipRequestRef(clip.id),
        }, null, 2))
        log.step('Saved', `${file} ${styles.muted(`${rendered.frames} frames, ${clip.frames} used · ${this.took(target)}`)}`)
        await this.saveBoundaryFrames(clip, target, rendered.frames)
    }

    /** The job of a music-video clip, or of a part of it: the same pictures, stems and song, from `songStart` on. */
    private async clipJob(clip: ClipRequest, stemFiles: Record<string, string>, job: { prompt: string, songStart: number, frames: number, seed: number, startFrame?: string, startClip?: string, endFrame?: { image: string, at: number }, preview?: { scale: number, steps: number }, filenamePrefix: string, extraUploads?: { from: string, to: string }[], workflow: VideoWorkflowModule }) {
        const songRemote = `${this.remoteDir}/stems/song${extname(stemFiles.song!)}`
        const uploads = [
            ...clip.assets.pictures.filter(p => p.kind !== 'frame').map(p => ({from: join(this.projectDir, p.file), to: `${this.remoteDir}/${p.file}`})),
            ...clip.assets.audio.map(a => ({from: stemFiles[a.stem!]!, to: `${this.remoteDir}/stems/${a.stem}.wav`})),
            {from: stemFiles.song!, to: songRemote},
            ...(job.extraUploads ?? []),
        ]
        const result = job.workflow.default({
            prompt: job.prompt,
            pictures: clip.assets.pictures.filter(p => p.kind !== 'frame').map(p => `${this.remoteDir}/${p.file}`),
            audios: clip.assets.audio.map(a => `${this.remoteDir}/stems/${a.stem}.wav`),
            ...(clip.assets.audio.some(a => a.stem === 'vocals') ? {vocals: `${this.remoteDir}/stems/vocals.wav`} : {}),
            song: songRemote,
            ...(job.startClip ? {startClip: job.startClip} : job.startFrame ? {startFrame: job.startFrame} : {}),
            ...(job.endFrame ? {endFrame: job.endFrame} : {}),
            ...(job.preview ? {preview: job.preview} : {}),
            songStart: job.songStart,
            frames: job.frames,
            duration: secondsAt(job.frames),
            seed: job.seed,
            resolution: this.config.videoResolution,
            aspect: this.config.videoAspect,
            filenamePrefix: job.filenamePrefix,
        })
        return {result, uploads, meta: {seed: job.seed}}
    }

    /**
     * A clip as a cheap render into previews/ (--preview): never a file of videos/, it leaves no first or last frame behind and stays out of
     * what is current or stale. A clip that goes on from another starts on the last frame of that one's preview or render, and says it is approximate.
     */
    private async renderClipPreview(clip: ClipRequest, stemFiles: Record<string, string>) {
        const file = `previews/${clip.id}.mp4`
        const target = join(this.projectDir, file)
        if (existsSync(target)) return log.step('Exists', styles.muted(file))
        const missing = clip.assets.pictures.filter(p => p.kind !== 'frame' && !existsSync(join(this.projectDir, p.file)))
        if (missing.length) return log.warn(`${clip.id}: no preview - missing pictures: ${missing.map(p => p.file).join(', ')}`)
        if (!(stemFiles.song && existsSync(stemFiles.song))) return log.warn(`${clip.id}: no preview - missing the full song`)
        const start = clip.startsFrom ? await this.previewStart(clip.startsFrom) : undefined
        if (clip.startsFrom && !start) return log.warn(`${clip.id}: no preview - it goes on from ${clip.startsFrom}, which has neither a preview nor a render yet`)
        const preview = this.config.preview
        const spec: RenderSpec = {...clipSpec(clip, this.projectDir, this.config), parts: ['preview', preview, clip.prompt, clip.frames, this.config.videoWorkflow, start ?? '']}
        const what: RenderWhat = {label: `preview ${clip.id}`, spec, kind: 'clip', workflow: this.config.videoWorkflow, resolution: `preview ${preview.scale}`}
        mkdirSync(dirname(target), {recursive: true})
        const {seed} = await this.render(what, target, '.mp4', async () => {
            const workflow = await loadWorkflow<VideoWorkflowModule>(this.config.videoWorkflow)
            this.noteResolution(workflow.recommendedResolution)
            const frames = workflow.renderFrames?.(clip.frames) ?? clip.frames
            const remote = start && `${this.remoteDir}/${start}`
            return this.clipJob(clip, stemFiles, {
                prompt: clip.prompt, songStart: secondsAt(clip.frameStart), frames, seed: clipSeed(this.config.seed, clip.id), preview, workflow,
                filenamePrefix: `${this.remoteDir}/previews/${clip.id}`,
                ...(start ? {startFrame: remote, extraUploads: [{from: join(this.projectDir, start), to: remote!}]} : {}),
            })
        })
        await this.savePreviewRecord(clip, target, seed)
    }

    /** The picture a preview starts on: the last frame of the clip before as the preview shows it - its preview, else its render. */
    protected async previewStart(id: string): Promise<string | undefined> {
        const source = [`previews/${id}.mp4`, `videos/${id}.mp4`].find(file => existsSync(join(this.projectDir, file)))
        if (!source) return undefined
        const video = join(this.projectDir, source)
        const record = existsSync(`${video}.json`) ? JSON.parse(readFileSync(`${video}.json`, 'utf8')) as { frames?: number } : {}
        const frames = Math.min(record.frames ?? Infinity, framesOnGrid(await probeVideo(video)))
        const frame = `previews/${id}_lf.png`
        mkdirSync(join(this.projectDir, 'previews'), {recursive: true})
        await extractFrame(video, frames - 1, join(this.projectDir, frame))
        return frame
    }

    protected async savePreviewRecord(clip: { id: string, frames: number, startsFrom?: string }, target: string, seed: number) {
        const rendered = await probeVideo(target)
        await Bun.write(`${target}.json`, JSON.stringify({
            preview: true, workflow: this.config.videoWorkflow, seed, ...this.config.preview,
            ...(clip.startsFrom ? {approximate: true, startsFrom: clip.startsFrom} : {}),
            frames: clip.frames, renderedFrames: rendered.frames, size: `${rendered.width}x${rendered.height}`,
        }, null, 2))
        log.step('Saved', `previews/${clip.id}.mp4 ${styles.muted(`${rendered.width}x${rendered.height}, ${clip.frames} frames${clip.startsFrom ? ' - approximate' : ''} · ${this.took(target)}`)}`)
    }

    /**
     * Renders part of a clip again and puts it into the clip (--retake). The whole old clip goes to old/attempts first, so it stays a version
     * to go back to. The request it was made from does not change: the clip stays current. The frames around the part guide the render.
     */
    protected async retake(clip: { id: string, frames: number, shots?: { at: number }[], prompt: string }, ask: RetakeAsk, wantedLead: number, job: (plan: RetakePlan, guides: { prompt: string, startClip?: string, startFrame?: string, endFrame?: { image: string, at: number }, uploads: { from: string, to: string }[], seed: number, filenamePrefix: string }) => Promise<{ result: WorkflowResult, uploads: { from: string, to: string }[], meta: { seed: number } }>, renderFrames: (frames: number) => number) {
        const file = `videos/${clip.id}.mp4`
        const video = join(this.projectDir, file)
        if (!existsSync(video)) throw new Error(`${clip.id} is not rendered yet - there is nothing to render part of`)
        const info = await probeVideo(video)
        const fileFrames = framesOnGrid(info)
        const cuts = shotCuts(clip.frames, (clip.shots ?? []).map(s => s.at), await sceneScores(video))
        const plan = planRetake(retakeFrames(ask, fileFrames, cuts), fileFrames, wantedLead, renderFrames)
        const work = `assets/clips/${clip.id}_retake`
        mkdirSync(join(this.projectDir, 'assets', 'clips'), {recursive: true})
        const uploads: { from: string, to: string }[] = []
        const remote = (name: string) => {
            uploads.push({from: join(this.projectDir, name), to: `${this.remoteDir}/${name}`})
            return `${this.remoteDir}/${name}`
        }
        const guides: { startClip?: string, startFrame?: string, endFrame?: { image: string, at: number } } = {}
        if (plan.lead) {
            const head = `${work}_head.mp4`
            await runProcess(['ffmpeg', '-y', '-v', 'error', '-i', video, '-vf', `trim=start_frame=${plan.first - plan.lead}:end_frame=${plan.first},setpts=PTS-STARTPTS,${GUIDE_SCALE}`, '-an', '-c:v', 'libx264', '-crf', '10', '-pix_fmt', 'yuv420p', join(this.projectDir, head)],
                {errorMessage: err => `ffmpeg could not cut the frames before the part of ${clip.id}:\n${err}`})
            guides.startClip = remote(head)
        } else if (plan.singleStart) {
            const before = `${work}_before.png`
            await extractFrame(video, plan.first - 1, join(this.projectDir, before))
            await smallerPicture(join(this.projectDir, before))
            guides.startFrame = remote(before)
        }
        if (plan.endAt !== undefined) {
            const after = `${work}_after.png`
            await extractFrame(video, plan.end, join(this.projectDir, after))
            await smallerPicture(join(this.projectDir, after))
            guides.endFrame = {image: remote(after), at: plan.endAt}
        }
        log.warn('--retake is not proven yet: on a 32 GB Radeon its two-pass job ran out of memory while encoding the guides, and one try took the server down (#157) - try it on one short part first')
        log.step('Part', `${clip.id} ${styles.muted(`frames ${plan.first}-${plan.end} of ${fileFrames}, ${plan.lead ? `${plan.lead} frames before it` : plan.singleStart ? 'the frame before it' : 'from its start'}${plan.endAt !== undefined ? ', the frame after it' : ''} as guides - ${plan.render} frames rendered`)}`)
        const prompt = retakePrompt(clip.prompt, shotsIn(plan, cuts))
        const rendered = join(this.projectDir, `${work}.mp4`)
        const seed = clipSeed(this.config.seed, clip.id)
        const spec: RenderSpec = {kind: 'clip', id: clip.id, parts: ['retake', plan.first, plan.end, prompt, this.config.videoWorkflow, fileFingerprint(video)]}
        await this.render<{ seed: number }>({label: `part of ${clip.id}`, spec, kind: 'clip', workflow: this.config.videoWorkflow, resolution: this.config.videoResolution}, rendered, '.mp4',
            () => job(plan, {...guides, prompt, uploads, seed, filenamePrefix: `${this.remoteDir}/videos/${clip.id}-retake`}))

        const spliced = join(this.projectDir, `${work}_spliced.mp4`)
        await spliceVideo({original: video, rendered, plan, width: info.width, height: info.height, target: spliced})
        const record = existsSync(`${video}.json`) ? JSON.parse(readFileSync(`${video}.json`, 'utf8')) as Record<string, unknown> & { retakes?: unknown[] } : {}
        const keep = archiveFiles(this.projectDir, `${clip.id}-${versionStamp()}`, [file, `${file}.json`, boundaryFrameAsset(clip.id, 'ff'), boundaryFrameAsset(clip.id, 'lf')])
        renameSync(spliced, video)
        await Bun.write(`${video}.json`, JSON.stringify({...record, retakes: [...(record.retakes ?? []), {first: plan.first, end: plan.end, seed, at: new Date().toISOString()}]}, null, 2))
        rmSync(rendered, {force: true})
        const frames = await probeVideo(video)
        log.step('Saved', `${file} ${styles.muted(`frames ${plan.first}-${plan.end} are new, the old clip is in ${keep}`)}`)
        // the first and last frame of a clip after a part of it changed: made again from the file
        await this.saveBoundaryFrames(clip, video, frames.frames)
    }

    /**
     * One more view of a place: a short shot that starts on the place's anchor and moves to what is asked for, and the last frame of it. From
     * the anchor, so the look stays the same. Kept next to the sheet (views/view-<n>.png), with its name and what it shows beside it.
     */
    async renderExtraView(locationId: string, n: number, name: string, shows: string): Promise<string> {
        const sheet = sequenceSheetDir('location', locationId)
        const anchor = sheetAnchor(sheet)
        const video = `${sheetViews(sheet)}/view-${n}.mp4`
        const picture = `${sheetViews(sheet)}/view-${n}.png`
        const prompt = `The camera moves through this same place in one slow, unbroken move and comes to rest ${name}, where it shows ${shows}. The same place, the same light, the same fixtures throughout: nothing is added or doubled. Nobody is in the picture.`
        mkdirSync(join(this.projectDir, dirname(video)), {recursive: true})
        const spec: RenderSpec = {kind: 'sequence', id: `${locationId}-view-${n}`, parts: [prompt, this.config.sequenceWorkflow, fileFingerprint(join(this.projectDir, anchor))]}
        const {seed} = await this.render({label: `view ${n} of ${locationId}`, spec, kind: 'picture', workflow: this.config.sequenceWorkflow}, join(this.projectDir, video), '.mp4', async () => {
            const seed = resolveSeed(this.config.seed)
            const {default: sequenceWorkflow} = await loadWorkflow<{ default: SequenceWorkflow }>(this.config.sequenceWorkflow)
            const result = sequenceWorkflow({prompt, startFrame: `${this.remoteDir}/${anchor}`, frames: EXTRA_VIEW_FRAMES, orientation: 'landscape', resolution: -1, seed, filenamePrefix: `${this.remoteDir}/${video.replace(/\.mp4$/, '')}`})
            return {result, uploads: [{from: join(this.projectDir, anchor), to: `${this.remoteDir}/${anchor}`}], meta: {seed}}
        })
        const rendered = await probeVideo(join(this.projectDir, video))
        await extractFrame(join(this.projectDir, video), rendered.frames - 1, join(this.projectDir, picture))
        await Bun.write(join(this.projectDir, `${picture}.json`), JSON.stringify({name, shows, seed, prompt, workflow: this.config.sequenceWorkflow}, null, 2))
        log.step('Saved', `${picture} ${styles.muted(this.took(join(this.projectDir, video)))}`)
        return picture
    }

    /**
     * A finished clip made larger with the second pass of a two-pass render (comfy/workflows/h3-refine.ts), with its prompt, pictures and, in a music video, its
     * tracks and song. It keeps its own sound and its own length. `song`: the stems and the song of a music video.
     */
    async renderRefined(clip: { id: string, prompt: string, frames: number, frameStart: number, assets: { pictures: { kind: string, file: string }[], audio?: { stem?: string }[] } }, source: string, target: string, size: PixelSize, denoise: number, song?: Record<string, string>) {
        const missing = clip.assets.pictures.filter(p => p.kind !== 'frame' && !existsSync(join(this.projectDir, p.file)))
        if (missing.length) throw new Error(`${clip.id}: missing pictures: ${missing.map(p => p.file).join(', ')}`)
        const stems = (clip.assets.audio ?? []).map(a => a.stem!)
        const lost = stems.filter(stem => !song?.[stem] || !existsSync(song[stem]!))
        if (song && lost.length) throw new Error(`${clip.id}: missing stem file(s): ${lost.join(', ')}`)
        if (song && !existsSync(song.song!)) throw new Error(`${clip.id}: the song is missing: ${song.song}`)
        const {default: refine, renderFrames} = await loadWorkflow<typeof import("../comfy/workflows/h3-refine.ts")>('h3-refine')
        const info = await probeVideo(source)
        const frames = framesOnGrid(info)
        const length = renderFrames(frames)
        // what goes up is the clip, or the clip filled up to a length the model takes
        const work = `${target.replace(/\.mp4$/, '')}`
        const clipFile = length === frames ? source : `${work}.padded.mp4`
        if (length !== frames) await paddedClip(source, clipFile, length - frames)
        const remoteClip = `${this.remoteDir}/${relative(this.projectDir, target).replace(/\\/g, '/').replace(/\.mp4$/, '.source.mp4')}`
        const rendered = `${work}.rendered.mp4`
        const spec: RenderSpec = {kind: 'clip', id: clip.id, parts: ['refine', fileFingerprint(source), clip.prompt, size, denoise]}
        const songRemote = song ? `${this.remoteDir}/stems/song${extname(song.song!)}` : undefined
        const {seed} = await this.render({label: `refine ${clip.id}`, spec, kind: 'clip', workflow: 'h3-refine', resolution: `${size.width}x${size.height}`}, rendered, '.mp4', async () => {
            const seed = clipSeed(this.config.seed, clip.id)
            const pictures = clip.assets.pictures.filter(p => p.kind !== 'frame')
            const result = refine({
                prompt: clip.prompt,
                pictures: pictures.map(p => `${this.remoteDir}/${p.file}`),
                video: remoteClip,
                frames: length,
                size,
                aspect: this.config.videoAspect,
                denoise,
                ...(song ? {audios: stems.map(stem => `${this.remoteDir}/stems/${stem}.wav`), song: songRemote, songStart: secondsAt(clip.frameStart), duration: secondsAt(length)} : {}),
                seed,
                filenamePrefix: `${this.remoteDir}/refined/${basename(dirname(target))}/${clip.id}`,
            })
            const uploads = [
                ...pictures.map(p => ({from: join(this.projectDir, p.file), to: `${this.remoteDir}/${p.file}`})),
                {from: clipFile, to: remoteClip},
                ...(song ? [...stems.map(stem => ({from: song[stem]!, to: `${this.remoteDir}/stems/${stem}.wav`})), {from: song.song!, to: songRemote!}] : []),
            ]
            return {result, uploads, meta: {seed}}
        })
        await withOriginalSound(rendered, source, frames, length !== frames, target)
        rmSync(rendered, {force: true})
        if (clipFile !== source) rmSync(clipFile, {force: true})
        await Bun.write(`${target}.json`, JSON.stringify({workflow: 'h3-refine', seed, denoise, size: `${size.width}x${size.height}`, frames, source: relative(this.projectDir, source).replace(/\\/g, '/'), sourceFingerprint: fileFingerprint(source)}, null, 2))
        log.step('Saved', `${relative(this.projectDir, target).replace(/\\/g, '/')} ${styles.muted(`${size.width}x${size.height} · ${this.took(rendered)}`)}`)
    }

    /** A finished clip made larger with the latent upscaler alone (comfy/workflows/h3-latent-upscale.ts): nothing sampled. It keeps its own sound and its own length. */
    async renderLatentUpscaled(clipId: string, source: string, target: string, size: PixelSize) {
        const {default: upscale} = await loadWorkflow<typeof import("../comfy/workflows/h3-latent-upscale.ts")>('h3-latent-upscale')
        const {renderFrames} = await loadWorkflow<typeof import("../comfy/workflows/h3-refine.ts")>('h3-refine')
        const frames = framesOnGrid(await probeVideo(source))
        const length = renderFrames(frames)
        const clipFile = length === frames ? source : target.replace(/\.mp4$/, '.padded.mp4')
        if (length !== frames) await paddedClip(source, clipFile, length - frames)
        const remoteClip = `${this.remoteDir}/${relative(this.projectDir, target).replace(/\\/g, '/').replace(/\.mp4$/, '.source.mp4')}`
        const rendered = target.replace(/\.mp4$/, '.rendered.mp4')
        const spec: RenderSpec = {kind: 'clip', id: clipId, parts: ['latent', fileFingerprint(source), size]}
        await this.render({label: `latent upscale ${clipId}`, spec, kind: 'clip', workflow: 'h3-latent-upscale', resolution: `${size.width}x${size.height}`}, rendered, '.mp4', async () => ({
            result: upscale({video: remoteClip, size, filenamePrefix: `${this.remoteDir}/refined/${basename(dirname(target))}/${clipId}`}),
            uploads: [{from: clipFile, to: remoteClip}],
            meta: {},
        }))
        await withOriginalSound(rendered, source, frames, length !== frames, target)
        rmSync(rendered, {force: true})
        if (clipFile !== source) rmSync(clipFile, {force: true})
        await Bun.write(`${target}.json`, JSON.stringify({workflow: 'h3-latent-upscale', size: `${size.width}x${size.height}`, frames, source: relative(this.projectDir, source).replace(/\\/g, '/'), sourceFingerprint: fileFingerprint(source)}, null, 2))
        log.step('Saved', `${relative(this.projectDir, target).replace(/\\/g, '/')} ${styles.muted(`${size.width}x${size.height}`)}`)
    }

    /** A finished clip made larger with an upscale model on ComfyUI, frame by frame (comfy/workflows/video-upscale.ts). It keeps its own sound. */
    async renderUpscaled(clipId: string, source: string, target: string, model: string, size: PixelSize) {
        const {default: upscale} = await loadWorkflow<typeof import("../comfy/workflows/video-upscale.ts")>('video-upscale')
        const remoteClip = `${this.remoteDir}/${relative(this.projectDir, target).replace(/\\/g, '/').replace(/\.mp4$/, '.source.mp4')}`
        const rendered = target.replace(/\.mp4$/, '.rendered.mp4')
        const spec: RenderSpec = {kind: 'clip', id: clipId, parts: ['upscale', fileFingerprint(source), model, size]}
        await this.render({label: `upscale ${clipId}`, spec, kind: 'clip', workflow: 'video-upscale', resolution: `${size.width}x${size.height}`}, rendered, '.mp4', async () => ({
            result: upscale({video: remoteClip, model, size, filenamePrefix: `${this.remoteDir}/refined/${basename(dirname(target))}/${clipId}`}),
            uploads: [{from: source, to: remoteClip}],
            meta: {},
        }))
        await withOriginalSound(rendered, source, 0, false, target)
        rmSync(rendered, {force: true})
        await Bun.write(`${target}.json`, JSON.stringify({workflow: 'video-upscale', model, size: `${size.width}x${size.height}`, source: relative(this.projectDir, source).replace(/\\/g, '/'), sourceFingerprint: fileFingerprint(source)}, null, 2))
        log.step('Saved', `${relative(this.projectDir, target).replace(/\\/g, '/')} ${styles.muted(`${size.width}x${size.height}`)}`)
    }

    /** A part of a music-video clip rendered again, with the song at its place. */
    async renderClipRetake(clip: ClipRequest, stemFiles: Record<string, string>, ask: RetakeAsk) {
        const workflow = await loadWorkflow<VideoWorkflowModule>(this.config.videoWorkflow)
        this.noteResolution(workflow.recommendedResolution)
        if (!(stemFiles.song && existsSync(stemFiles.song))) throw new Error(`${clip.id}: the full song is missing`)
        await this.retake({...clip, shots: clip.shots}, ask, RETAKE_LEAD, async (plan, guides) => {
            const job = await this.clipJob(clip, stemFiles, {
                prompt: guides.prompt, songStart: secondsAt(clip.frameStart + plan.first - plan.lead), frames: plan.render, seed: guides.seed, workflow, filenamePrefix: guides.filenamePrefix,
                startClip: guides.startClip, startFrame: guides.startFrame, endFrame: guides.endFrame, extraUploads: guides.uploads,
            })
            return job
        }, frames => workflow.renderFrames?.(frames) ?? frames)
    }

    /**
     * A rendered clip with `multiplier` times its frames (frame interpolation, comfy/workflows/frame-interpolate.ts), written
     * to `target` at FPS * multiplier. Only the frames the final video uses, cut into the clip's shots where the picture cuts. Rendered again when
     * the clip, its cuts, the model or the multiplier changed.
     */
    async renderInterpolation(clip: { id: string, frames: number, shots?: { at: number }[] }, model: string, multiplier: number, target: string, source?: string) {
        const video = source ?? join(this.projectDir, 'videos', `${clip.id}.mp4`)
        if (!existsSync(video)) throw new Error(`${clip.id}: ${video} is not rendered yet`)
        // the cuts as the picture has them - the model cuts near the planned time, not on it (lib/interpolate.ts)
        const pieces = shotPieces(clip.frames, shotCuts(clip.frames, (clip.shots ?? []).map(s => s.at), await sceneScores(video)))
        const spec: RenderSpec = {kind: 'interpolation', id: clip.id, parts: [fileFingerprint(video), pieces, model, multiplier]}
        if (existsSync(target) && freshness(target, specId(spec)) === 'current') return log.step('Exists', basename(target))
        mkdirSync(dirname(target), {recursive: true})
        await this.render({label: `interpolation ${clip.id}`, spec, kind: 'interpolation', workflow: 'frame-interpolate'}, target, '.mp4', async () => {
            // another version of a clip under its own name on the server: it must not be taken for this one
            const remote = `${this.remoteDir}/${source ? relative(this.projectDir, source).replace(/\\/g, '/') : `videos/${clip.id}.mp4`}`
            const {default: interpolate} = await loadWorkflow<{ default: InterpolationWorkflow }>('frame-interpolate')
            const result = interpolate({video: remote, pieces, model, multiplier, filenamePrefix: `${this.remoteDir}/${source ? `${relative(this.projectDir, dirname(source)).replace(/\\/g, '/')}/interpolated` : 'interpolated'}/${clip.id}`})
            return {result, uploads: [{from: video, to: remote}], meta: {}}
        })
        const rendered = await probeVideo(target)
        const expected = clip.frames * multiplier
        if (rendered.frames !== expected) log.warn(`${basename(target)} has ${rendered.frames} frames, ${expected} expected`)
        await Bun.write(`${target}.json`, JSON.stringify({workflow: 'frame-interpolate', model, multiplier, pieces, frames: rendered.frames, fps: rendered.fps, fingerprint: specId(spec)}, null, 2))
        log.step('Saved', `${basename(target)} ${styles.muted(`${rendered.frames} frames at ${rendered.fps} fps · ${this.took(target)}`)}`)
    }

    /**
     * A clip that came out as the reference pictures lined up on their grey backdrop depends on the seed: the one that did
     * is put away (old/leaks/) and the clip rendered again, up to config.leakRetries times. Returns the seed of the clip
     * kept. `rescan`: what the warning says finds it again - the music video's and the film's clips.
     */
    protected async retryLeaks<M extends { seed: number }>(what: RenderWhat, id: string, file: string, seed: number, prepare: () => Promise<{ result: WorkflowResult, uploads: { from: string, to: string }[], meta: M }>, rescan: string): Promise<number> {
        const target = join(this.projectDir, file)
        for (let tries = 0; this.config.leakRetries > 0; tries++) {
            const leaked = await backdropSeconds(target)
            if (!hasBackdropRun(leaked)) break
            const where = `${leaked.length} sample(s) between ${leaked[0]!.toFixed(1)} and ${leaked.at(-1)!.toFixed(1)} s`
            if (this.config.seed !== -1) {
                log.warn(`${file} has a grey studio backdrop (${where}) - the seed is fixed in config.json, so rendering it again gives the same clip. Use "seed": -1, or --again with another seed`)
                break
            }
            const put = join(this.projectDir, 'old', 'leaks', `${id}-seed-${seed}.mp4`)
            if (tries >= this.config.leakRetries) {
                log.warn(`${file} still has a grey studio backdrop (${where}) after ${tries} more render(s) - kept as it is, ${rescan}`)
                break
            }
            mkdirSync(dirname(put), {recursive: true})
            renameSync(target, put)
            recordTiming({kind: 'clip', name: this.config.videoWorkflow, seconds: 0, outcome: 'retry', reason: 'leak'})
            log.warn(`${file} has a grey studio backdrop (${where}) - rendered again with another seed (${tries + 1} of ${this.config.leakRetries}); the first one is in ${styles.muted(`old/leaks/${basename(put)}`)}`)
            seed = (await this.render(what, target, '.mp4', prepare)).seed
        }
        return seed
    }

    /**
     * The head of a clip rendered with context frames is the clip before again: cut off, so the file starts on this clip's
     * own first frame like every other one.
     */
    protected async joinContext(target: string, id: string, startsFrom: string, context: ClipContext) {
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
    protected async contextOf(id: string, wanted: number, shown?: number): Promise<ClipContext | undefined> {
        const video = join(this.projectDir, 'videos', `${id}.mp4`)
        const sidecar = `${video}.json`
        if (!existsSync(video) || !existsSync(sidecar)) return undefined
        const used = shown ?? (JSON.parse(readFileSync(sidecar, 'utf8')) as { frames: number }).frames
        const frames = contextLength(wanted, used)
        if (!frames) return undefined
        const asset = `assets/clips/${id}_tail${frames}.mp4`
        const file = join(this.projectDir, asset)
        mkdirSync(dirname(file), {recursive: true})
        await runProcess(['ffmpeg', '-y', '-v', 'error', '-i', video, '-vf', `trim=start_frame=${used - CONTEXT_SETTLE - frames}:end_frame=${used - CONTEXT_SETTLE},setpts=PTS-STARTPTS`, '-an', '-c:v', 'libx264', '-crf', '10', '-pix_fmt', 'yuv420p', file],
            {errorMessage: err => `ffmpeg could not cut the last ${frames} frames of ${id}:\n${err}`})
        return {file, asset, frames, video, used}
    }

    /**
     * Saves the first and the last frame the clip contributes to the final video: frame 0 and frame `clip.frames - 1` -
     * not the file's last frame, the frames after it are only padding for the model's lengths (see assembleFinal).
     */
    // renderedFrames: set for a clip just rendered - its frames are always rewritten; without, only missing ones are made
    protected async saveBoundaryFrames(clip: { id: string, frames: number }, video: string, renderedFrames?: number) {
        const [first, last] = [boundaryFrameAsset(clip.id, 'ff'), boundaryFrameAsset(clip.id, 'lf')]
        if (renderedFrames === undefined && existsSync(join(this.projectDir, first)) && existsSync(join(this.projectDir, last))) return
        mkdirSync(join(this.projectDir, dirname(first)), {recursive: true})
        const frames = this.framesUsed(clip, renderedFrames ?? (await probeVideo(video)).frames)
        await extractFrame(video, 0, join(this.projectDir, first))
        await extractFrame(video, frames - 1, join(this.projectDir, last))
        log.step('Saved', `${first}, ${last} ${styles.muted(`frames 0 and ${frames - 1}`)}`)
    }

    /** How many frames of the file the video uses. A clip rendered too short (warned about above) ends on its own last frame. */
    protected framesUsed(clip: { frames: number }, available: number) {
        return Math.min(clip.frames, available)
    }

    /**
     * Renders one file, resumable: a queued job is recorded in `<target>.pending.json`. If feverslop-ts stops while
     * ComfyUI is still rendering (Ctrl+C, crash, sleep), the next run attaches to that job - or downloads its result
     * if it finished in the meantime - instead of rendering again. Returns the meta of the job that made the file.
     */
    protected async render<M>(what: RenderWhat, target: string, extension: string | string[], prepare: () => Promise<{ result: WorkflowResult, uploads: { from: string, to: string }[], meta: M }>): Promise<M> {
        const label = what.label
        // a fingerprint of what the job is made from: a job queued for another request is not the one to take the result of
        const request = specId(what.spec)
        const servers = await this.connect()
        const pendingFile = `${target}.pending.json`
        let initial = await readPending<M>(pendingFile)
        if (initial && initial.request !== undefined && initial.request !== request) {
            const kept = `${target}.pending-${initial.promptId}.json`
            renameSync(pendingFile, kept)
            log.warn(`${label}: the job queued at ${formatClock(initial.queuedAt)} was made from another request than the plan has now - not used (${basename(kept)} keeps it), rendering again`)
            initial = undefined
        }
        // a server that went down in this run is not a home any more: the job is rendered again elsewhere
        let home = initial ? this.homeOf(label, initial, servers.filter(s => !this.down.has(s.name))) : undefined
        if (!home) this.settle(target)

        // a job already finished on its server needs no free one: only its result is fetched
        if (home && initial && await this.jobState(home, initial.promptId) === 'finished') {
            this.settle(target)
            const started = Date.now()
            const trace: Trace = []
            log.step('Resuming', `${styles.name(label)} ${styles.muted(`@${home.name}, job ${initial.promptId}, queued at ${formatClock(initial.queuedAt)}, finished`)}`)
            let failure: Error | undefined
            try {
                await this.downloadResult(label, target, extension, home, initial, trace)
                return initial.meta
            } catch (e) {
                failure = e instanceof Error ? e : new Error(String(e))
                throw e
            } finally {
                this.renderMs.set(target, (this.renderMs.get(target) ?? 0) + Date.now() - started)
                await this.keepRender(what, home, initial, trace, started, failure)
            }
        }

        let timeouts = 0
        for (;;) {
            const server = await this.acquire(home?.name)
            this.settle(target)
            const started = Date.now()
            const trace: Trace = []
            let pending: PendingJob<M> | undefined
            let failure: Error | undefined
            let again = false
            let resume = false
            try {
                pending = await this.resumeOrQueue(label, server, pendingFile, home ? initial : undefined, prepare, request)
                await this.downloadResult(label, target, extension, server, pending, trace)
                return pending.meta
            } catch (e) {
                failure = e instanceof Error ? e : new Error(String(e))
                // a failure on a server that does not answer any more is the server's, not the job's: it is taken out of
                // the run and the job goes to another one - unless there is none left
                if (!(await this.answers(server))) {
                    this.markDown(server)
                    again = this.connected.some(s => !this.down.has(s.name))
                    if (again) log.warn(`${label}: rendered again on another server (${failure.message.slice(0, 160)})`)
                }
                // A request that hung and timed out on a server that answers again (a network blip, a job that finished
                // meanwhile): the job is on the server - ask for it again instead of ending the whole run
                if (!again && timeouts < 2 && /timed out|timeout/i.test(`${failure.name} ${failure.message}`)) {
                    timeouts++
                    again = resume = true
                    log.warn(`${label}: ${failure.message.slice(0, 160)} - asking ${server.name} again (${timeouts}/2)`)
                }
                if (!again) throw nameService(failure, `${label} on ${server.name} (${server.url})`, label)
            } finally {
                this.release(server)
                this.renderMs.set(target, (this.renderMs.get(target) ?? 0) + Date.now() - started)
                await this.keepRender(what, server, pending, trace, started, failure)
            }
            // the job queued just now is in the pending file - taken up again (on its server) or, if gone, rendered anew
            initial = resume ? await readPending<M>(pendingFile) : initial
            home = resume && initial ? this.homeOf(label, initial, this.connected.filter(s => !this.down.has(s.name))) : undefined
        }
    }

    /** Keeps the measurement of one job: the setup the graph says, where it ran, queue vs. compute, the phases. Numbers and names only. */
    private async keepRender(what: RenderWhat, server: Server, job: PendingJob<unknown> | undefined, trace: Trace, started: number, failure?: Error) {
        // a resumed job was queued before this run: its queue time and phases are not known
        const fresh = !!job && job.queuedAt >= started
        const firstNode = trace[0]?.at
        const queueMs = fresh && firstNode ? Math.max(0, firstNode - job.queuedAt) : undefined
        const seconds = (Date.now() - started - (queueMs ?? 0)) / 1000
        const setup = job?.setup
        recordTiming({
            kind: what.kind, name: what.workflow, seconds: Math.round(seconds * 10) / 10,
            ...(failure ? {outcome: 'failed' as const, reason: failure.name} : {}),
            ...(job?.variant ? {variant: job.variant, workflowHash: await workflowHash(what.workflow)} : {}),
            ...(setup ? {setup, ...(setup.frames ? {frames: setup.frames} : {}), ...(setup.pixels ? {pixels: setup.pixels} : {})} : {}),
            server: server.name, ...this.machines.get(server.name),
            ...(job?.cold !== undefined ? {cold: job.cold} : {}),
            ...(queueMs !== undefined ? {queueSeconds: Math.round(queueMs / 100) / 10} : {}),
            ...(fresh && !failure && trace.length ? {phases: accumulatePhases(trace, Date.now())} : {}),
            ...(what.resolution !== undefined ? {resolution: what.resolution} : {}),
        })
    }

    /** How long the job(s) for `target` took, queueing for a free server not counted - '' when none ran in this run. */
    private took(target: string) {
        const ms = this.renderMs.get(target)
        return ms ? formatDuration(ms) : ''
    }

    // a queued job only exists on its own server - files from before several servers: the first one. undefined
    // when that server is no longer reachable/configured - the job is then rendered again from scratch.
    private homeOf<M>(label: string, pending: PendingJob<M>, servers: Server[]): Server | undefined {
        const recorded = pending.server ?? this.servers[0]!
        const byUrl = servers.find(s => s.url === recorded.url)
        const byName = servers.find(s => s.name === recorded.name)
        const home = byUrl ?? byName
        // the name matches but the URL doesn't - the name was likely reused for a different machine
        if (home && !byUrl) log.warn(`${label}: its job was queued on ${recorded.name} (${recorded.url}), which is now configured at ${home.url} - resuming there anyway`)
        if (!home) {
            const why = this.servers.some(s => s.url === recorded.url || s.name === recorded.name) ? 'is unreachable' : 'is no longer configured'
            log.warn(`${label}: its job was queued on ${recorded.name} (${recorded.url}), which ${why} - rendering again`)
        }
        return home
    }

    /** Resumes `pending` if its job is still on `server`, else queues a freshly prepared workflow. */
    private async resumeOrQueue<M>(label: string, server: Server, pendingFile: string, pending: PendingJob<M> | undefined, prepare: () => Promise<{ result: WorkflowResult, uploads: { from: string, to: string }[], meta: M }>, request?: string): Promise<PendingJob<M>> {
        const {api} = server
        if (pending) {
            const state = await this.jobState(server, pending.promptId)
            if (resumesJob(state)) {
                log.step('Resuming', `${styles.name(label)} ${styles.muted(`@${server.name}, job ${pending.promptId}, queued at ${formatClock(pending.queuedAt)}, ${state}`)}`)
                return pending
            }
            log.warn(`${label}: the job queued at ${formatClock(pending.queuedAt)} ${state === 'failed' ? `failed on ${server.name}` : `is no longer on ${server.name}`} - rendering again`)
        }

        log.step('Rendering', `${styles.name(label)} ${styles.muted(`@${server.name}`)}`)
        const {result: {workflow, output}, uploads, meta} = await prepare()
        const prompt = workflow.build({outputs: {result: output}}).workflow
        const backslashed = backslashedRemotePath(uploads, prompt)
        if (backslashed) throw new Error(`${label}: a path on the server is written with \\ - ${backslashed}. A Linux ComfyUI refuses it; build it with /, not path.join`)
        for (const upload of uploads) {
            // into ComfyUI's input folder, under the same name the workflow loads - split with /, whatever system this runs on
            const uploaded = await api.uploadImage(Bun.file(upload.from), posix.basename(upload.to), {subfolder: posix.dirname(upload.to), override: true})
            if (!uploaded) throw new Error(`${label}: upload of ${upload.from} to ${server.name} failed`)
        }
        const queued = await api.queuePrompt(null, prompt).catch(async (error: unknown) => {
            // ComfyUI answers an invalid graph with 400 and the node errors
            const details = error instanceof Response ? await error.text() : String(error)
            throw new Error(`${label}: ComfyUI ${server.name} rejected the workflow - ${details}`)
        })
        const graph = prompt as unknown as Graph
        const nodes = Object.fromEntries(Object.entries(graph).map(([id, node]) => [id, node.class_type]))
        const {variant, setup} = describeGraph(graph)
        // the first job on a server after another set of models has to load them: it is kept apart in the statistics
        const models = JSON.stringify([setup.models, setup.loras])
        const cold = this.lastModels.get(server.name) !== models
        this.lastModels.set(server.name, models)
        const queuedJob: PendingJob<M> = {promptId: queued.prompt_id, server: {name: server.name, url: server.url}, output, nodes, meta, queuedAt: Date.now(), variant, setup, cold, ...(request !== undefined ? {request} : {})}
        // written beside and renamed, so a stop in the middle of the write never leaves half a file behind
        await Bun.write(`${pendingFile}.partial`, JSON.stringify(queuedJob, null, 2))
        renameSync(`${pendingFile}.partial`, pendingFile)
        return queuedJob
    }

    /** Waits for `pending`'s job to finish, then downloads its result to `target` and clears the pending file. */
    private async downloadResult<M>(label: string, target: string, extension: string | string[], server: Server, pending: PendingJob<M>, trace: Trace) {
        const outputs = await this.waitForJob(label, server, pending, trace)

        // the output node's files, e.g. {images: [...]} for SaveImage, {gifs: [...]} for VHS_VideoCombine
        const files = Object.values(outputs ?? {}).flat().filter((f): f is ImageInfo => typeof (f as ImageInfo)?.filename === 'string')
        const extensions = [extension].flat()
        const file = files.findLast(f => extensions.some(e => f.filename.endsWith(e)))
        if (!file) throw new Error(`${label}: the output node saved no ${extensions.join(' or ')} file (got ${files.map(f => f.filename).join(', ') || 'nothing'})`)
        // written next to the target first, so an interrupted download never looks like a finished file
        await Bun.write(`${target}.download`, await server.api.getImage(file))
        renameSync(`${target}.download`, target)
        rmSync(`${target}.pending.json`, {force: true})
    }

    private async jobState({api}: Server, promptId: string): Promise<'queued' | 'running' | 'finished' | 'failed' | 'unknown'> {
        const entry = await api.getHistory(promptId).catch(() => undefined)
        if (entry?.status?.completed) return 'finished'
        if (entry?.status?.status_str === 'error') return 'failed'
        const queue = await api.getQueue()
        if (queue.queue_running.some(item => item[1] === promptId)) return 'running'
        if (queue.queue_pending.some(item => item[1] === promptId)) return 'queued'
        return 'unknown'
    }

    /**
     * Waits for a job, however long it takes. Completion is read from the server's history, so it doesn't depend on
     * the WebSocket - a connection that drops during an hour-long render changes nothing. The WebSocket only feeds
     * the progress shown on the status board.
     */
    private async waitForJob(label: string, server: Server, job: PendingJob<unknown>, trace: Trace) {
        const {api} = server
        let status = 'queued'
        const node = (id: string) => `${job.nodes[id] ?? 'node'} #${id}`
        const off = [
            api.on('executing', event => {
                if (event.detail.prompt_id === job.promptId && event.detail.node) {
                    status = `running ${node(String(event.detail.node))}`
                    trace.push({classType: job.nodes[String(event.detail.node)] ?? 'node', at: Date.now()})
                }
            }),
            api.on('progress', event => {
                if (event.detail.prompt_id === job.promptId) status = `running ${node(String(event.detail.node))}, step ${event.detail.value}/${event.detail.max}`
            }),
            api.on('disconnected', () => void (status = 'connection lost - the job keeps running on the server')),
        ]
        const stopSpinner = startSpinner(() => `${styles.name(label)} ${styles.muted(`@${server.name} ${status}`)}`)
        let missing = 0
        let silentSince: number | undefined
        try {
            while (true) {
                const entry = await api.getHistory(job.promptId).catch(() => undefined)
                if (entry?.status?.completed) return entry.outputs[job.output]
                if (entry?.status?.status_str === 'error') {
                    const error = entry.status.messages.find(([type]) => type === 'execution_error')?.[1]
                    throw new Error(`${label}: ComfyUI job failed${error ? ` in ${error.node_type ?? 'a node'} - ${error.exception_message ?? ''}` : ''}`)
                }
                // not finished - is it still waiting or running? A few misses in a row mean it's gone (server restart)
                let state: 'queued' | 'running' | 'finished' | 'failed' | 'unknown' = 'running'
                try {
                    if (!entry) state = await this.jobState(server, job.promptId)
                    if (silentSince !== undefined) status = 'queued'
                    silentSince = undefined
                } catch {
                    // the server doesn't answer at all - keep waiting for a restart, but not forever
                    silentSince ??= Date.now()
                    status = `${server.name} is not answering`
                    if (Date.now() - silentSince > SERVER_SILENT_MS) {
                        throw new Error(`${label}: ComfyUI ${server.name} (${server.url}) has not answered for ${SERVER_SILENT_MS / 60000} minutes - start it again and run again to pick the job up (it stays queued: ${job.promptId})`)
                    }
                }
                if (state === 'queued' && !status.startsWith('running')) {
                    const queue = await api.getQueue().catch(() => undefined)
                    const ahead = queue ? queue.queue_running.length + queue.queue_pending.findIndex(item => item[1] === job.promptId) : 0
                    status = boardStatus(state, status, ahead)
                } else if (silentSince === undefined) status = boardStatus(state, status)
                missing = state === 'unknown' ? missing + 1 : 0
                if (missing >= 3) throw new Error(`${label}: the job disappeared from ${server.name} (restarted?) - run again to render it again`)
                await Bun.sleep(5000)
            }
        } finally {
            stopSpinner()
            for (const unsubscribe of off) unsubscribe()
        }
    }
}

/** The recorded job of a render, or undefined when there is none - or when the file is damaged (a stop in the middle of a write). */
async function readPending<M>(file: string): Promise<PendingJob<M> | undefined> {
    if (!existsSync(file)) return undefined
    try {
        return await Bun.file(file).json()
    } catch (e) {
        log.warn(`${basename(file)} is damaged (${e instanceof Error ? e.message : e}) - ignored, the clip is queued again`)
        return undefined
    }
}

type PendingJob<M> = {
    request?: string,                         // fingerprint of the request the job was queued for (lib/provenance.ts) - missing in files from before
    promptId: string,
    server?: { name: string, url: string },   // missing in files from before several servers
    output: string,                           // output node id
    nodes: Record<string, string>,            // node id -> class_type, for the progress display
    meta: M,
    queuedAt: number,
    variant?: string,                         // the id of the graph's knobs and what the graph says (lib/graph.ts) - for the statistics
    setup?: GraphSetup,
    cold?: boolean,                           // the first job on that server with these models
}

const formatClock = (time: number) => new Date(time).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})
