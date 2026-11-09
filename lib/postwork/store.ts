import {existsSync, readFileSync, renameSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {readSettingsFile, saveSettings} from '../settings.ts'
import {POSTWORK_DEFAULTS, POSTWORK_STEPS, postworkProblem, type PostworkSettings, type PostworkStep} from './config.ts'

// Where the settings of the post-work steps are read from and kept (lib/postwork/config.ts says the order).

export type PostworkLayer = {[S in PostworkStep]?: Partial<PostworkSettings[S]>}

const projectConfigFile = (dir: string) => join(dir, 'config.json')
function readProjectConfig(dir: string): Record<string, unknown> {
    const file = projectConfigFile(dir)
    if (!existsSync(file)) return {}
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${file}: must be a JSON object`)
    return raw as Record<string, unknown>
}

/** The layers of a step's settings, in the order they win: the defaults, the settings file, the project's config.json. */
export async function postworkLayers(dir: string): Promise<{settings: PostworkLayer; project: PostworkLayer}> {
    const settings = ((await readSettingsFile()) as {postwork?: PostworkLayer}).postwork ?? {}
    const project = (readProjectConfig(dir).postwork ?? {}) as PostworkLayer
    for (const [where, layer] of [
        ['the settings file', settings],
        [projectConfigFile(dir), project],
    ] as const) {
        const wrong = postworkProblem(layer)
        if (wrong) throw new Error(`${where}: ${wrong}`)
    }
    return {settings, project}
}

/** The settings of every step for a project, the defaults with what the settings file and its config.json say put in. */
export async function loadPostwork(dir: string): Promise<PostworkSettings> {
    const {settings, project} = await postworkLayers(dir)
    return Object.fromEntries(POSTWORK_STEPS.map(step => [step, {...POSTWORK_DEFAULTS[step], ...settings[step], ...project[step]}])) as PostworkSettings
}

/** The settings of one step with the options of a command put in; checked, so a wrong option is said before anything runs. */
export function withOptions<S extends PostworkStep>(step: S, base: PostworkSettings[S], options: Partial<PostworkSettings[S]>): PostworkSettings[S] {
    const given = Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)) as Partial<PostworkSettings[S]>
    const wrong = postworkProblem({[step]: given})
    if (wrong) throw new Error(wrong.replace(/^postwork\.\w+\./, '--'))
    return {...base, ...given}
}

/**
 * Keeps settings of a step: in the project's config.json (`project`) or in the settings file (`settings`). Only the fields
 * given change, the rest of the file stays as it is. A value that is the default of the layer below is still written: it
 * is what was asked for.
 */
export async function savePostwork<S extends PostworkStep>(
    where: 'project' | 'settings',
    dir: string,
    step: S,
    values: Partial<PostworkSettings[S]>,
): Promise<string> {
    const given = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined))
    const wrong = postworkProblem({[step]: given})
    if (wrong) throw new Error(wrong)
    if (where === 'settings') {
        const file = (await readSettingsFile()) as {postwork?: PostworkLayer}
        const postwork = {...file.postwork, [step]: {...file.postwork?.[step], ...given}}
        await saveSettings({...file, postwork} as Parameters<typeof saveSettings>[0])
        return 'the settings file'
    }
    const config = readProjectConfig(dir)
    const postwork = (config.postwork ?? {}) as PostworkLayer
    const next = {...config, postwork: {...postwork, [step]: {...postwork[step], ...given}}}
    // whole or not at all: a file a run is reading is never half written
    const file = projectConfigFile(dir)
    writeFileSync(`${file}.tmp`, `${JSON.stringify(next, null, 2)}\n`)
    renameSync(`${file}.tmp`, file)
    return 'config.json'
}
