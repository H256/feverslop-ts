// A client for the FeverSlop bridge plugin in a running wan2gp (wan2gp/plugin, #1192): files up, a job in, its progress, its files
// down. wan2gp renders; what is rendered is planned here. The server address is the wan2gp address, the bridge is at /feverslop.

import {readFileSync} from 'node:fs'
import {basename} from 'node:path'

export type BridgeProgress = {
    phase?: string
    status?: string
    percent?: number
    step?: number | null
    steps?: number | null
    window?: number | null
    windows?: number | null
}
export type BridgeJob = {
    id: string
    kind: 'generate' | 'postprocess'
    status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
    created: number
    finished: number | null
    progress: BridgeProgress
    files: {index: number; name: string}[]
    errors: string[]
}
export type BridgeSettings = Record<string, unknown> & ({model_type: string} | {template: string})

/** The bridge's address for a wan2gp address: "http://host:7860" or ".../feverslop" both work. */
export const bridgeBase = (server: string) => {
    const base = server.replace(/\/+$/, '')
    return base.endsWith('/feverslop') ? base : `${base}/feverslop`
}

export function bridgeClient(server: string, fetcher: typeof fetch = fetch) {
    const base = bridgeBase(server)
    async function call<T>(path: string, init?: RequestInit): Promise<T> {
        const response = await fetcher(`${base}${path}`, init)
        if (!response.ok) {
            const text = await response.text()
            let said = text
            try {
                said = (JSON.parse(text) as {detail?: string}).detail ?? text
            } catch {
                // not JSON: the text as it is
            }
            throw new Error(`wan2gp bridge ${response.status} on ${path}: ${said || response.statusText}`)
        }
        return (await response.json()) as T
    }
    return {
        base,
        health: () => call<{bridge: number; wangp: string}>('/api/health'),
        /** An input file kept on the server under its content hash; the name goes into the settings in its place. */
        async upload(file: string): Promise<string> {
            const form = new FormData()
            form.append('file', new Blob([readFileSync(file)]), basename(file))
            return (await call<{name: string}>('/api/files', {method: 'POST', body: form})).name
        },
        generate: (settings: BridgeSettings) =>
            call<BridgeJob>('/api/jobs', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({settings})}),
        postprocess: (media: string, upsampling: {spatial?: string; temporal?: string}) =>
            call<BridgeJob>('/api/jobs', {
                method: 'POST',
                headers: {'content-type': 'application/json'},
                body: JSON.stringify({postprocess: {media, ...upsampling}}),
            }),
        job: (id: string) => call<BridgeJob>(`/api/jobs/${encodeURIComponent(id)}`),
        cancel: (id: string) => call<BridgeJob>(`/api/jobs/${encodeURIComponent(id)}`, {method: 'DELETE'}),
        models: (ids: string[]) => call<Record<string, unknown>[]>(`/api/models?ids=${ids.map(encodeURIComponent).join(',')}`),
        async download(id: string, index: number): Promise<ArrayBuffer> {
            const response = await fetcher(`${base}/api/jobs/${encodeURIComponent(id)}/files/${index}`)
            if (!response.ok) throw new Error(`wan2gp bridge ${response.status}: job ${id} has no file ${index}`)
            return response.arrayBuffer()
        },
    }
}
export type BridgeClient = ReturnType<typeof bridgeClient>

/** Waits until the job is finished, telling each change of its progress; a failed or cancelled job is an error with its reasons. */
export async function waitForJob(client: BridgeClient, id: string, onProgress?: (job: BridgeJob) => void, everyMs = 2000): Promise<BridgeJob> {
    let said = ''
    for (;;) {
        const job = await client.job(id)
        const now = JSON.stringify([job.status, job.progress])
        if (now !== said) {
            said = now
            onProgress?.(job)
        }
        if (job.status === 'done') return job
        if (job.status === 'failed' || job.status === 'cancelled')
            throw new Error(`wan2gp job ${id} ${job.status}: ${job.errors.join('; ') || 'no reason given'}`)
        await Bun.sleep(everyMs)
    }
}

/** The settings with each local file of the given keys uploaded and named by what the bridge keeps it as ("|start_s=..." stays). */
export async function withUploads(client: BridgeClient, settings: BridgeSettings, isLocal: (value: string) => boolean): Promise<BridgeSettings> {
    const KEYS = [
        'image_refs',
        'image_start',
        'image_end',
        'image_guide',
        'video_guide',
        'video_source',
        'video_mask',
        'image_mask',
        'audio_guide',
        'audio_guide2',
        'audio_guide3',
        'audio_source',
    ]
    const one = async (value: unknown) => {
        if (typeof value !== 'string') return value
        const [path, ...rest] = value.split('|')
        return isLocal(path!) ? [await client.upload(path!), ...rest].join('|') : value
    }
    const out: Record<string, unknown> = {...settings}
    for (const key of KEYS) {
        const value = out[key]
        if (value === undefined) continue
        out[key] = Array.isArray(value) ? await Promise.all(value.map(one)) : await one(value)
    }
    return out as BridgeSettings
}
