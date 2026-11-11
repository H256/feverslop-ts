import {existsSync, statfsSync} from 'node:fs'
import {libraryDir} from './library.ts'
import {listModels, takesPictures} from './llm.ts'
import {loadSettings, probeComfy, type Settings, settingsPath} from './settings.ts'

// What this machine has of what a video needs, and what to do about what it lacks (#828). Read only: asks the servers whether they
// are there, looks for the programs on the PATH, renders and writes nothing. For `bun run doctor` and, as JSON, the workspace.

export type Check = {
    /** what is looked at: "LLM server", "ffmpeg" */
    what: string
    /** ready: there; missing: a run fails without it; note: works, but worth knowing */
    state: 'ready' | 'missing' | 'note'
    /** what was found, in a few words */
    found: string
    /** the command or the place that puts it right - only when it is not ready */
    fix?: string
}

/** What the outside world is asked through - replaced in tests. */
export type Probes = {
    models: (url: string, apiKey?: string) => Promise<string[]>
    pictures: (url: string, model: string, apiKey?: string) => Promise<boolean | undefined>
    comfy: (server: Settings['comfy'][number]) => Promise<{device?: string; freeGb?: number}>
    onPath: (program: string) => boolean
    freeGb: (dir: string) => number | undefined
}

const gb = (bytes: number) => Math.round((bytes / 1024 ** 3) * 10) / 10
export const realProbes: Probes = {
    models: (url, apiKey) => listModels(url, apiKey, 5000),
    pictures: (url, model, apiKey) => takesPictures(url, model, apiKey),
    comfy: async server => {
        const stats = await probeComfy(server)
        const device = stats.devices?.[0]
        return {device: device?.name, freeGb: device ? gb(device.vram_free) : undefined}
    },
    onPath: program => Bun.which(program) !== null,
    freeGb: dir => {
        try {
            const stats = statfsSync(dir)
            return gb(stats.bavail * stats.bsize)
        } catch {
            return undefined
        }
    },
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

async function llmChecks(settings: Settings, probes: Probes): Promise<Check[]> {
    const {url, apiKey, model, vision} = settings.llm
    if (!url) return [{what: 'LLM server', state: 'missing', found: 'none configured', fix: 'bun run setup llm'}]
    let ids: string[]
    try {
        ids = await probes.models(url, apiKey)
    } catch (e) {
        return [{what: 'LLM server', state: 'missing', found: `${url} does not answer (${message(e)})`, fix: 'start it, or set another one: bun run setup llm'}]
    }
    const checks: Check[] = [{what: 'LLM server', state: 'ready', found: `${url} · ${ids.length} model(s)`}]
    const chosen = model ?? (ids.length === 1 ? ids[0] : undefined)
    if (model && !ids.includes(model))
        checks.push({
            what: 'LLM model',
            state: 'missing',
            found: `"${model}" is not on the server (it has: ${ids.join(', ') || 'none'})`,
            fix: 'bun run setup llm-model',
        })
    else if (!chosen)
        checks.push({
            what: 'LLM model',
            state: 'missing',
            found: ids.length ? `several models and none chosen (${ids.join(', ')})` : 'the server lists no model',
            fix: ids.length ? 'bun run setup llm-model' : 'load a model on the server',
        })
    else checks.push({what: 'LLM model', state: 'ready', found: chosen})

    // pictures: a model of its own, else the text model - needed for a picture of your own, replace-character, the join check
    const visionUrl = vision?.url ?? url
    const visionModel = vision?.model ?? (vision?.url ? undefined : chosen)
    if (!visionModel) checks.push({what: 'Reading pictures', state: 'note', found: 'no model to ask', fix: 'bun run setup vision'})
    else {
        const reads = await probes.pictures(visionUrl, visionModel, vision?.url ? vision.apiKey : (vision?.apiKey ?? apiKey)).catch(() => undefined)
        checks.push(
            reads === true
                ? {what: 'Reading pictures', state: 'ready', found: visionModel}
                : reads === false
                  ? {
                        what: 'Reading pictures',
                        state: 'note',
                        found: `${visionModel} takes no pictures - only needed for a picture of your own, replacing a character and the join check`,
                        fix: 'bun run setup vision',
                    }
                  : {
                        what: 'Reading pictures',
                        state: 'note',
                        found: `${visionModel} - the server does not say whether it takes pictures; the first call shows`,
                    },
        )
    }
    return checks
}

async function comfyChecks(settings: Settings, probes: Probes): Promise<Check[]> {
    const results = await Promise.all(
        settings.comfy.map(async server => {
            try {
                const {device, freeGb} = await probes.comfy(server)
                const found = [server.url, device, freeGb !== undefined ? `${freeGb} GB free` : undefined].filter(Boolean).join(' · ')
                return {what: `ComfyUI ${server.name}`, state: 'ready', found} as Check
            } catch (e) {
                return {what: `ComfyUI ${server.name}`, state: 'missing', found: `${server.url} does not answer (${message(e)})`} as Check
            }
        }),
    )
    // one server that answers is enough to render
    const anyReady = results.some(check => check.state === 'ready')
    return results.map(check =>
        check.state === 'ready'
            ? check
            : {
                  ...check,
                  state: anyReady ? 'note' : 'missing',
                  fix:
                      settings.sources.comfy === 'default'
                          ? 'bun run setup comfy (no server is set: this is the default address)'
                          : 'start ComfyUI there, or: bun run setup comfy',
              },
    )
}

function programChecks(probes: Probes): Check[] {
    const program = (name: string, forWhat: string, fix: string): Check =>
        probes.onPath(name) ? {what: name, state: 'ready', found: 'on the PATH'} : {what: name, state: 'missing', found: `not on the PATH - ${forWhat}`, fix}
    return [
        program('ffmpeg', 'cuts the sound, joins the clips, makes the final video', 'install ffmpeg and open a new terminal'),
        program('ffprobe', 'reads sizes and lengths of videos', 'it comes with ffmpeg'),
        program('uv', 'runs the song analysis (tools/*.py)', 'https://docs.astral.sh/uv/ - then open a new terminal'),
    ]
}

/** Everything a first video needs, each with what was found and what to do. */
export async function doctor(probes: Probes = realProbes): Promise<Check[]> {
    const file = settingsPath()
    const settings = await loadSettings()
    const library = await libraryDir()
    const free = probes.freeGb('.')
    const [llm, comfy] = await Promise.all([llmChecks(settings, probes), comfyChecks(settings, probes)])
    return [
        existsSync(file)
            ? {what: 'Settings file', state: 'ready', found: file}
            : {what: 'Settings file', state: 'note', found: `none yet (${file}) - the defaults and the environment count`, fix: 'bun run setup'},
        ...llm,
        ...comfy,
        ...programChecks(probes),
        existsSync(library)
            ? {what: 'Library', state: 'ready', found: library}
            : {what: 'Library', state: 'note', found: `${library} is not there yet - made by the first asset or song put into it`},
        ...(free === undefined
            ? []
            : [
                  free < 20
                      ? ({what: 'Disk space', state: 'note', found: `${free} GB free here - a music video with its versions takes 2 to 6 GB`} as Check)
                      : ({what: 'Disk space', state: 'ready', found: `${free} GB free here`} as Check),
              ]),
    ]
}

/** What to do first, in one line - undefined when nothing a run needs is missing. */
export function firstFix(checks: Check[]): string | undefined {
    const missing = checks.find(check => check.state === 'missing')
    return missing && `${missing.what}: ${missing.fix ?? missing.found}`
}
