import {nameService} from '../service-error.ts'
import {ComfyApi, type ImageInfo} from '@saintno/comfyui-sdk'
import {renameSync, rmSync} from 'node:fs'
import {basename, posix} from 'node:path'
import {recordTiming} from '../timings.ts'
import {accumulatePhases, describeGraph, describeMachine, type Graph} from '../graph.ts'
import {formatDuration, log, startSpinner, styles} from '../log.ts'
import {type WorkflowResult} from '../../comfy/helpers.ts'
import {specId} from '../render-spec.ts'
import {type ComfyServer, probeComfy} from '../settings.ts'
import {runEvent} from '../run-events.ts'
import {trackJob, untrackJob} from '../comfy-cancel.ts'
import {describeRejection} from '../comfy-rejection.ts'
import {
    type Renderer,
    CONNECT_TIMEOUT_MS,
    SERVER_SILENT_MS,
    workflowHash,
    type Server,
    type RenderWhat,
    type Trace,
    dispatchOrder,
    pickServer,
    PROBE_TIMEOUT_MS,
    boardStatus,
    resumesJob,
    backslashedRemotePath,
    readPending,
    type PendingJob,
    formatClock,
} from '../render.ts'

// The work of a Renderer (lib/render.ts, #841): the ComfyUI servers of a run: connecting, holding one for a job, dispatching the waiting - and a job sent, resumed, waited for and downloaded. The renderer keeps the state; these take it as `r`.

export function connect(r: Renderer) {
    r.ready ??= (async () => {
        // the SDK would wait forever for a server that isn't there - so every server is asked first
        const problems = await Promise.all(
            r.servers.map(server =>
                probeComfy(server).then(
                    stats => void r.machines.set(server.name, describeMachine(stats)),
                    (e: Error) => e.message,
                ),
            ),
        )
        const reachable = r.servers.filter((server, i) => {
            if (problems[i]) log.warn(`ComfyUI ${server.name} (${server.url}) is unreachable - ${problems[i]}`)
            return !problems[i]
        })
        const connections = await Promise.allSettled(reachable.map(server => r.connectServer(server)))
        for (const c of connections) {
            if (c.status === 'fulfilled') r.connected.push(c.value)
            else log.warn((c.reason as Error).message)
        }
        if (!r.connected.length) {
            throw new Error(
                `No ComfyUI server reachable (${r.servers.map(s => s.url).join(', ')}) - start ComfyUI, or check the servers with: bun run setup comfy`,
            )
        }
        r.stopQueueNote = startSpinner(() => (r.waiting.length ? `${r.waiting.length} queued` : ''), {note: true})
        return r.connected
    })()
    return r.ready
}

export function connectServer(r: Renderer, server: ComfyServer): Promise<Server> {
    // A fixed client id per project and server: ComfyUI sends a job's progress to the client that queued it,
    // so after a restart the progress of a resumed job still arrives.
    // ComfyUI sends nothing while it loads a large model - with the default 10 s timeout the SDK
    // would call the connection dead. Completion doesn't depend on the connection anyway (see waitForJob).
    const api = new ComfyApi(server.url, `feverslop-ts-${r.projectId}-${server.name}`, {
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
        const timer = setTimeout(
            () => fail(`no connection within ${CONNECT_TIMEOUT_MS / 1000} s - the server answers, but not completely (restarting? stuck custom node?)`),
            CONNECT_TIMEOUT_MS,
        )
        const off = api.on('connection_error', () => fail('connection failed'))
        api.init(5, 2000)
            .waitForReady()
            .then(
                () => {
                    clearTimeout(timer)
                    off()
                    resolve({...server, api})
                },
                (e: unknown) => fail(e instanceof Error ? e.message : String(e)),
            )
    })
}

/**
 * Before the renders start: every target with a job of an earlier run recorded in its pending file holds that server for
 * it - see `held`. Only for renders that will ask for a server; the hold goes with settle().
 */
export async function announceResumes(r: Renderer, targets: string[]) {
    const servers = await r.connect()
    for (const target of targets) {
        const pending = await readPending<unknown>(`${target}.pending.json`)
        const name = pending?.server?.name ?? (pending ? r.servers[0]?.name : undefined)
        if (!name || !servers.some(s => s.name === name) || r.announced.has(target)) continue
        r.announced.set(target, name)
        r.held.set(name, (r.held.get(name) ?? 0) + 1)
    }
}

