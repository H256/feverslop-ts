import {existsSync} from "node:fs";
import {partialOf, replaceWithPartial} from "../json-file.ts";
import {join} from "node:path";
import {log, styles} from "../log.ts";
import {dropPartials, keepEach} from "../partials.ts";
import {builtOnIn, redoAfterIn} from "../project.ts";
import type {FilmProject} from "./types.ts";

export type FilmStepName = Exclude<keyof FilmProject, 'inputs' | 'partials' | 'castingCopies' | 'sheetViews' | 'shotViews' | 'clipFits' | 'roleChanges'>
// an input file or setting a film's steps are made from (lib/film/inputs.ts): its value now, and the steps it redoes when it changes
export type FilmInput = { value: string | Uint8Array, steps: FilmStepName[] }

// Which steps a step reads from - redoing a step also redoes everything built on it
const dependsOn: Record<FilmStepName, FilmStepName[]> = {
    brief: [],
    outline: ['brief'],
    screenplay: ['brief', 'outline'],
    cast: ['screenplay'],
    summary: ['screenplay', 'cast'],
    lookBrief: ['summary'],
    characterLooks: ['cast', 'lookBrief'],
    characterDescriptions: ['characterLooks'],
    locationLooks: ['cast', 'lookBrief', 'summary'],
    locationDescriptions: ['locationLooks'],
    locationViews: ['locationLooks', 'cast', 'screenplay'],
    props: ['screenplay', 'cast'],
    coverage: ['screenplay', 'cast', 'lookBrief', 'locationViews', 'props', 'characterDescriptions', 'locationDescriptions'],
    scriptNotes: ['screenplay'],
    scriptFixes: ['screenplay'],
    subtitles: ['screenplay'],
}

export const FILM_STEP_NAMES = Object.keys(dependsOn) as FilmStepName[]

type Data = Record<string, unknown>
const record = (value: unknown): value is Data => value !== null && typeof value === 'object' && !Array.isArray(value)
const strings = (value: unknown) => Array.isArray(value) && value.every(item => typeof item === 'string')
const stringRecord = (value: unknown) => record(value) && Object.values(value).every(item => typeof item === 'string')
const fields = (value: unknown, required: string[]) => record(value) && required.every(key => typeof value[key] === 'string')

