import {existsSync, renameSync} from "node:fs";
import {join} from "node:path";
import {log, styles} from "../log.ts";
import {dropPartials, keepEach} from "../partials.ts";
import type {FilmProject} from "./types.ts";

export type FilmStepName = Exclude<keyof FilmProject, 'inputs' | 'partials' | 'castingCopies'>

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
    coverage: ['screenplay', 'cast', 'lookBrief', 'locationViews'],
    scriptNotes: ['screenplay'],
    scriptFixes: ['screenplay'],
    subtitles: ['screenplay'],
}

export const FILM_STEP_NAMES = Object.keys(dependsOn) as FilmStepName[]

export const FILMS_DIR = 'films'

// The same idea as lib/project.ts's ProjectStore - named steps cached in project.json, inputs fingerprinted - for the
// film pipeline's own steps. A separate class so the music-video pipeline stays untouched.
export class FilmStore {
    readonly dir: string
    readonly file: string
    data: FilmProject = {}

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
    }

    // written next to the target first, so a crash mid-write never leaves a truncated project.json
    async save() {
        // the process id in the name: two runs saving at once never write into the same temporary file
        const partial = `${this.file}.${process.pid}.partial`
        await Bun.write(partial, JSON.stringify(this.data, null, 2))
        renameSync(partial, this.file)
    }

    invalidate(name: FilmStepName) {
        if (this.data[name] !== undefined) log.step('Redo', styles.name(name))
        delete this.data[name]
        dropPartials(this.data, name)
        for (const [step, deps] of Object.entries(dependsOn) as [FilmStepName, FilmStepName[]][]) {
            if (deps.includes(name) && this.data[step] !== undefined) this.invalidate(step)
        }
    }

    /** Redoes the steps built on an input that changed since the last run - every input is fingerprinted in project.json. */
    async syncInputs(inputs: Record<string, { value: string | Uint8Array, steps: FilmStepName[] }>) {
        const previous = this.data.inputs ?? {}
        const current: Record<string, string> = {}
        for (const [name, {value, steps}] of Object.entries(inputs)) {
            current[name] = Bun.hash(value).toString(16)
            const before = previous[name] ?? current[name]
            if (before !== current[name]) {
                log.step('Changed', `${styles.name(name)} ${styles.muted(`- redoing ${steps.join(', ')}`)}`)
                for (const step of steps) this.invalidate(step)
            }
        }
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
        dropPartials(this.data, name)
        await this.save()
        return result
    }

    /** One element of a step that asks per element: its answer is kept at once and not asked again for the same input (lib/partials.ts). */
    each<T>(name: FilmStepName, key: string, input: unknown, run: () => Promise<T>): Promise<T> {
        return keepEach(this.data, () => this.save(), name, key, input, run)
    }
}
