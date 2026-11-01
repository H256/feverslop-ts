import {type ComfyServer, loadSettings} from "../settings.ts";

// How busy the ComfyUI servers of the settings are, for the page: asked with a short timeout, a server that is down must not hold it up.
// The page knows servers by name. A URL never comes from it: a run goes to the ones of the settings the names say.

export type EditorServer = { name: string, reachable: boolean, running: number, pending: number, device?: string, freeGb?: number, totalGb?: number }

const ASK_MS = 2500
const KEPT_MS = 3000

const authOf = (server: ComfyServer): Record<string, string> => {
    const credentials = server.credentials as { type?: string, token?: string, username?: string, password?: string } | undefined
    if (credentials?.token) return {Authorization: `Bearer ${credentials.token}`}
    if (credentials?.username) return {Authorization: `Basic ${btoa(`${credentials.username}:${credentials.password ?? ''}`)}`}
    return {}
}

const ask = async <T>(server: ComfyServer, path: string, fetcher: typeof fetch): Promise<T> => {
    const response = await fetcher(`${server.url}${path}`, {signal: AbortSignal.timeout(ASK_MS), headers: authOf(server)})
    if (!response.ok) throw new Error(`${response.status}`)
    return await response.json() as T
}

type Queue = { queue_running?: unknown[], queue_pending?: unknown[] }
type Stats = { devices?: { name?: string, vram_free?: number, vram_total?: number }[] }

/** One server as the page shows it. Whatever does not answer counts as not reachable. */
export async function readServer(server: ComfyServer, fetcher: typeof fetch = fetch): Promise<EditorServer> {
    try {
        const [queue, stats] = await Promise.all([ask<Queue>(server, '/queue', fetcher), ask<Stats>(server, '/system_stats', fetcher)])
        const device = stats.devices?.[0]
        const gb = (bytes: number | undefined) => bytes === undefined ? undefined : Math.round(bytes / 2 ** 30 * 10) / 10
        return {
            name: server.name, reachable: true,
            running: queue.queue_running?.length ?? 0, pending: queue.queue_pending?.length ?? 0,
            device: device?.name?.replace(/^\S+:\d+\s+/, '').replace(/\s*:.*$/, ''),
            freeGb: gb(device?.vram_free), totalGb: gb(device?.vram_total),
        }
    } catch {
        return {name: server.name, reachable: false, running: 0, pending: 0}
    }
}

let kept: { at: number, servers: Promise<EditorServer[]> } | undefined

/** All servers of the settings. Many pages asking at once ask the servers once. */
export async function readServers(): Promise<EditorServer[]> {
    if (kept && Date.now() - kept.at < KEPT_MS) return kept.servers
    const servers = loadSettings().then(settings => Promise.all(settings.comfy.map(server => readServer(server))))
    kept = {at: Date.now(), servers}
    return servers
}

/** The URLs a run goes to, from the names the page chose: all of them is the same as saying nothing. Throws on a name the settings do not have. */
export function chosenUrls(all: Pick<ComfyServer, 'name' | 'url'>[], names: unknown): string[] | undefined {
    if (names === undefined || names === null) return undefined
    if (!Array.isArray(names) || !names.length) throw new Error('choose at least one server')
    const unknown = names.filter(name => !all.some(server => server.name === name))
    if (unknown.length) throw new Error(`no server ${unknown.join(', ')} in the settings`)
    return names.length === all.length ? undefined : all.filter(server => names.includes(server.name)).map(server => server.url)
}

export const urlsOfChoice = async (names: unknown) => chosenUrls((await loadSettings()).comfy, names)