/** Returns a path-specific problem for one cached film step, or undefined when its stored shape is usable. */
export function filmStepProblem(name: FilmStepName, value: unknown): string | undefined {
    const fail = (path: string) => `expected ${path} to have the saved ${name} shape`
    if (['summary', 'lookBrief'].includes(name)) return typeof value === 'string' ? undefined : fail('a string')
    if (['characterLooks', 'characterDescriptions', 'locationLooks', 'locationDescriptions', 'scriptNotes', 'subtitles'].includes(name)) {
        const valid = name === 'scriptNotes' ? strings(value) : stringRecord(value)
        return valid ? undefined : fail(name === 'scriptNotes' ? 'an array of strings' : 'an object of strings')
    }
    if (name === 'brief') return fields(value, ['mode', 'title', 'language', 'logline', 'genre', 'tone', 'setting']) ? undefined : fail('brief fields')
    if (name === 'outline') {
        if (!record(value) || !Array.isArray(value.characters) || !Array.isArray(value.scenes)) return fail('outline characters/scenes')
        if (!value.characters.every(c => fields(c, ['name', 'role', 'appearance', 'voice'])) || !value.scenes.every(s => fields(s, ['heading', 'summary', 'purpose']) && strings(s.characters) && typeof s.seconds === 'number')) return fail('outline scene and character fields')
        return undefined
    }
    if (name === 'screenplay') {
        if (!record(value) || !fields(value, ['title', 'language']) || !Array.isArray(value.scenes)) return fail('screenplay title/language/scenes')
        for (let i = 0; i < value.scenes.length; i++) {
            const scene = value.scenes[i]
            if (!record(scene) || !fields(scene, ['id', 'location', 'time']) || !['INT', 'EXT', 'INT/EXT'].includes(String(scene.setting)) || !Array.isArray(scene.elements)) return fail(`screenplay.scenes[${i}]`)
            for (let j = 0; j < scene.elements.length; j++) {
                const element = scene.elements[j]
                if (!record(element) || typeof element.text !== 'string' || (element.type !== 'action' && (element.type !== 'dialogue' || typeof element.speaker !== 'string' || !['spoken', 'offscreen', 'voiceover'].includes(String(element.kind))))) return fail(`screenplay.scenes[${i}].elements[${j}].text/type`)
            }
        }
        return undefined
    }
    if (name === 'cast') {
        if (!record(value) || !Array.isArray(value.characters) || !Array.isArray(value.locations)) return fail('cast characters/locations')
        return value.characters.every(c => fields(c, ['id', 'name', 'role', 'appearance', 'voice']) && strings(c.aliases)) && value.locations.every(l => fields(l, ['id', 'name', 'description']) && strings(l.aliases)) ? undefined : fail('cast member fields')
    }
    if (name === 'locationViews') return record(value) && Object.values(value).every(views => Array.isArray(views) && views.every(v => fields(v, ['name', 'shows']))) ? undefined : fail('location views')
    if (name === 'props') return Array.isArray(value) && value.every(prop => fields(prop, ['id', 'name', 'description'])) ? undefined : fail('props array')
    if (name === 'scriptFixes') return Array.isArray(value) && value.every(fix => fields(fix, ['scene', 'before', 'after'])) ? undefined : fail('script fixes array')
    if (name === 'coverage') {
        if (!Array.isArray(value)) return fail('coverage array')
        for (let i = 0; i < value.length; i++) {
            const scene = value[i]
            if (!record(scene) || !fields(scene, ['sceneId', 'soundscape']) || !Array.isArray(scene.shots)) return fail(`coverage[${i}].sceneId/soundscape/shots`)
            for (let j = 0; j < scene.shots.length; j++) {
                const shot = scene.shots[j]
                if (!record(shot) || !fields(shot, ['framing', 'camera', 'action']) || !strings(shot.characters) || !Array.isArray(shot.lines) || !shot.lines.every(Number.isInteger) || typeof shot.seconds !== 'number') return fail(`coverage[${i}].shots[${j}]`)
            }
        }
        return undefined
    }
    return fail('a recognized step value')
}

/** The --redo for a film's data changed by hand - as redoAfter of the music video (lib/project.ts). */
export const filmRedoAfter = (changed: FilmStepName[], data: FilmProject): FilmStepName[] => redoAfterIn(dependsOn, changed, data)
/** The steps of a film with a result built on these, near or far - as builtOn of the music video. */
export const filmBuiltOn = (changed: FilmStepName[], data: FilmProject): FilmStepName[] => builtOnIn(dependsOn, changed, data)

export const FILMS_DIR = 'films'

// The same idea as lib/project.ts's ProjectStore - named steps cached in project.json, inputs fingerprinted - for the
// film pipeline's own steps. A separate class so the music-video pipeline stays untouched.
export class FilmStore {
    readonly dir: string
    readonly file: string
    data: FilmProject = {}
    // the steps generated in this run (not taken from project.json) - what --review asks about
    readonly generated = new Set<FilmStepName>()

    constructor(readonly id: string) {
        this.dir = join(FILMS_DIR, id)
        this.file = join(this.dir, 'project.json')
    }

    input(name: string) {
        return join(this.dir, 'input', name)
    }

    async load() {
        if (!existsSync(this.file)) return
        try {
            this.data = await Bun.file(this.file).json()
        } catch (e) {
            throw new Error(`${this.file} is not valid JSON (${e instanceof Error ? e.message : String(e)}) - fix it by hand, or delete it to start over (every step is generated again)`)
        }
        if (!this.data || typeof this.data !== 'object' || Array.isArray(this.data)) throw new Error(`${this.file} must be a JSON object - fix it by hand, or delete it to start over (every step is generated again)`)
        for (const name of FILM_STEP_NAMES) {
            if (this.data[name] === undefined) continue
            const problem = filmStepProblem(name, this.data[name])
            if (problem) throw new Error(`${this.file}: cached ${name} is invalid (${problem}) - fix this value by hand, or delete it and rerun with --redo=${name}`)
        }
    }

