import {existsSync, statSync} from 'node:fs'
import {parseArgs} from 'node:util'
import {languageName} from '../config.ts'
import {validProjectId} from '../project-setup.ts'
import type {FilmConfig} from './config.ts'
import {filmExists, type FilmSeed} from './setup.ts'

// A film made by options instead of questions (#827): for a script and for the workspace, which has no terminal to ask in.
// The wizard of tools/film-init.ts stays for a person at a terminal; both write through writeFilm.

export const FILM_INIT_USAGE =
    'usage: bun run film:init [film-id]   (asks the rest)\n' +
    '       bun run film:init <film-id> --idea=<text|file> | --screenplay=<file|text> [--style=<text|file>] [--length=<seconds>] [--language=<code|auto>]   (asks nothing)'

const OPTIONS = ['idea', 'screenplay', 'style', 'length', 'language'] as const

/** A value that names a file is the file's text, anything else is the text itself. */
async function textOf(value: string | undefined): Promise<string | undefined> {
    if (value === undefined) return undefined
    const text = existsSync(value) && statSync(value).isFile() ? await Bun.file(value).text() : value
    return text.trim() || undefined
}

/** What the command line asks a new film to be, or undefined when it has none of the options - then the wizard asks. Throws with what is wrong. */
export async function filmInitOptions(argv: string[]): Promise<{id: string; seed: FilmSeed} | undefined> {
    const {values, positionals} = parseArgs({
        args: argv,
        allowPositionals: true,
        options: Object.fromEntries(OPTIONS.map(name => [name, {type: 'string' as const}])),
    })
    const given = values as Partial<Record<(typeof OPTIONS)[number], string>>
    if (!OPTIONS.some(name => given[name] !== undefined)) return undefined

    const [id, ...more] = positionals
    if (!id) throw new Error('the film id comes first: bun run film:init <film-id> --idea=… | --screenplay=…')
    if (more.length) throw new Error(`one film id, got ${positionals.join(', ')}`)
    if (!validProjectId(id)) throw new Error(`"${id}" is not a film id - lowercase letters, digits and "-" only`)
    if (filmExists(id)) throw new Error(`films/${id}/ is there already - another id, or change that film`)

    const [idea, screenplay, style] = await Promise.all([textOf(given.idea), textOf(given.screenplay), textOf(given.style)])
    if (idea && screenplay) throw new Error('--idea or --screenplay: a story idea to write the film from, or a screenplay to adopt - not both')
    if (!idea && !screenplay) throw new Error('a story idea (--idea) or a screenplay (--screenplay)')
    const config: Partial<FilmConfig> = {}
    if (given.length !== undefined) {
        const seconds = Number(given.length)
        // -1: as long as the story needs - for an idea; a screenplay is as long as it is unless a length is asked for
        if (!(seconds >= 10 || (seconds === -1 && idea)))
            throw new Error(`--length: at least 10 seconds${idea ? ', or -1 for as long as the story needs' : ''}, got "${given.length}"`)
        config.targetDuration = seconds
    }
    if (given.language !== undefined) {
        if (screenplay) throw new Error('--language goes with --idea: a screenplay keeps the language it is written in')
        if (given.language !== 'auto' && !languageName(given.language))
            throw new Error(`--language: a language code like "en", or "auto", got "${given.language}"`)
        config.dialogueLanguage = given.language
    }
    return {id, seed: {...(idea ? {idea} : {screenplay: screenplay!}), ...(style ? {style} : {}), config}}
}
