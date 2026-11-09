import {afterEach, describe, expect, test} from 'bun:test'
import {existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {activeJobs, cancelJob, cancelJobs, jobsQueuedSince, trackJob, untrackJob} from './comfy-cancel.ts'

const server = {name: 'gpu', url: 'http://gpu:8188', credentials: {type: 'bearer_token' as const, token: 't'}}

// a ComfyUI that answers /queue with these jobs and records what it is told
function comfy(running: string[], pending: string[]) {
    const calls: {path: string; body?: unknown; auth?: string | null}[] = []
    const fetcher = (async (url: string, init?: RequestInit) => {
        const path = new URL(url).pathname
        calls.push({path, body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: new Headers(init?.headers).get('Authorization')})
        if (path === '/queue' && !init?.body)
            return Response.json({queue_running: running.map((id, n) => [n, id]), queue_pending: pending.map((id, n) => [n, id])})
        return new Response('{}')
    }) as unknown as typeof fetch
    return {calls, fetcher}
}

describe('cancelling our own job on its server', () => {
    test('a job waiting in the queue is deleted from it, nothing is interrupted', async () => {
        const {calls, fetcher} = comfy(['other'], ['ours'])
        expect(await cancelJob(server, 'ours', fetcher)).toBe('removed')
        expect(calls.slice(1)).toEqual([{path: '/queue', body: {delete: ['ours']}, auth: 'Bearer t'}])
    })
    test('the running job is interrupted only when it is ours, with its prompt id', async () => {
        const {calls, fetcher} = comfy(['ours'], [])
        expect(await cancelJob(server, 'ours', fetcher)).toBe('interrupted')
        expect(calls.slice(1)).toEqual([{path: '/interrupt', body: {prompt_id: 'ours'}, auth: 'Bearer t'}])
    })
    test('somebody else running: nothing is touched', async () => {
        const {calls, fetcher} = comfy(['other'], ['another'])
        expect(await cancelJob(server, 'ours', fetcher)).toBe('gone')
        expect(calls.map(c => c.path)).toEqual(['/queue'])
    })
    test('a server that does not answer', async () => {
        const fetcher = (async () => {
            throw new Error('down')
        }) as unknown as typeof fetch
        expect(await cancelJob(server, 'ours', fetcher)).toBe('unreachable')
    })
})

describe('the jobs of a run', () => {
    let dir = ''
    afterEach(() => {
        if (dir) rmSync(dir, {recursive: true, force: true})
    })
    const pending = (file: string, job: object) => {
        mkdirSync(join(dir, file, '..'), {recursive: true})
        writeFileSync(join(dir, file), JSON.stringify({server: {name: 'gpu', url: 'http://gpu:8188'}, ...job}))
    }

    test('queued or taken up since the run started - not those of an earlier run, not put-away ones', async () => {
        dir = mkdtempSync(join(tmpdir(), 'cancel-'))
        pending('videos/slot-001.mp4.pending.json', {promptId: 'new', queuedAt: 2000})
        pending('videos/slot-002.mp4.pending.json', {promptId: 'old', queuedAt: 500})
        pending('videos/slot-003.mp4.pending.json', {promptId: 'attached', queuedAt: 500, attachedAt: 1500})
        pending('assets/characters/mara.png.pending.json', {promptId: 'picture', queuedAt: 3000})
        pending('old/videos/slot-004.mp4.pending.json', {promptId: 'put-away', queuedAt: 3000})
        const jobs = await jobsQueuedSince(dir, 1000, [server])
        expect(jobs.map(j => j.promptId).sort()).toEqual(['attached', 'new', 'picture'])
        // the server of the settings, with its credentials
        expect(jobs[0]!.server).toBe(server)
    })
    test('cancelled: the pending file goes - unless the server did not answer, then the next run attaches to it', async () => {
        dir = mkdtempSync(join(tmpdir(), 'cancel-'))
        pending('a.mp4.pending.json', {promptId: 'ours', queuedAt: 1})
        pending('b.mp4.pending.json', {promptId: 'far', queuedAt: 1})
        const {fetcher} = comfy([], ['ours'])
        const [a, b] = await jobsQueuedSince(dir, 0, [server])
        await cancelJobs([a!], fetcher)
        await cancelJobs([b!], (async () => {
            throw new Error('down')
        }) as unknown as typeof fetch)
        expect(existsSync(join(dir, 'a.mp4.pending.json'))).toBe(false)
        expect(existsSync(join(dir, 'b.mp4.pending.json'))).toBe(true)
    })
    test('the jobs waited for are kept while they are waited for', () => {
        trackJob({label: 'slot-001', server, promptId: 'p', pendingFile: 'x.pending.json'})
        expect(activeJobs().map(j => j.promptId)).toEqual(['p'])
        untrackJob('x.pending.json')
        expect(activeJobs()).toEqual([])
    })
})