    // written next to the target first, so a crash mid-write never leaves a truncated project.json
    async save() {
        await Bun.write(partialOf(this.file), JSON.stringify(this.data, null, 2))
        replaceWithPartial(this.file)
    }

    invalidate(name: FilmStepName) {
        if (this.data[name] !== undefined) log.step('Redo', styles.name(name))
        delete this.data[name]
        dropPartials(this.data, name)
        for (const [step, deps] of Object.entries(dependsOn) as [FilmStepName, FilmStepName[]][]) {
            if (deps.includes(name) && this.data[step] !== undefined) this.invalidate(step)
        }
    }

    /** The inputs that changed since the last run, with the steps each redoes - read only (--dry-run, bun run status --film). */
    changedInputs(inputs: Record<string, FilmInput>): { name: string, steps: FilmStepName[] }[] {
        const previous = this.data.inputs ?? {}
        return Object.entries(inputs).flatMap(([name, {value, steps}]) => {
            const current = Bun.hash(value).toString(16)
            return (previous[name] ?? current) !== current ? [{name, steps}] : []
        })
    }

    /** The steps with a result that invalidating these would remove - what invalidate() does, without doing it. */
    redoneBy(names: FilmStepName[]): FilmStepName[] {
        const redone = new Set<FilmStepName>()
        const visit = (name: FilmStepName) => {
            if (this.data[name] !== undefined) redone.add(name)
            for (const [step, deps] of Object.entries(dependsOn) as [FilmStepName, FilmStepName[]][]) {
                if (deps.includes(name) && this.data[step] !== undefined && !redone.has(step)) visit(step)
            }
        }
        for (const name of names) visit(name)
        return FILM_STEP_NAMES.filter(step => redone.has(step))
    }

    /** Redoes the steps built on an input that changed since the last run - every input is fingerprinted in project.json. */
    async syncInputs(inputs: Record<string, FilmInput>) {
        const previous = this.data.inputs ?? {}
        for (const {name, steps} of this.changedInputs(inputs)) {
            log.step('Changed', `${styles.name(name)} ${styles.muted(`- redoing ${steps.join(', ')}`)}`)
            for (const step of steps) this.invalidate(step)
        }
        const current = Object.fromEntries(Object.entries(inputs).map(([name, {value}]) => [name, Bun.hash(value).toString(16)]))
        if (JSON.stringify(current) !== JSON.stringify(previous)) {
            this.data.inputs = current
            await this.save()
        }
    }

    /** Notes an input as it is now - for a file the run itself wrote (the picked style), which must not count as an edit next time. */
    async recordInput(name: string, value: string) {
        this.data.inputs = {...this.data.inputs, [name]: Bun.hash(value).toString(16)}
        await this.save()
    }

    // Runs a step unless its result is already in project.json
    async step<K extends FilmStepName>(name: K, title: string, run: () => Promise<NonNullable<FilmProject[K]>>): Promise<NonNullable<FilmProject[K]>> {
        log.section(title)
        const cached = this.data[name]
        if (cached !== undefined) {
            log.step('Cached', styles.muted(`from ${this.file} - use --redo=${name} to regenerate`))
            return cached as NonNullable<FilmProject[K]>
        }
        const result = await run()
        this.data[name] = result
        this.generated.add(name)
        dropPartials(this.data, name)
        await this.save()
        return result
    }

    /** One element of a step that asks per element: its answer is kept at once and not asked again for the same input (lib/partials.ts). */
    each<T>(name: FilmStepName, key: string, input: unknown, run: () => Promise<T>): Promise<T> {
        return keepEach(this.data, () => this.save(), name, key, input, run)
    }
}
