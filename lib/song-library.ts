// Songs in the library: a song with its lyrics and all that is worked out from those two alone - the analysis (music), the
// six separated stems, what the transcription heard, and when each word is sung (lyricsTiming, with every line placed by
// hand). A project that takes one starts at the story: nothing of the song is done again, and a timing fixed once is fixed
// for every video made to the song - another style, another story, the same timing.
//   library/songs/<id>/song.json                 name, where it came from, the fingerprints of audio and lyrics, the language,
//                                                music, stems, transcript, lyricsTiming
//   library/songs/<id>/song.<wav|mp3|flac>        the audio, lyrics.txt the lyrics, stems/<name>.wav the stems
// A project always gets a copy: changing its timing changes no other project and not the library - put it in again as a
// song of another id. A song in the library is never overwritten.

import {copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync} from 'node:fs'
import {basename, extname, join} from 'node:path'
import type {ProjectConfig} from './config.ts'
import {projectInputs, songFileOf} from './inputs.ts'
import {writeJsonFile} from './json-file.ts'
import {fingerprintOf, type Project, ProjectStore, STEP_NAMES, type StepName, type Stems} from './project.ts'

/** The steps that are the song's own - built on nothing but the audio, the lyrics and their language. */
export const SONG_STEPS = ['music', 'stems', 'transcript', 'lyricsTiming'] as const satisfies readonly StepName[]

export type LibrarySong = {
    id: string
    name: string
    created?: string
    // where it came from: the project it was put in from
    source?: string
    // of the audio and of the lyrics (trimmed), as project.json keeps them in "inputs": a project with the same song finds it
    fingerprints: {song: string; lyrics: string}
    lyricsLanguage: string
    // the audio, relative to the song's folder
    songFile: string
    music: NonNullable<Project['music']>
    // relative to the song's folder, as in a project: stems/<name>.wav
    stems: Stems
    transcript: NonNullable<Project['transcript']>
    lyricsTiming: NonNullable<Project['lyricsTiming']>
}

export const songFolder = (id: string) => join('songs', id)

/** The ids of the songs in the library, sorted. */
export function librarySongIds(library: string): string[] {
    const folder = join(library, 'songs')
    if (!existsSync(folder)) return []
    return readdirSync(folder)
        .filter(id => existsSync(join(folder, id, 'song.json')))
        .sort()
}

export async function readLibrarySong(library: string, id: string): Promise<LibrarySong | undefined> {
    const file = join(library, songFolder(id), 'song.json')
    if (!existsSync(file)) return undefined
    return {...((await Bun.file(file).json()) as LibrarySong), id}
}

/** The fingerprints of a song file and its lyrics - the way project.json keeps them (lib/inputs.ts trims the lyrics). */
export async function songFingerprints(songFile: string, lyrics: string) {
    return {song: fingerprintOf(await Bun.file(songFile).bytes()), lyrics: fingerprintOf(lyrics.trim())}
}

/** The library songs with this audio and these lyrics - what a new project of the same song can take. */
export async function songsLike(library: string, songFile: string, lyrics: string): Promise<LibrarySong[]> {
    const ids = librarySongIds(library)
    if (!ids.length || !existsSync(songFile)) return []
    const prints = await songFingerprints(songFile, lyrics)
    const songs = await Promise.all(ids.map(id => readLibrarySong(library, id)))
    return songs.filter((s): s is LibrarySong => !!s && s.fingerprints.song === prints.song && s.fingerprints.lyrics === prints.lyrics)
}

/** Why a project's song cannot go into the library yet - undefined when it can. */
export function songNotReady(dir: string, data: Project): string | undefined {
    const missing = SONG_STEPS.filter(step => data[step] === undefined)
    if (missing.length)
        return `the song is not worked out yet (${missing.join(', ')}) - plan it first, at least up to the story: bun index.ts ${basename(dir)} --until=story`
    const gone = Object.values(data.stems!).filter(file => !existsSync(join(dir, file)))
    if (gone.length) return `stems are gone: ${gone.join(', ')} - separate them again: bun index.ts ${basename(dir)} --redo=stems`
}

/**
 * Puts a project's song into the library as `id`: the audio, the lyrics, the stems (also guitar and piano of an older project's
 * own step), and the steps worked out from them. Throws when the id is taken, or when the song or the lyrics changed since the
 * steps were made - the timing would belong to another song.
 */