/** The job of `target` has its server, or will not resume: the hold of announceResumes goes. */
export function settle(r: Renderer, target: string) {
    const name = r.announced.get(target)
    if (!name) return
    r.announced.delete(target)
    const left = (r.held.get(name) ?? 1) - 1
    if (left > 0) r.held.set(name, left)
    else r.held.delete(name)
    r.dispatch()
}

export function acquire(r: Renderer, pin?: string) {
    return new Promise<Server>((resolve, reject) => {
        if (r.connected.length && r.connected.every(s => r.down.has(s.name))) return reject(r.allDown())
        r.waiting.push({pin, resolve, reject})
        r.dispatch()
    })
}

export function allDown(r: Renderer) {
    return new Error(
        `no ComfyUI server answers any more (${[...r.down].join(', ')}) - start them again and run again; finished files are kept, the rest goes on from there`,
    )
}

/** Whether a server still answers at all - asked after a job on it failed. */
export async function answers(r: Renderer, server: Server): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<false>(resolve => {
        timer = setTimeout(() => resolve(false), PROBE_TIMEOUT_MS)
    })
    try {
        return await Promise.race([
            server.api.getSystemStats().then(
                () => true,
                () => false,
            ),
            timeout,
        ])
    } finally {
        clearTimeout(timer)
    }
}

/** No job goes to `server` any more in this run; with no server left, everybody still waiting is told so. */
export function markDown(r: Renderer, server: Server) {
    if (r.down.has(server.name)) return
    r.down.add(server.name)
    const left = r.connected.filter(s => !r.down.has(s.name)).map(s => s.name)
    log.warn(
        `ComfyUI ${server.name} (${server.url}) does not answer - no more jobs go to it in this run${left.length ? `, they go to ${left.join(', ')}` : ''}. Start it again and run again to use it`,
    )
    if (!left.length) {
        for (const waiter of r.waiting.splice(0)) waiter.reject(r.allDown())
        return
    }
    r.dispatch()
}

export function release(r: Renderer, server: Server) {
    r.busy.delete(server.name)
    r.dispatch()
}

export function dispatch(r: Renderer) {
    for (const waiter of dispatchOrder(r.waiting)) {
        const free = pickServer(r.connected, r.busy, r.down, waiter.pin, r.held)
        if (!free) continue
        r.busy.add(free.name)
        r.waiting.splice(r.waiting.indexOf(waiter), 1)
        waiter.resolve(free)
    }
}

export async function freeMemory(r: Renderer) {
    if (!r.connected.length) return
    log.step('✨ Freeing VRAM', styles.muted(r.connected.map(s => s.name).join(', ')))
    await Promise.all(
        r.connected.map(async server => {
            try {
                const freed = await server.api.freeMemory(true, true)
                log.step(freed ? '✨ Freed' : '✗ Free failed', styles.muted(`VRAM on ${server.name}`))
            } catch (e) {
                log.warn(`${server.name}: failed to free VRAM - ${(e as Error).message}`)
            }
        }),
    )
}

/**
 * Renders one file, resumable: a queued job is recorded in `<target>.pending.json`. If feverslop-ts ends while
 * ComfyUI is still rendering (crash, sleep), the next run attaches to that job - or downloads its result if it
 * finished in the meantime - instead of rendering again. A deliberate stop (Ctrl+C, the workspace's Stop) cancels it
 * instead (lib/comfy-cancel.ts). Returns the meta of the job that made the file.
 */
