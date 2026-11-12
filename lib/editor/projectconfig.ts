// The render settings of a project - config.json - as the workspace's Settings page and `bun run config` have them (#576): what can be
// chosen and how, what the project has now, and what a change would do: whether the loader takes it, and which rendered clips and
// pictures it makes stale. Nothing is rendered or planned by a change; the next run finds what is stale, as ever.
import {existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {qaRetriesNote, workflowDir} from '../config.ts'
import {type Finish, finishOf, MILD_FINISH} from '../finish.ts'
import {withProjectLock} from '../lock.ts'
import {readEditorFreshness, type EditorTarget} from './project.ts'
import type {ConfigChange, ConfigImpact, ConfigResult, ConfigView, SettingView} from '../../shared/workspace.ts'
import {kindOf} from './kinds.ts'

export type {ConfigChange, ConfigImpact, ConfigResult, ConfigView, SettingView} from '../../shared/workspace.ts'

type WorkflowKind = 'video' | 'film' | 'image' | 'sequence' | 'other'
/** The workflow files by what they render, read from the options type of each file - a copy of a workflow is found as the original is. */
export function workflowsByKind(): Record<WorkflowKind, string[]> {
    const types: Record<string, WorkflowKind> = {
        VideoWorkflowOptions: 'video',
        FilmVideoWorkflowOptions: 'film',
        ImageWorkflowOptions: 'image',
        SequenceWorkflowOptions: 'sequence',
    }
    const found: Record<WorkflowKind, string[]> = {video: [], film: [], image: [], sequence: [], other: []}
    // by name, not by file name: h3-ref2video comes before h3-ref2video-2pass (the '-' sorts before the '.' of '.ts')
    for (const name of readdirSync(workflowDir)
        .filter(f => f.endsWith('.ts'))
        .map(f => f.slice(0, -3))
        .sort()) {
        const type = /\bopts: (\w+)/.exec(readFileSync(join(workflowDir, `${name}.ts`), 'utf8'))?.[1]
        found[(type && types[type]) || 'other'].push(name)
    }
    return found
}

type Definition = Omit<SettingView, 'value' | 'default' | 'own' | 'choices'> & {
    for: 'both' | 'music' | 'film'
    choices?: (target: EditorTarget) => {value: unknown; label: string}[]
}
const inKind = (kind: WorkflowKind | ((target: EditorTarget) => WorkflowKind)) => (target: EditorTarget) => {
    const names = workflowsByKind()[typeof kind === 'function' ? kind(target) : kind]
    return names.map(name => ({value: name, label: name}))
}
const yesNo = [
    {value: true, label: 'on'},
    {value: false, label: 'off'},
]

/** What can be set, in the order the page shows it. Anything else in config.json (singers, the language, ...) is edited where it belongs, or by hand. */
const DEFINITIONS: Definition[] = [
    {
        key: 'videoWorkflow',
        label: 'Video workflow',
        group: 'Workflows',
        control: 'select',
        for: 'both',
        choices: inKind(t => (t.kind === 'film' ? 'film' : 'video')),
        note: 'Renders the clips. Another one makes every rendered clip stale - the workflow is part of what a clip is made from.',
    },
    {
        key: 'imageWorkflow',
        label: 'Image workflow',
        group: 'Workflows',
        control: 'select',
        for: 'both',
        choices: inKind('image'),
        note: 'Renders the pictures of the characters and places. Another one makes the rendered pictures stale.',
    },
    {
        key: 'sequenceSheets',
        label: 'Reference sheets',
        group: 'Workflows',
        control: 'select',
        for: 'both',
        choices: () => yesNo,
        note: 'Every character and place gets a multi-view sheet from a short turnaround video, not one flat picture. Off saves render time while you iterate.',
    },
    {
        key: 'sequenceWorkflow',
        label: 'Sheet workflow',
        group: 'Workflows',
        control: 'select',
        for: 'music',
        choices: inKind('sequence'),
        note: 'Renders the turnaround video of a reference sheet.',
    },
    {
        key: 'videoResolution',
        label: 'Video size',
        group: 'Size',
        control: 'text',
        for: 'both',
        auto: {value: -1, label: 'Workflow default'},
        note: 'Megapixels like 1.2 or a fixed size like 1280x720; empty for the size the workflow has. A two-pass workflow takes it as the final size.',
    },
    {
        key: 'imageResolution',
        label: 'Picture size',
        group: 'Size',
        control: 'text',
        for: 'both',
        auto: {value: -1, label: 'Workflow default'},
        note: 'As the video size, for the pictures: megapixels or WIDTHxHEIGHT; empty for the size the workflow has.',
    },
    {
        key: 'videoAspect',
        label: 'Aspect ratio',
        group: 'Size',
        control: 'text',
        for: 'both',
        note: "The clips' ratio: 16:9, 9:16 for portrait, 12:5 for scope.",
    },
    {
        key: 'videoSteps',
        label: 'Sampling steps',
        group: 'Sampling',
        control: 'number',
        for: 'music',
        auto: {value: -1, label: 'Workflow default'},
        note: 'Empty: the workflow has its own (8 with the turbo LoRA, 20 of the base model, 4 of the PRISM two-pass). The one pass of a single-pass workflow, or pass 1 of a two-pass one. A change makes the rendered clips stale.',
    },
    {
        key: 'videoRefineSteps',
        label: 'Refine steps (pass 2)',
        group: 'Sampling',
        control: 'number',
        for: 'music',
        auto: {value: -1, label: 'Workflow default'},
        note: 'Empty: the workflow has its own (2 with PRISM, 4 with the base model). Only a two-pass workflow has a pass 2. More steps draw more skin detail - too many make it harsh.',
    },
    {
        key: 'continuity',
        label: 'Continuity',
        group: 'Continuing clips',
        control: 'select',
        for: 'both',
        choices: target =>
            target.kind === 'film'
                ? [
                      {value: 'never', label: 'never: every clip is its own cut'},
                      {value: 'auto', label: 'auto: where the shot planning marked a take that goes on'},
                      {value: 'scene', label: 'scene: every clip of a scene but its first'},
                  ]
                : [
                      {value: 'never', label: 'never: every clip is its own cut'},
                      {value: 'auto', label: 'auto: the beats the story planning marked continuous'},
                      {value: 'always', label: 'always: every clip of a beat but its first'},
                  ],
        note: 'Which clips go on from the last frame of the clip before, without a cut. The drift of a clip is carried on and grows - see "Continuous scenes". In a music video another one redoes the blocking.',
    },
    {
        key: 'contextFrames',
        label: 'Context frames',
        group: 'Continuing clips',
        control: 'number',
        for: 'both',
        note: 'A clip that goes on from the one before starts on this many of its last frames: 0 = off, else 5 + 17·k - 22 or 39. Needs a continuity other than "never".',
    },
    {
        key: 'pinStartFrame',
        label: 'Pin the first frame',
        group: 'Continuing clips',
        control: 'select',
        for: 'music',
        choices: () => yesNo,
        note: 'A continuing clip is pinned to the last frame of the clip before it, not only given it as a picture.',
    },
    {
        key: 'clipPrompt',
        label: 'Clip prompt',
        group: 'Sampling',
        control: 'select',
        for: 'music',
        choices: () => [
            {value: 'full', label: 'full: as the planner wrote it'},
            {value: 'compact', label: 'compact: every movement told once'},
        ],
        note: 'How a clip prompt is worded. Compact leaves a movement to the action of the shot instead of telling it again per person, and writes the shot sentence in its natural order. To render the two against each other: a change makes every rendered clip stale.',
    },
    {
        key: 'seed',
        label: 'Seed',
        group: 'Seed and retries',
        control: 'number',
        for: 'both',
        auto: {value: -1, label: 'Random every render'},
        note: 'Empty: a new random seed with every render. A whole number from 0 is fixed: every clip gets a seed of its own from it, and rendering again gives the same clip. The retries below need a random seed.',
    },
    {
        key: 'leakRetries',
        label: 'Backdrop retries',
        group: 'Seed and retries',
        control: 'number',
        for: 'both',
        note: 'A clip that came out as the reference pictures lined up on their grey backdrop is rendered again with another seed, up to this often. 0 = off. Each retry is a whole render.',
    },
    {
        key: 'qaRetries',
        label: 'Black or frozen retries',
        group: 'Seed and retries',
        control: 'number',
        for: 'both',
        note: 'A clip with black frames or a picture that stands still is rendered again with a derived seed, and the better take kept. 0 = off. Each retry is a whole render.',
    },
    {
        key: 'llm.model',
        label: 'Language model',
        group: 'Language model',
        control: 'text',
        for: 'both',
        note: 'A model id of the LLM server for the plan runs of this project - empty: the one of the settings (bun run setup llm). The same as --llm-model for every run; only the model, the server stays.',
    },
    {
        key: 'finalFps',
        label: 'Final frame rate',
        group: 'Final video',
        control: 'number',
        for: 'both',
        note: '24 = off. 48 or 60 add a second final video with more frames, by interpolation (a ComfyUI job per clip).',
    },
    {
        key: 'interpolationModel',
        label: 'Interpolation model',
        group: 'Final video',
        control: 'text',
        for: 'both',
        note: "A file in ComfyUI's models/frame_interpolation/ (RIFE or FILM).",
    },
    {
        key: 'finish',
        label: 'Finish',
        group: 'Finish',
        control: 'select',
        for: 'both',
        choices: () => [
            {value: false, label: 'off'},
            {value: true, label: 'on'},
        ],
        note: 'A grade, sharpen and grain of the final video, written next to it as <name>-finished.mp4 - the video itself stays as it is. Off forgets the values below.',
    },
    {
        key: 'finish.blackLevel',
        label: 'Black level',
        group: 'Finish',
        needs: 'finish',
        control: 'number',
        step: 0.005,
        for: 'both',
        note: 'Of the range taken as black, 0-1: the clips come out a little milky, this makes their darks dark again.',
    },
    {
        key: 'finish.whiteLevel',
        label: 'White level',
        group: 'Finish',
        needs: 'finish',
        control: 'number',
        step: 0.005,
        for: 'both',
        note: 'Of the range taken as white, 0-1, above the black level.',
    },
    {
        key: 'finish.contrast',
        label: 'Contrast',
        group: 'Finish',
        needs: 'finish',
        control: 'number',
        step: 0.01,
        for: 'both',
        note: '1 = unchanged.',
    },
    {
        key: 'finish.saturation',
        label: 'Saturation',
        group: 'Finish',
        needs: 'finish',
        control: 'number',
        step: 0.01,
        for: 'both',
        note: '1 = unchanged.',
    },
    {
        key: 'finish.sharpen',
        label: 'Sharpen',
        group: 'Finish',
        needs: 'finish',
        control: 'number',
        step: 0.05,
        for: 'both',
        note: 'A contrast-adaptive sharpen, 0-1: 0 = off.',
    },
    {
        key: 'finish.colorMatch',
        label: 'Colour match',
        group: 'Finish',
        needs: 'finish',
        control: 'number',
        step: 0.05,
        for: 'both',
        note: 'Every clip this part of the way (0-1) to one reference in black, white and mean colour, so the cuts do not jump. 0 = off.',
    },
    {
        key: 'finish.colorReference',
        label: 'Colour reference',
        group: 'Finish',
        needs: 'finish',
        control: 'text',
        for: 'both',
        note: 'The clip the others are matched to, like slot-014 - empty: the median of all clips. Only with a colour match.',
    },
    {
        key: 'finish.grain',
        label: 'Film grain',
        group: 'Finish',
        needs: 'finish',
        control: 'number',
        step: 0.5,
        for: 'both',
        note: 'Over everything, last, 0-100: 0 = off, about 3 is light.',
    },
]
const definitionsOf = (target: EditorTarget) => DEFINITIONS.filter(d => d.for === 'both' || d.for === target.kind)

const configFile = (target: EditorTarget) => join(target.dir, 'config.json')
/** What config.json says - only what the user wrote. */
function ownSettings(target: EditorTarget): Record<string, unknown> {
    if (!existsSync(configFile(target))) return {}
    const raw: unknown = JSON.parse(readFileSync(configFile(target), 'utf8'))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('config.json must be a JSON object like {"seed": 42}')
    return raw as Record<string, unknown>
}

/** The loader's answer for these settings, as it would be for the file: checked in a folder of its own, so a wrong value is never written. */
async function loadWith(target: EditorTarget, settings: Record<string, unknown>) {
    const dir = mkdtempSync(join(tmpdir(), 'project-config-'))
    try {
        writeFileSync(join(dir, 'config.json'), JSON.stringify(settings))
        return await kindOf(target).config(dir)
    } finally {
        rmSync(dir, {recursive: true, force: true})
    }
}
const problemOf = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/^.*?config\.json: /, '')
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export async function readConfig(target: EditorTarget): Promise<ConfigView> {
    const own = ownSettings(target)
    const config = (await loadWith(target, own)) as unknown as Record<string, unknown>
    const base = kindOf(target).defaults as Record<string, unknown>
    return {
        settings: definitionsOf(target).map(({for: _, choices, ...definition}): SettingView => {
            // the finish: on or off, and each of its fields on its own - config.json has them in one object
            if (definition.key === 'finish' || finishField(definition.key)) {
                return {
                    ...definition,
                    value: settingIn(own, definition.key, base),
                    default: settingIn({}, definition.key, base),
                    own: ownFinish(own, definition.key),
                    ...(choices ? {choices: choices(target)} : {}),
                }
            }
            // the language model: the one field of config.json's llm object a project can set
            if (definition.key === LLM_MODEL)
                return {...definition, value: settingIn(own, LLM_MODEL), default: undefined, own: settingIn(own, LLM_MODEL) !== undefined}
            const value = config[definition.key]
            const offered = choices?.(target)
            return {
                ...definition,
                value,
                default: base[definition.key],
                own: definition.key in own,
                // what the project has is always among the choices - a workflow of its own, a custom finish
                ...(offered
                    ? {
                          choices: offered.some(c => same(c.value, value))
                              ? offered
                              : [...offered, {value, label: typeof value === 'object' ? `custom: ${JSON.stringify(value)}` : String(value)}],
                      }
                    : {}),
            }
        }),
    }
}

