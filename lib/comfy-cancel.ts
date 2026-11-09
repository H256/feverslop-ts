import {existsSync, readdirSync, rmSync} from 'node:fs'
import {join} from 'node:path'
import type {ComfyServer} from './settings.ts'

// Cancelling our own ComfyUI jobs when a run is stopped on purpose (#736): the stop button of the workspace and Ctrl+C. A run that
// ends otherwise - a crash, the PC going to sleep, the network gone - leaves its jobs running: the next run attaches to them through
// their <file>.pending.json (lib/render.ts). Only the job with our own prompt id is touched, never somebody else's on the same server.

const ASK_MS = 4000

export const authOf = (server: Pick<ComfyServer, 'credentials'>): Record<string, string> => {
    const credentials = server.credentials as {type?: string; token?: string; username?: string; password?: string} | undefined
    if (credentials?.token) return {Authorization: `Bearer ${credentials.token}`}
    if (credentials?.username) return {Authorization: `Basic ${btoa(`${credentials.username}:${credentials.password ?? ''}`)}`}
    return {}
}

/** What became of a job: stopped while it ran, taken out of the queue, no longer there (done or gone), or the server did not answer. */
export type CancelOutcome = 'interrupted' | 'removed' | 'gone' | 'unreachable'

type QueueItem = [number, string, ...unknown[]]
type Queue = {queue_running?: QueueItem[]; queue_pending?: QueueItem[]}

/**
 * Cancels one job on its server. A job waiting in the queue is deleted from it; the running job is interrupted only when the queue
 * says it is ours - /interrupt alone stops whatever runs, and the prompt id given with it makes a ComfyUI that knows it check as well.
 */
export async function cancelJob(server: Pick<ComfyServer, 'url' | 'credentials'>, promptId: string, fetcher: typeof fetch = fetch): Promise<CancelOutcome> {
    const call = (path: string, body?: unknown) =>
        fetcher(`${server.url}${path}`, {
            method: body === undefined ? 'GET' : 'POST',
            signal: AbortSignal.timeout(ASK_MS),
            headers: {...authOf(server), ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
            ...(body === undefined ? {} : {body: JSON.stringify(body)}),
        })
    try {
        const response = await call('/queue')
        if (!response.ok) return 'unreachable'
        const queue = (await response.json()) as Queue
        if (queue.queue_pending?.some(item => item[1] === promptId)) {
            await call('/queue', {delete: [promptId]})
            return 'removed'
        }
        if (queue.queue_running?.some(item => item[1] === promptId)) {
            await call('/interrupt', {prompt_id: promptId})
            return 'interrupted'
        }
        return 'gone'
    } catch {
        return 'unreachable'
    }
}

/** A job this process queued or attached to and is waiting for. */
export type ActiveJob = {label: string; server: Pick<ComfyServer, 'name' | 'url' | 'credentials'>; promptId: string; pendingFile: string}

const active = new Map<string, ActiveJob>()

/** Keeps a job while it is waited for (lib/render.ts) - Ctrl+C cancels what is kept here. */
export const trackJob = (job: ActiveJob) => {
    active.set(job.pendingFile, job)
}
export const untrackJob = (pendingFile: string) => {
    active.delete(pendingFile)
}
export const activeJobs = () => [...active.values()]

/**
 * Cancels jobs and removes their pending files, so the next run renders them again instead of attaching. A job on a server that
 * does not answer keeps its file: it may still run there, and the next run attaches to it rather than rendering it twice.
 */
export async function cancelJobs(jobs: ActiveJob[], fetcher: typeof fetch = fetch): Promise<{job: ActiveJob; outcome: CancelOutcome}[]> {
    return Promise.all(
        jobs.map(async job => {
            const outcome = await cancelJob(job.server, job.promptId, fetcher)
            if (outcome !== 'unreachable') rmSync(job.pendingFile, {force: true})
            active.delete(job.pendingFile)
            return {job, outcome}
        }),
    )
}

/** The pending files under a project folder, without old/ (put-away takes) and the kept files of jobs for another request. */
function pendingFiles(dir: string): string[] {
    if (!existsSync(dir)) return []
    return readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) return entry.name === 'old' || entry.name === 'node_modules' ? [] : pendingFiles(path)
        return entry.name.endsWith('.pending.json') ? [path] : []
    })
}

/**
 * The jobs a run queued in a project folder since `since` (ms), as their pending files have them, each on its server of the settings
 * (by URL, else by name; else as the file has it). For a run that was ended from outside without a chance to cancel them itself: the workspace's stop on
 * Windows ends the process at once. A job queued before the run and not taken up by it - by a run that crashed, waiting to be
 * attached to - is left alone.
 */
export async function jobsQueuedSince(dir: string, since: number, servers: Pick<ComfyServer, 'name' | 'url' | 'credentials'>[]): Promise<ActiveJob[]> {
    const jobs: ActiveJob[] = []
    for (const pendingFile of pendingFiles(dir)) {
        const job = (await Bun.file(pendingFile)
            .json()
            .catch(() => undefined)) as {promptId?: string; queuedAt?: number; attachedAt?: number; server?: {name: string; url: string}} | undefined
        if (!job?.promptId || !job.server || Math.max(job.queuedAt ?? 0, job.attachedAt ?? 0) < since) continue
        // a server given for this run only (--comfy=) is not in the settings: asked without credentials
        const server = servers.find(s => s.url === job.server!.url) ?? servers.find(s => s.name === job.server!.name) ?? job.server
        jobs.push({label: pendingFile, server, promptId: job.promptId, pendingFile})
    }
    return jobs
}
