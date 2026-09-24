import {ComfyApi, type ImageInfo} from "@saintno/comfyui-sdk";
import {existsSync, mkdirSync, renameSync, rmSync} from "node:fs";
import {basename, dirname, extname, join} from "node:path";
import {log, startSpinner, styles} from "./log.ts";
import {type AudioWorkflow, type ImageWorkflow, resolveSeed, type VideoWorkflowModule, type WorkflowResult} from "../comfy/helpers.ts";
import {type RenderConfig, workflowDir} from "./config.ts";
import {boundaryFrameAsset, type ClipRequest} from "./compose.ts";
import {secondsAt} from "./frames.ts";
import {extractFrame, probeVideo} from "./assemble.ts";
import {type ComfyServer, probeComfy} from "./settings.ts";
import {runProcess} from "./process.ts";

// the workflow default max_duration (seconds) when songDuration is -1 in config.json
const DEFAULT_SONG_DURATION = 360

async function loadWorkflow<T extends { default: unknown }>(name: string): Promise<T> {
    const module = await import(join(workflowDir, `${name}.ts`))
    if (typeof module.default !== 'function') throw new Error(`comfy/workflows/${name}.ts has no default export function`)
    return module
}

export type PictureJob = { kind: 'character' | 'location', id: string, name: string, file: string, prompt: string }

type Server = ComfyServer & { api: ComfyApi }

/**
 * Renders on one or more ComfyUI servers, one job per server at a time: each render takes the first free server,
 * a resumed job waits for the server it was queued on.
 */
export class Renderer implements Disposable {
    // everything of a project goes into its own subfolder of ComfyUI's input/output
    readonly remoteDir: string
    private ready?: Promise<Server[]>
    private connected: Server[] = []
    private busy = new Set<string>()        // server names
    private waiting: { pin?: string, resolve: (server: Server) => void }[] = []
    private stopQueueNote?: () => void

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
            const problems = await Promise.all(this.servers.map(server => probeComfy(server).then(() => undefined, (e: Error) => e.message)))
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
            // waitForReady() never returns when the connection fails
            const off = api.on('connection_error', () => {
                off()
                api.destroy()
                reject(new Error(`ComfyUI ${server.name} (${server.url}): connection failed`))
            })
            api.init(5, 2000).waitForReady().then(() => {
                off()
                resolve({...server, api})
            })
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