export async function render<M>(
    r: Renderer,
    what: RenderWhat,
    target: string,
    extension: string | string[],
    prepare: () => Promise<{result: WorkflowResult; uploads: {from: string; to: string}[]; meta: M}>,
): Promise<M> {
    const label = what.label
    // a fingerprint of what the job is made from: a job queued for another request is not the one to take the result of
    const request = specId(what.spec)
    const servers = await r.connect()
    const pendingFile = `${target}.pending.json`
    let initial = await readPending<M>(pendingFile)
    if (initial && initial.request !== undefined && initial.request !== request) {
        const kept = `${target}.pending-${initial.promptId}.json`
        renameSync(pendingFile, kept)
        log.warn(
            `${label}: the job queued at ${formatClock(initial.queuedAt)} was made from another request than the plan has now - not used (${basename(kept)} keeps it), rendering again`,
        )
        initial = undefined
    }
    // a server that went down in this run is not a home any more: the job is rendered again elsewhere
    let home = initial
        ? r.homeOf(
              label,
              initial,
              servers.filter(s => !r.down.has(s.name)),
          )
        : undefined
    if (!home) r.settle(target)

    // a job already finished on its server needs no free one: only its result is fetched
    // This is only an optimization. A failed probe must enter the protected resume loop, not abort the render.
    const finished = home && initial && (await r.jobState(home, initial.promptId).catch(() => undefined)) === 'finished'
    if (home && initial && finished) {
        r.settle(target)
        const started = Date.now()
        const trace: Trace = []
        log.step(
            'Resuming',
            `${styles.name(label)} ${styles.muted(`@${home.name}, job ${initial.promptId}, queued at ${formatClock(initial.queuedAt)}, finished`)}`,
        )
        let failure: Error | undefined
        try {
            runEvent({type: 'job', state: 'running', kind: what.kind, id: what.spec.id, server: home.name})
            await r.downloadResult(label, target, extension, home, initial, trace)
            runEvent({type: 'job', state: 'done', kind: what.kind, id: what.spec.id, server: home.name})
            return initial.meta
        } catch (e) {
            failure = e instanceof Error ? e : new Error(String(e))
            runEvent({type: 'job', state: 'failed', kind: what.kind, id: what.spec.id, server: home.name})
            throw e
        } finally {
            r.renderMs.set(target, (r.renderMs.get(target) ?? 0) + Date.now() - started)
            await r.keepRender(what, home, initial, trace, started, failure)
        }
    }

    let timeouts = 0
    for (;;) {
        const server = await r.acquire(home?.name)
        r.settle(target)
        const started = Date.now()
        const trace: Trace = []
        let pending: PendingJob<M> | undefined
        let failure: Error | undefined
        let again = false
        let resume = false
        try {
            pending = await r.resumeOrQueue(label, server, pendingFile, home ? initial : undefined, prepare, request)
            // a deliberate stop (Ctrl+C, the workspace's stop button) cancels it on its server - lib/comfy-cancel.ts
            trackJob({label, server, promptId: pending.promptId, pendingFile})
            runEvent({type: 'job', state: 'running', kind: what.kind, id: what.spec.id, server: server.name})
            await r.downloadResult(label, target, extension, server, pending, trace)
            runEvent({type: 'job', state: 'done', kind: what.kind, id: what.spec.id, server: server.name})
            return pending.meta
        } catch (e) {
            failure = e instanceof Error ? e : new Error(String(e))
            // a failure on a server that does not answer any more is the server's, not the job's: it is taken out of
            // the run and the job goes to another one - unless there is none left
            if (!(await r.answers(server))) {
                r.markDown(server)
                again = r.connected.some(s => !r.down.has(s.name))
                if (again) log.warn(`${label}: rendered again on another server (${failure.message.slice(0, 160)})`)
            }
            // A request that hung and timed out on a server that answers again (a network blip, a job that finished
            // meanwhile): the job is on the server - ask for it again instead of ending the whole run
            if (!again && timeouts < 2 && /timed out|timeout/i.test(`${failure.name} ${failure.message}`)) {
                timeouts++
                again = resume = true
                log.warn(`${label}: ${failure.message.slice(0, 160)} - asking ${server.name} again (${timeouts}/2)`)
            }
            if (!again) {
                runEvent({type: 'job', state: 'failed', kind: what.kind, id: what.spec.id, server: server.name})
                throw nameService(failure, `${label} on ${server.name} (${server.url})`, label)
            }
        } finally {
            untrackJob(pendingFile)
            r.release(server)
            r.renderMs.set(target, (r.renderMs.get(target) ?? 0) + Date.now() - started)
            await r.keepRender(what, server, pending, trace, started, failure)
        }
        // the job queued just now is in the pending file - taken up again (on its server) or, if gone, rendered anew
        initial = resume ? await readPending<M>(pendingFile) : initial
        home =
            resume && initial
                ? r.homeOf(
                      label,
                      initial,
                      r.connected.filter(s => !r.down.has(s.name)),
                  )
                : undefined
    }
}

