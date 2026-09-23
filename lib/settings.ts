import {chmodSync, existsSync, mkdirSync, writeFileSync} from "node:fs";
import {homedir} from "node:os";
import {dirname, join} from "node:path";
import type {BasicCredentials, BearerTokenCredentials, SystemStatsResponse} from "@saintno/comfyui-sdk";
import {warnUnknownKeys} from "./log.ts";

// The machine-specific connections: the LLM server and the ComfyUI servers. Stored outside the repo in a global
// settings file (written by `bun run setup`), overridable per project (llm.model), by env vars and by CLI flags.
// Documented in the README, section "Setup".

export type ComfyEntry = string | { url: string, name?: string, token?: string, username?: string, password?: string }

// the settings file as written by `bun run setup`
export type SettingsFile = {
    llm?: { url?: string, apiKey?: string, model?: string },
    comfy?: ComfyEntry[],
}

export type ComfyServer = { url: string, name: string, credentials?: BasicCredentials | BearerTokenCredentials }

export type Source = 'default' | 'file' | 'project' | 'env' | 'flag'

export type Settings = {
    llm: { url?: string, apiKey?: string, model?: string },
    comfy: ComfyServer[],
    sources: { llmUrl: Source, llmApiKey: Source, llmModel: Source, comfy: Source },
}

// everything that beats the settings file - all optional, strings as typed on the command line
export type SettingsOverrides = {
    projectModel?: string,      // "llm": {"model": …} in the project's config.json
    llmUrl?: string,
    llmApiKey?: string,
    llmModel?: string,
    comfy?: string,             // comma-separated URLs
}

export const defaultComfy = 'http://localhost:8188'

export function settingsPath() {
    if (process.env.FEVERSLOP_SETTINGS) return process.env.FEVERSLOP_SETTINGS
    const base = process.platform === 'win32'
        ? process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
        : process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config')
    return join(base, 'feverslop-ts', 'settings.json')
}

