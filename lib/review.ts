import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import * as clack from "@clack/prompts";
import {log, styles} from "./log.ts";

// --review: a step everything later is built on (the story, the cast, the look, the beats - a film's screenplay, cast and
// look) is shown when it was just generated, and the run waits - accept it, edit it in $EDITOR, generate it again, or stop.
// A weak story is cheaper to catch here than after the looks and dozens of shot planner calls built on it. Cached steps
// are not asked about.

// what review needs of a project's store - the music video's ProjectStore and the film's FilmStore
type Store<D, K extends keyof D> = { readonly file: string, data: D, readonly generated: ReadonlySet<K>, invalidate(name: K): void, save(): Promise<void> }

/**
 * Runs the step (`run` is the project.step call) and prints it (`show`); with review on and a freshly generated result,
 * asks what to do with it and returns the result that was accepted.
 */
export async function reviewed<D, S extends keyof D & string, K extends S>(project: Store<D, S>, review: boolean, name: K, run: () => Promise<NonNullable<D[K]>>, show: (value: NonNullable<D[K]>) => void): Promise<NonNullable<D[K]>> {
    let value = await run()
    show(value)
    if (!review || !project.generated.has(name)) return value
    for (;;) {
        const choice = await clack.select({
            message: `${name}: generated just now - go on with it?`,
            options: [
                {value: 'accept', label: 'accept', hint: 'go on with it'},
                {value: 'edit', label: 'edit', hint: `open it in ${editorCommand()}`},
                {value: 'again', label: 'generate again'},
                {value: 'stop', label: 'stop', hint: 'it stays saved - run again to go on'},
            ],
        })
        if (clack.isCancel(choice) || choice === 'stop') {
            log.step('Stopped', styles.muted(`${name} is saved in ${project.file} - the next run goes on from it (--redo=${name} --review to look at it again)`))
            process.exit(0)
        }
        if (choice === 'accept') return value
        if (choice === 'again') {
            project.invalidate(name)
            value = await run()
        } else {
            const edited = await editValue(name, value)
            if (edited === undefined) continue
            value = edited
            project.data[name] = value
            await project.save()
        }
        show(value)
    }
}

const editorCommand = () => process.env.VISUAL || process.env.EDITOR || 'vi'

/** Opens the value in the editor: text as text, everything else as JSON - read back and checked; undefined when unchanged or broken. */
async function editValue<V>(name: string, value: V): Promise<V | undefined> {
    const dir = mkdtempSync(join(tmpdir(), 'feverslop-review-'))
    const asText = typeof value === 'string'
    const file = join(dir, `${name}.${asText ? 'txt' : 'json'}`)
    try {
        const before = asText ? value as string : JSON.stringify(value, null, 2)
        await Bun.write(file, before + '\n')
        // through the shell, so an editor with arguments ("code -w") works as it is set
        const editor = Bun.spawn(['sh', '-c', `${editorCommand()} "$1"`, 'sh', file], {stdio: ['inherit', 'inherit', 'inherit']})
        if (await editor.exited !== 0) {
            log.warn(`${editorCommand()} ended with code ${editor.exitCode} - ${name} stays as it was`)
            return undefined
        }
        const after = (await Bun.file(file).text()).trim()
        if (after === before.trim()) {
            log.step('Unchanged', styles.muted(name))
            return undefined
        }
        if (asText) return after as V
        const parsed = checkShape(value, after)
        if (typeof parsed === 'string') {
            log.warn(`${name}: ${parsed} - ${name} stays as it was`)
            return undefined
        }
        return parsed as V
    } finally {
        rmSync(dir, {recursive: true, force: true})
    }
}

/** The edited JSON, if it is still the same kind of thing (a list stays a list, an object keeps its fields) - else what is wrong. */
export function checkShape(before: unknown, text: string): unknown {
    let parsed: unknown
    try {
        parsed = JSON.parse(text)
    } catch (e) {
        return `not valid JSON (${e instanceof Error ? e.message : e})`
    }
    if (Array.isArray(before)) return Array.isArray(parsed) && parsed.length ? parsed : 'must stay a list with at least one entry'
    if (before && typeof before === 'object') {
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'must stay an object'
        const missing = Object.keys(before).filter(key => !(key in parsed!))
        return missing.length ? `the field(s) ${missing.join(', ')} are missing` : parsed
    }
    return parsed
}
