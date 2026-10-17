import {ComfyApi, type ImageInfo} from "@saintno/comfyui-sdk";
import {existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync} from "node:fs";
import {basename, dirname, extname, join} from "node:path";
import {recordTiming, type Timing} from "./timings.ts";
import {accumulatePhases, describeGraph, describeMachine, type Graph, type GraphSetup} from "./graph.ts";
import {formatDuration, log, startSpinner, styles} from "./log.ts";
import {type AudioWorkflow, capResolution, type ImageWorkflow, type Resolution, resolveSeed, type SequenceWorkflow, type VideoWorkflowModule, type WorkflowResult} from "../comfy/helpers.ts";
import {type RenderConfig, workflowDir} from "./config.ts";
import {boundaryFrameAsset, type ClipRequest} from "./compose.ts";
import {secondsAt} from "./frames.ts";
import {extractFrame, probeVideo} from "./assemble.ts";
import {backdropSeconds, hasBackdropRun} from "./leak.ts";
import {freshness, isUserFile} from "./provenance.ts";
import {anchorSpec, clipSpec, pictureSpec, type RenderSpec, sequenceSpec, songSpec, specId} from "./render-spec.ts";
import {archiveFiles, versionStamp} from "./archive.ts";
import {characterSequencePrompt, composeSheet, locationSequencePrompt, selectFrameIndices, SEQUENCE_FRAMES, sheetLayout} from "./sequenceSheet.ts";
import {type ComfyServer, probeComfy} from "./settings.ts";
import {runProcess} from "./process.ts";

// the workflow default max_duration (seconds) when songDuration is -1 in config.json
const DEFAULT_SONG_DURATION = 360

// how long connecting to a server may take, and how long a server that was reachable may stay silent while a job is
// waited for (a restart takes a while) before the run stops - the queued job is recorded and picked up by the next run
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

// description: the plain visual description (characterDescriptions/locationDescriptions), not the image prompt -
// used as the subject of the sequence-sheet video prompt (see renderSequenceSheet), which needs to say what the
// subject looks like without the medium/style/pose/background language the image prompt carries.
/** The id of the request a clip is rendered from (lib/render-spec.ts) - what its sidecar records and the final video compares. */
export const clipFingerprint = (clip: ClipRequest, projectDir: string, config: Pick<RenderConfig, 'videoWorkflow' | 'videoResolution'>) =>
    specId(clipSpec(clip, projectDir, config))

export type PictureJob = { kind: 'character' | 'location', id: string, name: string, file: string, prompt: string, description: string, seed?: number, views?: string[] }

type Server = ComfyServer & { api: ComfyApi }

/** What a render is, for the log and the statistics: the kind of result and the workflow (config name) that makes it. */
type RenderWhat = { label: string, spec: RenderSpec, kind: Timing['kind'], workflow: string, resolution?: Timing['resolution'] }

// the nodes ComfyUI reported while a job ran, in order - for the phase times
type Trace = { classType: string, at: number }[]

/**
 * Whether a recorded job is picked up again on the next run. A failed job stays in ComfyUI's history, so resuming it
 * would report the same error again for ever, whatever was changed since (the workflow, the config, a freed GPU) -
 * only a job that is queued, running or finished is worth waiting for.
 */
export function resumesJob(state: 'queued' | 'running' | 'finished' | 'failed' | 'unknown'): boolean {
    return state === 'queued' || state === 'running' || state === 'finished'
}

/**
 * Renders on one or more ComfyUI servers, one job per server at a time: each render takes the first free server,
 * a resumed job waits for the server it was queued on.
 */
export class Renderer implements Disposable {
    /** The frames the video workflow really renders for a clip of `frames` (some models only take certain counts). */
    async plannedFrames(frames: number) {
        const {renderFrames} = await loadWorkflow<VideoWorkflowModule>(this.config.videoWorkflow)
        return renderFrames?.(frames) ?? frames
    }

    private resolutionWarned = false
    /**
     * The size the video workflow gets: videoResolution, brought down to the largest size the workflow's model is made for
     * (its maxResolution export) - said once per run. The fingerprints keep the setting itself: the same setting gives the same size.
     */
    protected async videoResolution(): Promise<Resolution> {
        const {maxResolution} = await loadWorkflow<VideoWorkflowModule>(this.config.videoWorkflow)
        const capped = capResolution(this.config.videoResolution, maxResolution)
        if (capped !== this.config.videoResolution && !this.resolutionWarned) {
            this.resolutionWarned = true
            log.warn(`videoResolution ${JSON.stringify(this.config.videoResolution)} is more than ${this.config.videoWorkflow} is made for - the clips are rendered at ${capped}`)
        }
        return capped
    }