/** The settings file, validated - {} when there is none. */
export async function readSettingsFile(): Promise<SettingsFile> {
    const file = settingsPath()
    if (!existsSync(file)) return {}
    let raw: SettingsFile
    try {
        raw = await Bun.file(file).json()
    } catch (e) {
        throw new Error(`${file}: not valid JSON - ${(e as Error).message}`)
    }
    const fail = (message: string) => {
        throw new Error(`${file}: ${message} - fix it or run: bun run setup`)
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('must be a JSON object')

    warnUnknownKeys(raw, ['llm', 'comfy'], file)

    if (raw.llm !== undefined) {
        if (!raw.llm || typeof raw.llm !== 'object' || Array.isArray(raw.llm)) fail('llm must be an object like {"url": …, "apiKey": …, "model": …}')
        warnUnknownKeys(raw.llm, ['url', 'apiKey', 'model'], file, 'llm.')
        for (const key of ['url', 'apiKey', 'model'] as const) {
            if (raw.llm[key] !== undefined && typeof raw.llm[key] !== 'string') fail(`llm.${key} must be a string, got ${JSON.stringify(raw.llm[key])}`)
        }
        if (raw.llm.url) checkUrl(raw.llm.url, `${file}: llm.url`)
    }
    if (raw.comfy !== undefined) {
        if (!Array.isArray(raw.comfy)) fail(`comfy must be a list of URLs or {"url": …} objects, got ${JSON.stringify(raw.comfy)}`)
        parseComfyEntries(raw.comfy, `${file}: comfy`)
    }
    return raw
}

/** Writes the settings file - only readable by the user, it can hold API keys. */
export async function saveSettings(settings: SettingsFile) {
    const file = settingsPath()
    mkdirSync(dirname(file), {recursive: true})
    writeFileSync(file, JSON.stringify(settings, null, 2) + '\n', {mode: 0o600})
    chmodSync(file, 0o600)      // the mode above only applies to a new file
}

/** The effective settings: defaults → settings file → project config → env vars → flags, with the source of each. */
export async function loadSettings(overrides: SettingsOverrides = {}): Promise<Settings> {
    const file = await readSettingsFile()
    const env = process.env
    const sources: Settings['sources'] = {llmUrl: 'default', llmApiKey: 'default', llmModel: 'default', comfy: 'default'}

    // the value of the highest layer that sets it
    const pick = (key: keyof Settings['sources'], layers: [Source, string | undefined][]) => {
        let value: string | undefined
        for (const [source, v] of layers) {
            if (v === undefined || v === '') continue
            value = v
            sources[key] = source
        }
        return value
    }
    const url = pick('llmUrl', [['file', file.llm?.url], ['env', env.FEVERSLOP_LLM_URL], ['flag', overrides.llmUrl]])
    const apiKey = pick('llmApiKey', [['file', file.llm?.apiKey], ['env', env.FEVERSLOP_LLM_API_KEY], ['flag', overrides.llmApiKey]])
    const model = pick('llmModel', [['file', file.llm?.model], ['project', overrides.projectModel], ['env', env.FEVERSLOP_LLM_MODEL], ['flag', overrides.llmModel]])
    if (url && sources.llmUrl !== 'file') checkUrl(url, sources.llmUrl === 'env' ? 'FEVERSLOP_LLM_URL' : '--llm-url')

    let comfy = parseComfyEntries([defaultComfy], 'default')
    if (file.comfy?.length) {
        comfy = parseComfyEntries(file.comfy, `${settingsPath()}: comfy`)
        sources.comfy = 'file'
    }
    const envComfy = env.FEVERSLOP_COMFY || env.COMFY
    if (envComfy) {
        comfy = parseComfyEntries(splitList(envComfy), env.FEVERSLOP_COMFY ? 'FEVERSLOP_COMFY' : 'COMFY')
        sources.comfy = 'env'
    }
    if (overrides.comfy) {
        comfy = parseComfyEntries(splitList(overrides.comfy), '--comfy')
        sources.comfy = 'flag'
    }
    return {llm: {url: url && trimSlash(url), apiKey, model}, comfy, sources}
}

/** Settings file entries → servers with a unique name each and SDK credentials. */
export function parseComfyEntries(entries: unknown[], where: string): ComfyServer[] {
    const fail = (message: string): never => {
        throw new Error(`${where}: ${message}`)
    }
    if (!entries.length) fail('the list is empty - remove it to use the default, or add a server')
    const servers = entries.map((entry, i): ComfyServer => {
        const at = `entry ${i + 1}`
        if (typeof entry === 'string') {
            const url = normalizeUrl(entry, `${where}, ${at}`)
            return {url, name: new URL(url).host}
        }
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return fail(`${at} must be a URL or an object like {"url": …}, got ${JSON.stringify(entry)}`)
        const e = entry as Exclude<ComfyEntry, string>
        warnUnknownKeys(e, ['url', 'name', 'token', 'username', 'password'], `${where}, ${at}`)
        for (const key of ['url', 'name', 'token', 'username', 'password'] as const) {
            if (e[key] !== undefined && typeof e[key] !== 'string') fail(`${at}: ${key} must be a string, got ${JSON.stringify(e[key])}`)
        }
        if (!e.url) fail(`${at} has no url`)
        const url = normalizeUrl(e.url, `${where}, ${at}`)
        if (e.token && (e.username || e.password)) fail(`${at}: use either token or username/password, not both`)
        if (!e.username !== !e.password) fail(`${at}: username and password go together`)
        const credentials = e.token ? {type: 'bearer_token' as const, token: e.token}
            : e.username ? {type: 'basic' as const, username: e.username, password: e.password!} : undefined
        const name = e.name?.trim() || new URL(url).host
        if (!/^[\w.:-]+$/.test(name)) fail(`${at}: name "${name}" may only contain letters, digits, ".", ":", "_" and "-"`)
        return {url, name, ...(credentials ? {credentials} : {})}
    })
    // the name ends up in the client id - the same server listed twice gets gpu, gpu-2, …
    const seen = new Map<string, number>()
    for (const server of servers) {
        const count = (seen.get(server.name) ?? 0) + 1
        seen.set(server.name, count)
        if (count > 1) server.name = `${server.name}-${count}`
    }
    return servers
}

/** "gpu-box:8188" → "http://gpu-box:8188" (the old COMFY env var had no scheme), without a trailing slash. */
export function normalizeUrl(value: string, where: string) {
    const url = trimSlash(/^[a-z][a-z\d+.-]*:\/\//i.test(value.trim()) ? value.trim() : `http://${value.trim()}`)
    checkUrl(url, where)
    return url
}

function checkUrl(value: string, where: string) {
    let url: URL
    try {
        url = new URL(value)
    } catch {
        throw new Error(`${where}: "${value}" is not a URL`)
    }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${where}: "${value}" must start with http:// or https://`)
}

const trimSlash = (url: string) => url.replace(/\/+$/, '')
const splitList = (value: string) => value.split(',').map(s => s.trim()).filter(Boolean)

export function authHeaders(server: ComfyServer): Record<string, string> {
    const c = server.credentials
    if (c?.type === 'bearer_token') return {Authorization: `Bearer ${c.token}`}
    if (c?.type === 'basic') return {Authorization: `Basic ${btoa(`${c.username}:${c.password}`)}`}
    return {}
}

/** GET /system_stats - throws when the server doesn't answer in time or rejects the credentials. */
export async function probeComfy(server: ComfyServer, timeoutMs = 5000): Promise<SystemStatsResponse> {
    let response: Response
    try {
        response = await fetch(`${server.url}/system_stats`, {headers: authHeaders(server), signal: AbortSignal.timeout(timeoutMs)})
    } catch (e) {
        const error = e as Error
        throw new Error(error.name === 'TimeoutError' ? `no answer within ${timeoutMs / 1000} s` : error.message)
    }
    if (response.status === 401 || response.status === 403) throw new Error(`${response.status} ${response.statusText} - wrong or missing token/password`)
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    return await response.json() as SystemStatsResponse
}

/** "NVIDIA GeForce RTX 4090, 18.3 of 24.0 GB free" - ComfyUI names it "cuda:0 NVIDIA GeForce RTX 4090 : cudaMallocAsync" */
export function describeDevices(stats: SystemStatsResponse) {
    const gb = (bytes: number) => (bytes / 1024 ** 3).toFixed(1)
    const name = (device: string) => device.replace(/^cuda:\d+\s*/, '').replace(/\s*:\s*\w+$/, '')
    return stats.devices.map(d => d.vram_total ? `${name(d.name)}, ${gb(d.vram_free)} of ${gb(d.vram_total)} GB free` : name(d.name)).join(' + ') || 'no devices reported'
}

/** "sk-…xY (48 chars)" - enough to recognize a key, not enough to use it */
export function maskSecret(secret: string) {
    return secret.length > 8 ? `${secret.slice(0, 3)}…${secret.slice(-2)} (${secret.length} chars)` : '•'.repeat(secret.length)
}