export async function exportSong(
    library: string,
    dir: string,
    data: Project,
    opts: {id: string; name: string; lyricsLanguage: string; source?: string},
): Promise<{song: LibrarySong; copied: number}> {
    const notReady = songNotReady(dir, data)
    if (notReady) throw new Error(notReady)
    const folder = join(library, songFolder(opts.id))
    if (existsSync(join(folder, 'song.json'))) throw new Error(`the library already has a song "${opts.id}" (${folder}) - it is never overwritten`)
    const songFile = songFileOf(dir)
    const lyricsFile = join(dir, 'input', 'lyrics.txt')
    const lyrics = existsSync(lyricsFile) ? await Bun.file(lyricsFile).text() : ''
    const fingerprints = await songFingerprints(songFile, lyrics)
    const inputs = data.inputs ?? {}
    if (inputs['song.wav'] && inputs['song.wav'] !== fingerprints.song)
        throw new Error(`${songFile} changed since the song was analysed - plan it again first: bun index.ts ${basename(dir)}`)
    if (inputs['lyrics.txt'] && inputs['lyrics.txt'] !== fingerprints.lyrics)
        throw new Error(`${lyricsFile} changed since the lyrics were timed - plan it again first: bun index.ts ${basename(dir)}`)

    // a project separated before every song got six stems keeps guitar and piano in a step of its own
    const stems: Stems = {
        ...data.stems!,
        ...Object.fromEntries(
            Object.entries(data.instrumentStems ?? {}).filter(([name, file]) => !data.stems![name as keyof Stems] && existsSync(join(dir, file!))),
        ),
    }
    mkdirSync(join(folder, 'stems'), {recursive: true})
    const songName = `song${extname(songFile).toLowerCase()}`
    copyFileSync(songFile, join(folder, songName))
    copyFileSync(lyricsFile, join(folder, 'lyrics.txt'))
    const kept: Stems = {...stems}
    for (const [name, file] of Object.entries(stems)) {
        const target = `stems/${name}.wav`
        copyFileSync(join(dir, file!), join(folder, target))
        kept[name as keyof Stems] = target
    }
    const song: LibrarySong = {
        id: opts.id,
        name: opts.name,
        created: new Date().toISOString().slice(0, 10),
        ...(opts.source ? {source: opts.source} : {}),
        fingerprints,
        lyricsLanguage: opts.lyricsLanguage,
        songFile: songName,
        music: data.music!,
        stems: kept,
        transcript: data.transcript!,
        lyricsTiming: data.lyricsTiming!,
    }
    writeJsonFile(join(folder, 'song.json'), song)
    return {song, copied: 2 + Object.keys(stems).length}
}

/**
 * Puts a library song into a project's files: input/song.<ext>, input/lyrics.txt, stems/. A song or lyrics file of the
 * project that is not the library's is put away in old/song-<time>/ first, never deleted - the same ones stay. Returns what
 * was put away.
 */
export async function copySongFiles(library: string, song: LibrarySong, dir: string): Promise<string[]> {
    const from = join(library, songFolder(song.id))
    const input = join(dir, 'input')
    mkdirSync(input, {recursive: true})
    const away = join(dir, 'old', `song-${new Date().toISOString().replace(/[:.]/g, '-')}`)
    const putAway: string[] = []
    const park = (file: string) => {
        mkdirSync(away, {recursive: true})
        renameSync(file, join(away, basename(file)))
        putAway.push(join(away, basename(file)))
    }
    for (const ext of ['wav', 'mp3', 'flac']) {
        const file = join(input, `song.${ext}`)
        if (!existsSync(file)) continue
        if (file.endsWith(song.songFile) && fingerprintOf(await Bun.file(file).bytes()) === song.fingerprints.song) continue
        park(file)
    }
    const lyrics = join(input, 'lyrics.txt')
    if (existsSync(lyrics) && fingerprintOf((await Bun.file(lyrics).text()).trim()) !== song.fingerprints.lyrics) park(lyrics)
    if (!existsSync(join(input, song.songFile))) copyFileSync(join(from, song.songFile), join(input, song.songFile))
    if (!existsSync(lyrics)) copyFileSync(join(from, 'lyrics.txt'), lyrics)
    mkdirSync(join(dir, 'stems'), {recursive: true})
    for (const file of Object.values(song.stems)) copyFileSync(join(from, file!), join(dir, file!))
    return putAway
}

/** The song's steps as a project keeps them: the stem paths are the same, relative to the project. */
export const songSteps = (song: LibrarySong): Pick<Project, (typeof SONG_STEPS)[number]> => ({
    music: song.music,
    stems: song.stems,
    transcript: song.transcript,
    lyricsTiming: song.lyricsTiming,
})

/**
 * A library song into a project: its files (copySongFiles), then project.json as a plan run would leave it - a changed audio
 * or lyrics file redoes what is built on it (the story of other lyrics, ...), a song step that is not the library's goes with
 * all that is built on it, and the library's steps take their place. Returns the files put away and the steps that went.
 */
export async function importSong(
    library: string,
    song: LibrarySong,
    store: ProjectStore,
    config: ProjectConfig,
): Promise<{putAway: string[]; redone: StepName[]; settings: string[]}> {
    const putAway = await copySongFiles(library, song, store.dir)
    const settings = songSettings(store.dir, song, config)
    await store.load()
    const before = new Set(STEP_NAMES.filter(step => store.data[step] !== undefined))
    await store.syncInputs(await projectInputs(store.dir, config))
    const steps = songSteps(song)
    for (const step of SONG_STEPS) if (JSON.stringify(store.data[step]) !== JSON.stringify(steps[step])) store.invalidate(step)
    Object.assign(store.data, steps)
    await store.save()
    const redone = STEP_NAMES.filter(step => before.has(step) && store.data[step] === undefined)
    return {putAway, redone, settings}
}

/**
 * The settings the song's steps are made with, into config.json where it does not say otherwise: the language it is sung in
 * (the transcript is in it - another one would redo the transcript and the timing with it) and the timing switched on (what the
 * song is taken for, also when nobody is seen singing). A setting config.json gives is kept. `config` changes with it.
 * Returns what was set.
 */
function songSettings(dir: string, song: LibrarySong, config: ProjectConfig): string[] {
    const file = join(dir, 'config.json')
    const raw: Partial<ProjectConfig> = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
    const set: string[] = []
    if (raw.lyricsLanguage === undefined && config.lyricsLanguage !== song.lyricsLanguage) {
        raw.lyricsLanguage = config.lyricsLanguage = song.lyricsLanguage
        set.push(`"lyricsLanguage": "${song.lyricsLanguage}"`)
    }
    if (raw.alignLyrics === undefined && !config.alignLyrics) {
        raw.alignLyrics = config.alignLyrics = true
        set.push('"alignLyrics": true')
    }
    if (set.length) writeJsonFile(file, raw)
    return set
}