/** The settings with the change put in: `null` takes a key out, to its default. */
function applied(own: Record<string, unknown>, change: ConfigChange): Record<string, unknown> {
    const next = {...own}
    for (const [key, value] of Object.entries(change)) {
        if (value === null) delete next[key]
        else next[key] = value
    }
    return next
}

/** The project's language model, config.json's {"llm": {"model": …}}: empty or null takes it out - the one of the settings then. */
const LLM_MODEL = 'llm.model'
function foldLlm(change: ConfigChange): ConfigChange {
    if (!(LLM_MODEL in change)) return change
    const {[LLM_MODEL]: model, ...rest} = change
    return {...rest, llm: typeof model === 'string' && model.trim() ? {model: model.trim()} : null}
}

/** `finish.grain` -> `grain`: a field of the finish object, set on its own. */
const finishField = (key: string) => (key.startsWith('finish.') ? (key.slice(7) as keyof Finish) : undefined)

/**
 * A change as config.json takes it: the finish's fields (`finish.grain`) folded into its object. A field set turns the
 * finish on, one at its default is taken out of the object, and an object with nothing in it is the plain `true`. Off
 * writes no finish at all - the default.
 */
export function foldFinish(own: Record<string, unknown>, change: ConfigChange): ConfigChange {
    const fields = Object.keys(change).filter(key => finishField(key))
    if (!fields.length) return change
    const rest = Object.fromEntries(Object.entries(change).filter(([key]) => key !== 'finish' && !finishField(key)))
    const given = change.finish
    const was = own.finish ?? false
    const object: Record<string, unknown> =
        given && typeof given === 'object' ? {...given} : was && typeof was === 'object' ? {...(was as Record<string, unknown>)} : {}
    for (const key of fields) {
        const field = finishField(key)!
        const value = change[key]
        if (value === null || JSON.stringify(value) === JSON.stringify(MILD_FINISH[field])) delete object[field]
        else object[field] = value
    }
    const on = 'finish' in change ? given !== null && given !== false : true
    if (!on) return {...rest, finish: null}
    return {...rest, finish: Object.keys(object).length ? object : true}
}