    // Characters are portrait, locations landscape - saved to the placeholder paths the clips reference
    async renderPicture(picture: PictureJob) {
        const target = join(this.projectDir, picture.file)
        if (existsSync(target)) return log.step('Exists', styles.muted(picture.file))

        const {seed} = await this.render(`${picture.kind} ${picture.id}`, target, '.png', async () => {
            const seed = resolveSeed(this.config.seed)
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
        await Bun.write(`${target}.json`, JSON.stringify({workflow: this.config.imageWorkflow, seed, resolution: this.config.imageResolution, prompt: picture.prompt}, null, 2))
        log.step('Saved', picture.file)
    }

    // Generates input/song.wav with the configured songWorkflow (YuE2 by default). The workflow only saves mp3/flac
    // (no wav), so the download is converted with ffmpeg - the rest of the pipeline only ever sees a wav file,
    // exactly as with a song the user supplied themselves.
    async renderSong(brief: { style: string, lyrics: string }, songFile: string) {
        if (existsSync(songFile)) return log.step('Exists', styles.muted('input/song.wav'))
        const mp3File = songFile.replace(/\.wav$/, '.mp3')

        const {seed, duration} = await this.render('song', mp3File, '.mp3', async () => {
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

        await runProcess(['ffmpeg', '-y', '-v', 'error', '-i', mp3File, '-c:a', 'pcm_s16le', songFile], {
            errorMessage: err => `ffmpeg failed to convert the generated song to wav:\n${err}`,
        })
        rmSync(mp3File)
        await Bun.write(`${songFile}.json`, JSON.stringify({workflow: this.config.songWorkflow, seed, duration, style: brief.style, lyrics: brief.lyrics}, null, 2))
        log.step('Saved', 'input/song.wav')
    }

    // stemFiles: the isolated stems of the whole song (stems/vocals.wav, stems/drums.wav, ...) plus a "song"
    // entry for the whole, unseparated song - vocals is needed by clips with a singer, others by whichever
    // tracks this clip's prompt references ("song" when stems weren't separated at all, see lib/compose.ts).
    async renderClip(clip: ClipRequest, stemFiles: Record<string, string>) {
        const file = `videos/${clip.id}.mp4`
        const target = join(this.projectDir, file)
        if (existsSync(target)) {
            log.step('Exists', styles.muted(file))
            // clips rendered before the boundary frames existed get them now
            return this.saveBoundaryFrames(clip, target)
        }

        const missing = clip.assets.pictures.filter(p => !existsSync(join(this.projectDir, p.file)))
        if (missing.length) return log.warn(`${clip.id} skipped - missing pictures: ${missing.map(p => p.file).join(', ')}`)
        const withVocals = clip.assets.audio.some(a => a.stem === 'vocals')
        const missingStems = clip.assets.audio.filter(a => !(a.stem && stemFiles[a.stem] && existsSync(stemFiles[a.stem]!)))
        if (missingStems.length) return log.warn(`${clip.id} skipped - missing stem file(s) for: ${missingStems.map(a => a.stem).join(', ')}`)
        if (!(stemFiles.song && existsSync(stemFiles.song))) return log.warn(`${clip.id} skipped - missing the full song (needed for MiniMaxH3AddGuide)`)

        const {seed} = await this.render(`clip ${clip.id}`, target, '.mp4', async () => {
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
                pictures: clip.assets.pictures.map(p => `${this.remoteDir}/${p.file}`),
                audios: clip.assets.audio.map(a => `${this.remoteDir}/stems/${a.stem}.wav`),
                ...(withVocals ? {vocals: `${this.remoteDir}/stems/vocals.wav`} : {}),
                // the full mix, locked into the AV latent via MiniMaxH3AddGuide - see comfy/workflows/h3-ref2video.ts
                song: songRemote,
                songStart: secondsAt(clip.frameStart),
                frames,
                duration: secondsAt(frames),
                seed,
                resolution: this.config.videoResolution,
                filenamePrefix: `${this.remoteDir}/videos/${clip.id}`,
            })
            return {result, uploads, meta: {seed}}
        })

        const rendered = await probeVideo(target)
        if (rendered.frames < clip.frames) log.warn(`${file} has ${rendered.frames} frames, the clip needs ${clip.frames} - delete it and render again`)
        await Bun.write(`${target}.json`, JSON.stringify({
            workflow: this.config.videoWorkflow,
            seed,
            resolution: this.config.videoResolution,
            frameStart: clip.frameStart,
            frames: clip.frames,            // used in the final video
            renderedFrames: rendered.frames,
            size: `${rendered.width}x${rendered.height}`,
            request: `output/clips/${clip.id}.json`,
        }, null, 2))
        log.step('Saved', `${file} ${styles.muted(`${rendered.frames} frames, ${clip.frames} used`)}`)
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
    private async render<M>(label: string, target: string, extension: string, prepare: () => Promise<{ result: WorkflowResult, uploads: { from: string, to: string }[], meta: M }>): Promise<M> {
        const servers = await this.connect()
        const pendingFile = `${target}.pending.json`
        const initial: PendingJob<M> | undefined = existsSync(pendingFile) ? await Bun.file(pendingFile).json() : undefined
        const home = initial ? this.homeOf(label, initial, servers) : undefined

        const server = await this.acquire(home?.name)
        try {
            const pending = await this.resumeOrQueue(label, server, pendingFile, home ? initial : undefined, prepare)
            await this.downloadResult(label, target, extension, server, pending)
            return pending.meta
        } finally {
            this.release(server)
        }
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
    private async resumeOrQueue<M>(label: string, server: Server, pendingFile: string, pending: PendingJob<M> | undefined, prepare: () => Promise<{ result: WorkflowResult, uploads: { from: string, to: string }[], meta: M }>): Promise<PendingJob<M>> {
        const {api} = server
        if (pending) {
            const state = await this.jobState(server, pending.promptId)
            if (state !== 'unknown') {
                log.step('Resuming', `${styles.name(label)} ${styles.muted(`@${server.name}, job ${pending.promptId}, queued at ${formatClock(pending.queuedAt)}, ${state}`)}`)
                return pending
            }
            log.warn(`${label}: the job queued at ${formatClock(pending.queuedAt)} is no longer on ${server.name} - rendering again`)
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
        const queuedJob: PendingJob<M> = {promptId: queued.prompt_id, server: {name: server.name, url: server.url}, output, nodes, meta, queuedAt: Date.now()}
        await Bun.write(pendingFile, JSON.stringify(queuedJob, null, 2))
        return queuedJob
    }

    /** Waits for `pending`'s job to finish, then downloads its result to `target` and clears the pending file. */
    private async downloadResult<M>(label: string, target: string, extension: string, server: Server, pending: PendingJob<M>) {
        const outputs = await this.waitForJob(label, server, pending)

        // the output node's files, e.g. {images: [...]} for SaveImage, {gifs: [...]} for VHS_VideoCombine
        const files = Object.values(outputs ?? {}).flat().filter((f): f is ImageInfo => typeof (f as ImageInfo)?.filename === 'string')
        const file = files.findLast(f => f.filename.endsWith(extension))
        if (!file) throw new Error(`${label}: the output node saved no ${extension} file (got ${files.map(f => f.filename).join(', ') || 'nothing'})`)
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
    private async waitForJob(label: string, server: Server, job: PendingJob<unknown>) {
        const {api} = server
        let status = 'queued'
        const node = (id: string) => `${job.nodes[id] ?? 'node'} #${id}`
        const off = [
            api.on('executing', event => {
                if (event.detail.prompt_id === job.promptId && event.detail.node) status = `running ${node(String(event.detail.node))}`
            }),
            api.on('progress', event => {
                if (event.detail.prompt_id === job.promptId) status = `running ${node(String(event.detail.node))}, step ${event.detail.value}/${event.detail.max}`
            }),
            api.on('disconnected', () => void (status = 'connection lost - the job keeps running on the server')),
        ]
        const stopSpinner = startSpinner(() => `${styles.name(label)} ${styles.muted(`@${server.name} ${status}`)}`)
        let missing = 0
        try {
            while (true) {
                const entry = await api.getHistory(job.promptId).catch(() => undefined)
                if (entry?.status?.completed) return entry.outputs[job.output]
                if (entry?.status?.status_str === 'error') {
                    const error = entry.status.messages.find(([type]) => type === 'execution_error')?.[1]
                    throw new Error(`${label}: ComfyUI job failed${error ? ` in ${error.node_type ?? 'a node'} - ${error.exception_message ?? ''}` : ''}`)
                }
                // not finished - is it still waiting or running? A few misses in a row mean it's gone (server restart)
                const state = entry ? 'running' : await this.jobState(server, job.promptId).catch(() => 'running' as const)
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

type PendingJob<M> = {
    promptId: string,
    server?: { name: string, url: string },   // missing in files from before several servers
    output: string,                           // output node id
    nodes: Record<string, string>,            // node id -> class_type, for the progress display
    meta: M,
    queuedAt: number,
}

const formatClock = (time: number) => new Date(time).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})
