import type {SetupView} from '../shared/workspace.ts'
import {type ComfyEntry, loadSettings, maskSecret, normalizeUrl, parseComfyEntries, type SettingsFile, settingsPath} from './settings.ts'

// The settings changed by options instead of questions (#827): for a script, and for the workspace's Machine panel, which has no
// terminal to ask in. The wizard of tools/setup.ts stays for a person at a terminal; both write the same settings file.

export type SetupOptions = {
    url?: string
    key?: string // "-" takes it out
    model?: string // "-" takes it out: the server's only model
    parallel?: string
    off?: boolean // vision: the text model describes pictures again
    add?: string // comfy: a server's URL
    name?: string
    token?: string
    remove?: string // comfy: a server by its name or URL
}
export const SETUP_OPTIONS = ['url', 'key', 'model', 'parallel', 'add', 'name', 'token', 'remove'] as const

/** Whether the command line changes anything - else the wizard asks. */
export const givesSetup = (options: SetupOptions) => SETUP_OPTIONS.some(name => options[name] !== undefined) || !!options.off

const keyOf = (given: string | undefined, current: string | undefined) => (given === '-' ? undefined : (given ?? current))

/**
 * The settings file with the change of `command` (llm, vision, comfy) put in, and what changed in words. Throws with what is wrong,
 * in the words of the options. Nothing is written here.
 */
export function changeSettings(file: SettingsFile, command: string, options: SetupOptions): {file: SettingsFile; said: string[]} {
    const next: SettingsFile = structuredClone(file)
    const said: string[] = []
    if (command === 'llm') {
        const url = options.url !== undefined ? normalizeUrl(options.url, '--url') : next.llm?.url
        if (!url) throw new Error('--url: the LLM server, like http://localhost:8080/v1')
        const parallel = options.parallel !== undefined ? Number(options.parallel) : next.llm?.parallel
        if (parallel !== undefined && !(Number.isInteger(parallel) && parallel >= 1))
            throw new Error(`--parallel: a whole number from 1, got "${options.parallel}"`)
        const apiKey = keyOf(options.key, next.llm?.apiKey)
        const model = keyOf(options.model, next.llm?.model)
        next.llm = {
            url,
            ...(apiKey ? {apiKey} : {}),
            ...(model ? {model} : {}),
            ...(parallel ? {parallel} : {}),
            ...(next.llm?.vision ? {vision: next.llm.vision} : {}),
        }
        said.push(
            `LLM server ${url}${model ? `, model ${model}` : ''}${apiKey ? ', with a key' : ''}${parallel && parallel > 1 ? `, ${parallel} calls at once` : ''}`,
        )
        return {file: next, said}
    }
    if (command === 'vision') {
        if (options.off) {
            if (next.llm?.vision) delete next.llm.vision
            said.push('Pictures are described by the text model')
            return {file: next, said}
        }
        const current = next.llm?.vision ?? {}
        const url = options.url === '-' ? undefined : options.url !== undefined ? normalizeUrl(options.url, '--url') : current.url
        const apiKey = keyOf(options.key, current.apiKey)
        const model = keyOf(options.model, current.model)
        if (!url && !model) throw new Error('--url and/or --model: a server or a model of the text server for describing pictures - or --off')
        next.llm = {...next.llm, vision: {...(url ? {url} : {}), ...(apiKey ? {apiKey} : {}), ...(model ? {model} : {})}}
        said.push(`Pictures described by ${model ?? "the server's only model"} on ${url ?? 'the text server'}`)
        return {file: next, said}
    }
    if (command === 'comfy') {
        const entries: ComfyEntry[] = [...(next.comfy ?? [])]
        const urlOf = (entry: ComfyEntry) => (typeof entry === 'string' ? entry : entry.url)
        if (options.remove !== undefined) {
            const servers = entries.length ? parseComfyEntries(entries, 'comfy') : []
            const at = servers.findIndex(s => s.name === options.remove || s.url === normalizeUrl(options.remove!, '--remove'))
            if (at < 0) throw new Error(`--remove: no server "${options.remove}" - ${servers.map(s => s.name).join(', ') || 'none saved'}`)
            entries.splice(at, 1)
            said.push(`Removed ${servers[at]!.name}`)
        }
        if (options.add !== undefined) {
            const url = normalizeUrl(options.add, '--add')
            if (entries.some(entry => normalizeUrl(urlOf(entry), 'comfy') === url)) throw new Error(`--add: ${url} is there already`)
            entries.push(
                options.name || options.token ? {url, ...(options.name ? {name: options.name} : {}), ...(options.token ? {token: options.token} : {})} : url,
            )
            said.push(`Added ${options.name ?? url}`)
        }
        if (!said.length) throw new Error('--add=<url> [--name=] [--token=] or --remove=<name or url>')
        if (entries.length) {
            parseComfyEntries(entries, 'comfy')
            next.comfy = entries
        } else delete next.comfy
        return {file: next, said}
    }
    throw new Error(`setup ${command} takes no options - llm, vision and comfy do`)
}

/** The effective settings as data, every key masked: `bun run setup show --json`, and the workspace's Machine panel. */
export async function settingsView(): Promise<SetupView> {
    const {llm, comfy, sources} = await loadSettings()
    const masked = (secret?: string) => (secret ? maskSecret(secret) : undefined)
    return {
        file: settingsPath(),
        llm: {
            url: llm.url,
            apiKey: masked(llm.apiKey),
            model: llm.model,
            parallel: llm.parallel,
            vision: llm.vision && {url: llm.vision.url, apiKey: masked(llm.vision.apiKey), model: llm.vision.model},
        },
        comfy: comfy.map(server => ({name: server.name, url: server.url, auth: server.credentials?.type})),
        sources: sources as Record<string, string>,
    }
}