/** What a setting is in these settings of config.json (`base`: the defaults) - a finish field as the finish has it. */
function settingIn(settings: Record<string, unknown>, key: string, base?: Record<string, unknown>): unknown {
    if (key === LLM_MODEL) return (settings.llm as {model?: string} | undefined)?.model
    const field = finishField(key)
    if (key !== 'finish' && !field) return settings[key]
    const finish = finishOf((settings.finish ?? base?.finish ?? false) as boolean | Partial<Finish>)
    return field ? (finish ?? MILD_FINISH)[field] : !!finish
}
/** Whether config.json has this finish setting written: the finish at all, or this field of its object. */
const ownFinish = (own: Record<string, unknown>, key: string) => {
    const field = finishField(key)
    return field ? typeof own.finish === 'object' && own.finish !== null && field in own.finish : 'finish' in own
}

const NOTHING = {clips: [] as string[], pictures: [] as string[]}

/** What a change would do, without doing it: whether the loader takes it, which keys change, and what goes stale. */
export async function previewConfig(target: EditorTarget, change: ConfigChange): Promise<ConfigImpact> {
    const known = definitionsOf(target).map(d => d.key)
    const unknown = Object.keys(change).filter(key => !known.includes(key))
    const own = ownSettings(target)
    const next = applied(own, foldLlm(foldFinish(own, change)))
    const changed = Object.keys(change).filter(key => known.includes(key) && !same(settingIn(own, key), settingIn(next, key)))
    // a finish written whole another way (an object for `true`): still a change of the file
    if ('finish' in change && !changed.includes('finish') && !same(own.finish, next.finish)) changed.push('finish')
    if (unknown.length) {
        return {
            problems: [`${unknown.join(', ')}: not a setting here - the settings are ${known.join(', ')}; anything else in config.json is edited by hand`],
            changed,
            stale: NOTHING,
            rendered: {clips: 0, pictures: 0},
            notes: [],
        }
    }
    let config
    try {
        config = await loadWith(target, next)
    } catch (e) {
        return {problems: [problemOf(e)], changed, stale: NOTHING, rendered: {clips: 0, pictures: 0}, notes: []}
    }
    const [before, after] = await Promise.all([readEditorFreshness(target), readEditorFreshness(target, config)])
    const goes = (was: Record<string, string>, now: Record<string, string>) => Object.keys(now).filter(id => now[id] === 'stale' && was[id] !== 'stale')
    const notes = [
        qaRetriesNote(config.qaRetries),
        config.contextFrames > 0 && config.continuity === 'never'
            ? `contextFrames ${config.contextFrames} does nothing while continuity is "never" - no clip goes on from the one before`
            : undefined,
        config.seed !== -1 && (config.leakRetries > 0 || config.qaRetries > 0)
            ? 'a fixed seed: rendering a clip again gives the same clip, so the retries change nothing - empty the seed for a random one'
            : undefined,
    ].filter((note): note is string => !!note)
    return {
        problems: [],
        changed,
        stale: {clips: goes(before.clips, after.clips), pictures: goes(before.pictures, after.pictures)},
        rendered: {clips: Object.keys(before.clips).length, pictures: Object.keys(before.pictures).length},
        notes,
    }
}

/** Writes a change that is whole and takes. Under the project's lock: no run is going on, and none starts meanwhile. */
export async function writeConfig(target: EditorTarget, change: ConfigChange): Promise<ConfigResult> {
    return withProjectLock(target.dir, target.id, async () => {
        const impact = await previewConfig(target, change)
        if (impact.problems.length || !impact.changed.length) return {...impact, written: false}
        const own = ownSettings(target)
        const text = `${JSON.stringify(applied(own, foldLlm(foldFinish(own, change))), null, 2)}\n`
        // whole or not at all: a file a run is reading is never half written
        const temporary = `${configFile(target)}.tmp`
        writeFileSync(temporary, text)
        renameSync(temporary, configFile(target))
        return {...impact, written: true}
    })
}
