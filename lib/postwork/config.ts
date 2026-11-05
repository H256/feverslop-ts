import {existsSync} from "node:fs";
import {isAbsolute, join} from "node:path";

// The settings of the post-work steps (docs/postwork.md): optional steps on a finished video, each a command of its own that
// reads one final video and writes a new one next to it - nothing of the project is rendered again.
// Where they come from, the later one winning field by field: the defaults below, "postwork" in the settings file (the same
// for every project: a marker, a channel name), "postwork" in the project's config.json (this project), the options of
// the command. `--save` on a command writes what it was given into the project's config.json, `--save=settings` into the
// settings file.

export const CORNERS = ['top-right', 'top-left', 'bottom-right', 'bottom-left'] as const
export type Corner = typeof CORNERS[number]
// credits: only at the start (the light regime of an artistic or fictional work), interval: at the start and again every
// `interval` seconds, always: the whole video
export const LABEL_MODES = ['credits', 'interval', 'always'] as const
export type LabelMode = typeof LABEL_MODES[number]

/** The marker over the video (bun run label, #607). */
export type LabelSettings = {
    marker: string,         // a preset (assets/eu-ai-icons/<name>.png: generated-white, basic-black50, ...) or the path of a PNG
    mode: LabelMode,
    seconds: number,        // how long it is shown at a time (credits, interval)
    interval: number,       // interval: seconds from one showing to the next
    corner: Corner,
    size: number,           // the marker's height in % of the video's height
    margin: number,         // its distance from the edges in % of the video's height
}

export type PostworkSettings = { label: LabelSettings }
export type PostworkStep = keyof PostworkSettings

export const POSTWORK_DEFAULTS: PostworkSettings = {
    label: {marker: 'generated-white50', mode: 'credits', seconds: 5, interval: 60, corner: 'top-right', size: 6, margin: 3},
}
export const POSTWORK_STEPS = Object.keys(POSTWORK_DEFAULTS) as PostworkStep[]

const ICONS = join(import.meta.dir, '..', '..', 'assets', 'eu-ai-icons')
export const MARKER_PRESETS = ['generated', 'modified', 'basic'].flatMap(icon => ['white', 'white50', 'black', 'black50'].map(variant => `${icon}-${variant}`))
const isPreset = (marker: string) => MARKER_PRESETS.includes(marker)

/** The PNG of a marker: a preset from assets/eu-ai-icons/, else a path - relative to the project. Throws when there is no such file. */
export function markerFile(marker: string, projectDir: string): string {
    const file = isPreset(marker) ? join(ICONS, `${marker}.png`) : isAbsolute(marker) ? marker : join(projectDir, marker)
    if (!/\.png$/i.test(file)) throw new Error(`marker: ${marker} is no PNG - ffmpeg reads a PNG with its transparency; an SVG would need librsvg`)
    if (!existsSync(file)) throw new Error(`marker: no file ${marker} - a preset (${MARKER_PRESETS.join(', ')}) or the path of a PNG, absolute or relative to the project`)
    return file
}

type Check = (value: unknown) => string | undefined
const number = (min: number, max: number, what: string): Check => value =>
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? undefined : `must be ${what}, got ${JSON.stringify(value)}`
const oneOf = (values: readonly string[]): Check => value =>
    typeof value === 'string' && values.includes(value) ? undefined : `must be one of ${values.join(', ')}, got ${JSON.stringify(value)}`

const CHECKS: { [S in PostworkStep]: { [K in keyof PostworkSettings[S]]: Check } } = {
    label: {
        marker: value => typeof value === 'string' && value.trim() ? undefined : `must be a preset like "generated-white" or the path of a PNG, got ${JSON.stringify(value)}`,
        mode: oneOf(LABEL_MODES),
        seconds: number(0.5, 600, 'a number of seconds from 0.5 to 600'),
        interval: number(5, 3600, 'a number of seconds from 5 to 3600'),
        corner: oneOf(CORNERS),
        size: number(1, 50, 'a percentage of the video height from 1 to 50'),
        margin: number(0, 30, 'a percentage of the video height from 0 to 30'),
    },
}

/** What is wrong with a "postwork" object of a settings file or a config.json - only the fields it has are checked - or undefined. */
export function postworkProblem(raw: unknown): string | undefined {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return `postwork must be an object like {"label": {"marker": "generated-white"}}, got ${JSON.stringify(raw)}`
    for (const [step, values] of Object.entries(raw)) {
        const checks = CHECKS[step as PostworkStep] as Record<string, Check> | undefined
        if (!checks) return `postwork.${step}: no such step - the steps are ${POSTWORK_STEPS.join(', ')}`
        if (!values || typeof values !== 'object' || Array.isArray(values)) return `postwork.${step} must be an object, got ${JSON.stringify(values)}`
        for (const [key, value] of Object.entries(values)) {
            const check = checks[key]
            if (!check) return `postwork.${step}.${key}: no such setting - known are ${Object.keys(checks).join(', ')}`
            const wrong = check(value)
            if (wrong) return `postwork.${step}.${key} ${wrong}`
        }
    }
    return undefined
}