/** Keeps the measurement of one job: the setup the graph says, where it ran, queue vs. compute, the phases. Numbers and names only. */
export async function keepRender(
    r: Renderer,
    what: RenderWhat,
    server: Server,
    job: PendingJob<unknown> | undefined,
    trace: Trace,
    started: number,
    failure?: Error,
) {
    // a resumed job was queued before this run: its queue time and phases are not known
    const fresh = !!job && job.queuedAt >= started
    const firstNode = trace[0]?.at
    const queueMs = fresh && firstNode ? Math.max(0, firstNode - job.queuedAt) : undefined
    const seconds = (Date.now() - started - (queueMs ?? 0)) / 1000
    const setup = job?.setup
    recordTiming({
        kind: what.kind,
        name: what.workflow,
        seconds: Math.round(seconds * 10) / 10,
        ...(failure ? {outcome: 'failed' as const, reason: failure.name} : !fresh ? {outcome: 'resumed' as const} : {}),
        ...(job?.variant ? {variant: job.variant, workflowHash: await workflowHash(what.workflow)} : {}),
        ...(setup ? {setup, ...(setup.frames ? {frames: setup.frames} : {}), ...(setup.pixels ? {pixels: setup.pixels} : {})} : {}),
        server: server.name,
        ...r.machines.get(server.name),
        ...(job?.cold !== undefined ? {cold: job.cold} : {}),
        ...(queueMs !== undefined ? {queueSeconds: Math.round(queueMs / 100) / 10} : {}),
        ...(fresh && !failure && trace.length ? {phases: accumulatePhases(trace, Date.now())} : {}),
        ...(what.resolution !== undefined ? {resolution: what.resolution} : {}),
    })
}

/** How long the job(s) for `target` took, queueing for a free server not counted - '' when none ran in this run. */
export function took(r: Renderer, target: string) {
    const ms = r.renderMs.get(target)
    return ms ? formatDuration(ms) : ''
}

export function homeOf<M>(r: Renderer, label: string, pending: PendingJob<M>, servers: Server[]): Server | undefined {
    const recorded = pending.server ?? r.servers[0]!
    const byUrl = servers.find(s => s.url === recorded.url)
    const byName = servers.find(s => s.name === recorded.name)
    const home = byUrl ?? byName
    // the name matches but the URL doesn't - the name was likely reused for a different machine
    if (home && !byUrl)
        log.warn(`${label}: its job was queued on ${recorded.name} (${recorded.url}), which is now configured at ${home.url} - resuming there anyway`)
    if (!home) {
        const why = r.servers.some(s => s.url === recorded.url || s.name === recorded.name) ? 'is unreachable' : 'is no longer configured'
        log.warn(`${label}: its job was queued on ${recorded.name} (${recorded.url}), which ${why} - rendering again`)
    }
    return home
}