    // everything of a project goes into its own subfolder of ComfyUI's input/output
    readonly remoteDir: string
    private ready?: Promise<Server[]>
    private connected: Server[] = []
    private machines = new Map<string, ReturnType<typeof describeMachine>>()   // server name -> GPU and versions
    private lastModels = new Map<string, string>()   // server name -> the models its last job used (another set means a cold start)
    private renderMs = new Map<string, number>()   // target -> time spent on its ComfyUI job(s)
    private busy = new Set<string>()        // server names
    private waiting: { pin?: string, resolve: (server: Server) => void }[] = []
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

    // the first free server - with a pin only that one
    private acquire(pin?: string) {
        return new Promise<Server>(resolve => {
            this.waiting.push({pin, resolve})
            this.dispatch()
        })
    }

    private release(server: Server) {
        this.busy.delete(server.name)
        this.dispatch()
    }

    private dispatch() {
        for (const waiter of [...this.waiting]) {
            const free = this.connected.find(s => !this.busy.has(s.name) && (!waiter.pin || s.name === waiter.pin))
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

        const dir = `assets/sequence/${picture.kind}s/${picture.id}`
        const anchorFile = join(dir, 'anchor.png')
        const anchorTarget = join(this.projectDir, anchorFile)
        const videoFile = join(dir, 'sequence.mp4')
        const videoTarget = join(this.projectDir, videoFile)
        const {prompt: sequencePrompt, beatTimes} = picture.kind === 'character'
            ? characterSequencePrompt(picture.description)
            : locationSequencePrompt(picture.description, SEQUENCE_FRAMES, picture.views)
        // the sheet is made from the anchor - the user's own picture (tools/replace-character) as it is, else from the prompt it is rendered from
        const anchorIsUsers = isUserFile(anchorTarget)
        const anchor = anchorSpec(picture, this.config, anchorIsUsers ? anchorTarget : undefined)
        const anchorFingerprint = specId(anchor)
        const sequence = sequenceSpec('sequence', picture.id, anchor, sequencePrompt, this.config.sequenceWorkflow)
        const sheetFingerprint = specId(sequenceSpec('sheet', picture.id, anchor, sequencePrompt, this.config.sequenceWorkflow))
        if (existsSync(target)) {
            const frameFiles = existsSync(join(this.projectDir, dir, 'frames')) ? readdirSync(join(this.projectDir, dir, 'frames')).map(f => join(dir, 'frames', f)) : []
            const away = [picture.file, `${picture.file}.json`, videoFile, `${videoFile}.json`, ...frameFiles, ...(anchorIsUsers ? [] : [anchorFile, `${anchorFile}.json`])]
            if (!this.staleFile('pictures', picture.file, sheetFingerprint, away)) return log.step('Exists', styles.muted(picture.file))
        }
        mkdirSync(join(this.projectDir, dir), {recursive: true})

        if (!existsSync(anchorTarget)) {
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
                    startFrame: `${this.remoteDir}/${anchorFile}`,
                    frames: SEQUENCE_FRAMES,
                    orientation: picture.kind === 'character' ? 'portrait' : 'landscape',
                    resolution: -1,
                    seed,
                    filenamePrefix: `${this.remoteDir}/${dir}/sequence`,
                })
                return {result, uploads: [{from: anchorTarget, to: `${this.remoteDir}/${anchorFile}`}], meta: {seed}}
            })
            await Bun.write(`${videoTarget}.json`, JSON.stringify({workflow: this.config.sequenceWorkflow, seed, frames: SEQUENCE_FRAMES, beatTimes, prompt: sequencePrompt}, null, 2))
        }

        const framesDir = join(this.projectDir, dir, 'frames')
        mkdirSync(framesDir, {recursive: true})
        // the workflow may render another length than asked for (the video model only takes certain frame counts) -
        // the frames are picked from the video as it really is, not from the length that was requested
        const rendered = await probeVideo(videoTarget)
        if (rendered.frames !== SEQUENCE_FRAMES) log.warn(`${videoFile} has ${rendered.frames} frames, ${SEQUENCE_FRAMES} were requested - the sheet frames are picked from the ${rendered.frames} it has`)
        const frameIndices = selectFrameIndices(beatTimes, rendered.frames)
        const framePaths = await Promise.all(frameIndices.map(async (frameIndex, i) => {
            const framePath = join(framesDir, `frame_${String(i).padStart(2, '0')}.png`)
            if (!existsSync(framePath)) await extractFrame(videoTarget, frameIndex, framePath)
            return framePath
        }))

        const {columns, panel} = sheetLayout(picture.kind)
        await composeSheet(framePaths, target, panel, columns)
        await Bun.write(`${target}.json`, JSON.stringify({
            workflow: this.config.sequenceWorkflow, frames: SEQUENCE_FRAMES, beatTimes, prompt: sequencePrompt, fingerprint: sheetFingerprint,
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
    async renderClip(clip: ClipRequest, stemFiles: Record<string, string>) {
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
            // song can be a hand-supplied song.mp3 as well as the usual wav - keep its real extension on upload,
            // LoadAudio needs it to demux correctly
            const songRemote = `${this.remoteDir}/stems/song${extname(stemFiles.song!)}`
            const uploads = [
                ...pictureUploads,
                ...clip.assets.audio.map(a => ({from: stemFiles[a.stem!]!, to: `${this.remoteDir}/stems/${a.stem}.wav`})),
                {from: stemFiles.song!, to: songRemote},
            ]
            const seed = resolveSeed(this.config.seed)
            const {default: videoWorkflow, renderFrames} = await loadWorkflow<VideoWorkflowModule>(this.config.videoWorkflow)

            // Render at least the clip's frames, in a length the model accepts. The audio starts exactly on
            // the clip's first frame and covers the whole render, so the extra frames at the end follow the
            // real song too - they are cut off again when the final video is assembled.
            const frames = renderFrames?.(clip.frames) ?? clip.frames
            if (frames < clip.frames) throw new Error(`${this.config.videoWorkflow}: renderFrames(${clip.frames}) returned only ${frames} frames`)
            const result = videoWorkflow({
                prompt: clip.prompt,
                // a pinned first frame (config.pinStartFrame) goes in as the guide only - as a reference picture too it is blended in twice
                pictures: clip.assets.pictures.filter(p => !(this.config.pinStartFrame && p.kind === 'frame')).map(p => `${this.remoteDir}/${p.file}`),
                audios: clip.assets.audio.map(a => `${this.remoteDir}/stems/${a.stem}.wav`),
                ...(withVocals ? {vocals: `${this.remoteDir}/stems/vocals.wav`} : {}),
                // the full mix, locked into the AV latent via MiniMaxH3AddGuide - see comfy/workflows/h3-ref2video.ts
                song: songRemote,
                ...(this.config.pinStartFrame && clip.startsFrom ? {startFrame: `${this.remoteDir}/${boundaryFrameAsset(clip.startsFrom, 'lf')}`} : {}),
                songStart: secondsAt(clip.frameStart),
                frames,
                duration: secondsAt(frames),
                seed,
                resolution: await this.videoResolution(),
                filenamePrefix: `${this.remoteDir}/videos/${clip.id}`,
            })
            return {result, uploads, meta: {seed}}
        }
        let {seed} = await this.render({label: `clip ${clip.id}`, spec, kind: 'clip', workflow: this.config.videoWorkflow, resolution: this.config.videoResolution}, target, '.mp4', prepare)

        // a clip that came out as the reference pictures lined up on their grey backdrop depends on the seed: the one
        // that did is put away (old/leaks/) and the clip rendered again, up to config.leakRetries times
        for (let tries = 0; this.config.leakRetries > 0; tries++) {
            const leaked = await backdropSeconds(target)
            if (!hasBackdropRun(leaked)) break
            const where = `${leaked.length} sample(s) between ${leaked[0]!.toFixed(1)} and ${leaked.at(-1)!.toFixed(1)} s`
            if (this.config.seed !== -1) {
                log.warn(`${file} has a grey studio backdrop (${where}) - the seed is fixed in config.json, so rendering it again gives the same clip. Use "seed": -1, or --again with another seed`)
                break
            }
            const put = join(this.projectDir, 'old', 'leaks', `${clip.id}-seed-${seed}.mp4`)
            if (tries >= this.config.leakRetries) {
                log.warn(`${file} still has a grey studio backdrop (${where}) after ${tries} more render(s) - kept as it is, bun run leak-scan ${this.projectId} lists it again`)
                break
            }
            mkdirSync(dirname(put), {recursive: true})
            renameSync(target, put)
            recordTiming({kind: 'clip', name: this.config.videoWorkflow, seconds: 0, outcome: 'retry', reason: 'leak'})
            log.warn(`${file} has a grey studio backdrop (${where}) - rendered again with another seed (${tries + 1} of ${this.config.leakRetries}); the first one is in ${styles.muted(`old/leaks/${basename(put)}`)}`)
            seed = (await this.render({label: `clip ${clip.id}`, spec, kind: 'clip', workflow: this.config.videoWorkflow, resolution: this.config.videoResolution}, target, '.mp4', prepare)).seed
        }

        const rendered = await probeVideo(target)
        if (rendered.frames < clip.frames) log.warn(`${file} has ${rendered.frames} frames, the clip needs ${clip.frames} - delete it and render again`)
        await Bun.write(`${target}.json`, JSON.stringify({
            workflow: this.config.videoWorkflow,
            seed,
            resolution: this.config.videoResolution,
            ...(clip.startsFrom ? {startsFrom: clip.startsFrom} : {}),
            frameStart: clip.frameStart,
            frames: clip.frames,            // used in the final video
            fingerprint: request,           // what it was made from (lib/provenance.ts) - another one now makes it stale
            renderedFrames: rendered.frames,
            size: `${rendered.width}x${rendered.height}`,
            request: `output/clips/${clip.id}.json`,
        }, null, 2))
        log.step('Saved', `${file} ${styles.muted(`${rendered.frames} frames, ${clip.frames} used · ${this.took(target)}`)}`)
        await this.saveBoundaryFrames(clip, target, rendered.frames)
    }

    /**
     * Saves the first and the last frame the clip contributes to the final video: frame 0 and frame `clip.frames - 1` -
     * not the file's last frame, the frames after it are only padding for the model's lengths (see assembleFinal).
     */
    // renderedFrames: set for a clip just rendered - its frames are always rewritten; without, only missing ones are made
    private async saveBoundaryFrames(clip: ClipRequest, video: string, renderedFrames?: number) {
        const first = boundaryFrameAsset(clip.id, 'ff')
        const last = boundaryFrameAsset(clip.id, 'lf')
        if (renderedFrames === undefined && existsSync(join(this.projectDir, first)) && existsSync(join(this.projectDir, last))) return
        mkdirSync(join(this.projectDir, dirname(first)), {recursive: true})
        // a clip rendered too short (warned about above) ends on its own last frame
        const frames = Math.min(clip.frames, renderedFrames ?? (await probeVideo(video)).frames)
        await extractFrame(video, 0, join(this.projectDir, first))
        await extractFrame(video, frames - 1, join(this.projectDir, last))
        log.step('Saved', `${first}, ${last} ${styles.muted(`frames 0 and ${frames - 1}`)}`)
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
        const home = initial ? this.homeOf(label, initial, servers) : undefined

        const server = await this.acquire(home?.name)
        const started = Date.now()
        const trace: Trace = []
        let pending: PendingJob<M> | undefined
        let failure: Error | undefined
        try {
            pending = await this.resumeOrQueue(label, server, pendingFile, home ? initial : undefined, prepare, request)
            await this.downloadResult(label, target, extension, server, pending, trace)
            return pending.meta
        } catch (e) {
            failure = e instanceof Error ? e : new Error(String(e))
            throw e
        } finally {
            this.release(server)
            this.renderMs.set(target, (this.renderMs.get(target) ?? 0) + Date.now() - started)
            await this.keepRender(what, server, pending, trace, started, failure)
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
        for (const upload of uploads) {
            // into ComfyUI's input folder, under the same name the workflow loads
            const uploaded = await api.uploadImage(Bun.file(upload.from), basename(upload.to), {subfolder: dirname(upload.to), override: true})
            if (!uploaded) throw new Error(`${label}: upload of ${upload.from} to ${server.name} failed`)
        }
        const prompt = workflow.build({outputs: {result: output}}).workflow
        const queued = await api.queuePrompt(null, prompt).catch(async (error: unknown) => {
            // ComfyUI answers an invalid graph with 400 and the node errors
            const details = error instanceof Response ? await error.text() : String(error)
            throw new Error(`${label}: ComfyUI ${server.name} rejected the workflow - ${details}`)
        })
        const nodes = Object.fromEntries(Object.entries(prompt).map(([id, node]) => [id, node.class_type]))
        const {variant, setup} = describeGraph(prompt as unknown as Graph)
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
                    status = `queued, ${ahead} job(s) ahead`
                }
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
