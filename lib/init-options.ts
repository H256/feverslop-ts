import {existsSync, statSync} from 'node:fs'
import {parseArgs} from 'node:util'
import {languageName, type ProjectConfig} from './config.ts'
import {projectExists, type ProjectSeed, validProjectId} from './project-setup.ts'

// A music-video project made by options instead of questions (#827): for a script, and for the workspace, which starts commands
// with no terminal to ask in. The wizard of tools/init.ts stays for a person at a terminal; both write through writeProject.

export const INIT_USAGE =
    'usage: bun run init [project-id]   (asks the rest)\n' +
    '       bun run init <project-id> --song=<file> | --idea=<text|file> | --library-song=<song-id> [--lyrics=<text|file>] [--story-idea=<text|file>] [--style=<text|file>] [--music-style=<text|file>] [--singers=auto|<name>,<name>] [--language=en]   (asks nothing)'

/** The options that make init ask nothing: with one of them given, every answer comes from the command line. */
const OPTIONS = ['song', 'idea', 'library-song', 'lyrics', 'story-idea', 'style', 'music-style', 'singers', 'language'] as const

// librarySong: a song of the library (lib/song-library.ts) - its audio, lyrics, stems and timing are taken over by tools/init.ts (#835)
export type InitOptions = {id: string; seed: ProjectSeed; librarySong?: string}

/** A value that names a file is the file's text, anything else is the text itself. */
async function textOf(value: string | undefined): Promise<string | undefined> {
    if (value === undefined) return undefined
    const text = existsSync(value) && statSync(value).isFile() ? await Bun.file(value).text() : value
    return text.trim() || undefined
}

/**
 * What the command line asks a new project to be, or undefined when it has none of the options - then the wizard asks.
 * Throws with what is missing or wrong, in the words of the usage.
 */
export async function initOptions(argv: string[]): Promise<InitOptions | undefined> {
    const {values, positionals} = parseArgs({
        args: argv,
        allowPositionals: true,
        options: Object.fromEntries(OPTIONS.map(name => [name, {type: 'string' as const}])),
    })
    const given = values as Partial<Record<(typeof OPTIONS)[number], string>>
    if (!OPTIONS.some(name => given[name] !== undefined)) return undefined

    const [id, ...more] = positionals
    if (!id) throw new Error('the project id comes first: bun run init <project-id> --song=… | --idea=…')
    if (more.length) throw new Error(`one project id, got ${positionals.join(', ')}`)
    if (!validProjectId(id)) throw new Error(`"${id}" is not a project id - lowercase letters, digits and "-" only`)
    if (projectExists(id)) throw new Error(`projects/${id}/ is there already - another id, or change that project`)

    if (given.song !== undefined && (!existsSync(given.song) || !statSync(given.song).isFile())) throw new Error(`--song: no file ${given.song}`)
    if (given.song !== undefined && !/\.(wav|mp3|flac)$/i.test(given.song)) throw new Error(`--song: a .wav, .mp3 or .flac file, got ${given.song}`)
    const [idea, lyrics, storyIdea, style, musicStyle] = await Promise.all([
        textOf(given.idea),
        textOf(given.lyrics),
        textOf(given['story-idea']),
        textOf(given.style),
        textOf(given['music-style']),
    ])
    if (given.song && idea) throw new Error('--song and --idea: a song you have, or an idea to make one from - not both')
    // a song of the library brings its lyrics and their timing: the story is planned from them
    const librarySong = given['library-song']?.trim()
    if (librarySong !== undefined) {
        if (given.song || idea) throw new Error('--library-song is the song: no --song or --idea with it')
        if (lyrics) throw new Error('--library-song brings its own lyrics - no --lyrics with it')
        if (!/^[a-z0-9][a-z0-9-]*$/.test(librarySong)) throw new Error(`--library-song: a song id of the library, got "${librarySong}"`)
        const singers = given.singers
            ?.split(',')
            .map(name => name.trim())
            .filter(Boolean)
        const config: Partial<ProjectConfig> = {...(singers?.length ? {singers} : {}), ...(given.language ? {lyricsLanguage: given.language} : {})}
        return {id, seed: {storyIdea, style, config}, librarySong}
    }
    // a song needs words to plan a story from; an idea writes its own lyrics
    if (!idea && !lyrics && !storyIdea)
        throw new Error(
            given.song
                ? '--song needs --lyrics and/or --story-idea: the story is planned from them'
                : 'a song (--song with --lyrics and/or --story-idea), or an idea to make one from (--idea)',
        )
    const singers = given.singers
        ?.split(',')
        .map(name => name.trim())
        .filter(Boolean)
    if (singers?.length && !lyrics && !idea) throw new Error('--singers needs sung lines: --lyrics, or --idea to write them')
    if (given.language !== undefined && !languageName(given.language)) throw new Error(`--language: a language code like "en" or "de", got "${given.language}"`)
    const config: Partial<ProjectConfig> = {
        ...(singers?.length ? {singers} : {}),
        ...(given.language ? {lyricsLanguage: given.language} : {}),
    }
    return {id, seed: {songFile: given.song, idea, lyrics, storyIdea, style, musicStyle, config}}
}