/** Resumes `pending` if its job is still on `server`, else queues a freshly prepared workflow. */
export async function resumeOrQueue<M>(
    r: Renderer,
    label: string,
    server: Server,
    pendingFile: string,
    pending: PendingJob<M> | undefined,
    prepare: () => Promise<{result: WorkflowResult; uploads: {from: string; to: string}[]; meta: M}>,
    request?: string,
): Promise<PendingJob<M>> {
    const {api} = server
    if (pending) {
        const state = await r.jobState(server, pending.promptId)
        if (resumesJob(state)) {
            log.step(
                'Resuming',
                `${styles.name(label)} ${styles.muted(`@${server.name}, job ${pending.promptId}, queued at ${formatClock(pending.queuedAt)}, ${state}`)}`,
            )
            // taken up by this run: a stop of this run from outside cancels it too (jobsQueuedSince)
            const attached = {...pending, attachedAt: Date.now()}
            await Bun.write(`${pendingFile}.partial`, JSON.stringify(attached, null, 2))
            renameSync(`${pendingFile}.partial`, pendingFile)
            return attached
        }
        log.warn(
            `${label}: the job queued at ${formatClock(pending.queuedAt)} ${state === 'failed' ? `failed on ${server.name}` : `is no longer on ${server.name}`} - rendering again`,
        )
    }

    log.step('Rendering', `${styles.name(label)} ${styles.muted(`@${server.name}`)}`)
    const {
        result: {workflow, output},
        uploads,
        meta,
    } = await prepare()
    const prompt = workflow.build({outputs: {result: output}}).workflow
    const backslashed = backslashedRemotePath(uploads, prompt)
    if (backslashed)
        throw new Error(`${label}: a path on the server is written with \\ - ${backslashed}. A Linux ComfyUI refuses it; build it with /, not path.join`)
    for (const upload of uploads) {
        // into ComfyUI's input folder, under the same name the workflow loads - split with /, whatever system this runs on
        const uploaded = await api.uploadImage(Bun.file(upload.from), posix.basename(upload.to), {subfolder: posix.dirname(upload.to), override: true})
        if (!uploaded) throw new Error(`${label}: upload of ${upload.from} to ${server.name} failed`)
    }
    const queued = await api.queuePrompt(null, prompt).catch(async (error: unknown) => {
        // ComfyUI answers an invalid graph with 400 and the node errors
        const details = error instanceof Response ? await error.text() : String(error)
        throw new Error(`${label}: ${describeRejection(server.name, details)}`)
    })
    const graph = prompt as unknown as Graph
    const nodes = Object.fromEntries(Object.entries(graph).map(([id, node]) => [id, node.class_type]))
    const {variant, setup} = describeGraph(graph)
    // the first job on a server after another set of models has to load them: it is kept apart in the statistics
    const models = JSON.stringify([setup.models, setup.loras])
    const cold = r.lastModels.get(server.name) !== models
    r.lastModels.set(server.name, models)
    const queuedJob: PendingJob<M> = {
        promptId: queued.prompt_id,
        server: {name: server.name, url: server.url},
        output,
        nodes,
        meta,
        queuedAt: Date.now(),
        variant,
        setup,
        cold,
        ...(request !== undefined ? {request} : {}),
    }
    // written beside and renamed, so a stop in the middle of the write never leaves half a file behind
    await Bun.write(`${pendingFile}.partial`, JSON.stringify(queuedJob, null, 2))
    renameSync(`${pendingFile}.partial`, pendingFile)
    return queuedJob
}

/** Waits for `pending`'s job to finish, then downloads its result to `target` and clears the pending file. */
export async function downloadResult<M>(
    r: Renderer,
    label: string,
    target: string,
    extension: string | string[],
    server: Server,
    pending: PendingJob<M>,
    trace: Trace,
) {
    const outputs = await r.waitForJob(label, server, pending, trace)

    // the output node's files, e.g. {images: [...]} for SaveImage, {gifs: [...]} for VHS_VideoCombine
    const files = Object.values(outputs ?? {})
        .flat()
        .filter((f): f is ImageInfo => typeof (f as ImageInfo)?.filename === 'string')
    const extensions = [extension].flat()
    const file = files.findLast(f => extensions.some(e => f.filename.endsWith(e)))
    if (!file) throw new Error(`${label}: the output node saved no ${extensions.join(' or ')} file (got ${files.map(f => f.filename).join(', ') || 'nothing'})`)
    // written next to the target first, so an interrupted download never looks like a finished file
    const query = new URLSearchParams({filename: file.filename, type: file.type, subfolder: file.subfolder ?? ''})
    const response = await server.api.fetchApi(`/view?${query.toString()}`)
    if (!response.ok) throw new Error(`${label}: output download failed with HTTP ${response.status}`)
    await Bun.write(`${target}.download`, await response.blob())
    renameSync(`${target}.download`, target)
    rmSync(`${target}.pending.json`, {force: true})
}

export async function jobState(r: Renderer, {api}: Server, promptId: string): Promise<'queued' | 'running' | 'finished' | 'failed' | 'unknown'> {
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
export async function waitForJob(r: Renderer, label: string, server: Server, job: PendingJob<unknown>, trace: Trace) {
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
                if (!entry) state = await r.jobState(server, job.promptId)
                if (silentSince !== undefined) status = 'queued'
                silentSince = undefined
            } catch {
                // the server doesn't answer at all - keep waiting for a restart, but not forever
                silentSince ??= Date.now()
                status = `${server.name} is not answering`
                if (Date.now() - silentSince > SERVER_SILENT_MS) {
                    throw new Error(
                        `${label}: ComfyUI ${server.name} (${server.url}) has not answered for ${SERVER_SILENT_MS / 60000} minutes - start it again and run again to pick the job up (it stays queued: ${job.promptId})`,
                    )
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
