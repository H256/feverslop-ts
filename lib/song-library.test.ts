import {afterAll, beforeAll, expect, test} from 'bun:test'
import {existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {loadProjectConfig} from './config.ts'
import {projectInputs} from './inputs.ts'
import {fingerprintOf, type Project, ProjectStore} from './project.ts'
import {exportSong, importSong, librarySongIds, readLibrarySong, songsLike} from './song-library.ts'

// ProjectStore works in projects/<id> of the working directory: the test runs in a folder of its own
const root = mkdtempSync(join(tmpdir(), 'song-library-'))
const cwd = process.cwd()
const library = join(root, 'library')
beforeAll(() => process.chdir(root))
afterAll(() => {
    process.chdir(cwd)
    rmSync(root, {recursive: true, force: true})
})

const LYRICS = '[Chorus]\nEPA streikt\nUnd ich dreh mich im Kreis\n'
const timing = {
    lines: [
        {
            line: 0,
            sectionIndex: 0,
            section: 'Chorus',
            text: 'EPA streikt',
            start: 71,
            end: 72,
            words: [
                {text: 'EPA', start: 71, end: 71.5},
                {text: 'streikt', start: 71.5, end: 72},
            ],
            confidence: 1,
            byHand: true,
        },
        {line: 1, sectionIndex: 0, section: 'Chorus', text: 'Und ich dreh mich im Kreis', start: 72.5, end: 75, words: [], confidence: 0},
    ],
}
const music = {bpm: 120, durationSec: 90, downbeats: [], sections: [{label: 'Chorus', start: 0, end: 90, energy: 1}]}

/** A project with input files, stems on disk and, with `planned`, the song's steps and a story on top, as a plan run leaves them. */
function project(id: string, opts: {song?: string; lyrics?: string; planned?: boolean} = {}) {
    const dir = join('projects', id)
    mkdirSync(join(dir, 'input'), {recursive: true})
    mkdirSync(join(dir, 'stems'), {recursive: true})
    if (opts.song !== undefined) writeFileSync(join(dir, 'input', 'song.wav'), opts.song)
    if (opts.lyrics !== undefined) writeFileSync(join(dir, 'input', 'lyrics.txt'), opts.lyrics)
    if (!opts.planned) return dir
    const names = ['vocals', 'drums', 'bass', 'other', 'guitar', 'piano']
    for (const name of names) writeFileSync(join(dir, 'stems', `${name}.wav`), `${id} ${name}`)
    const data: Project = {
        inputs: {'song.wav': fingerprintOf(opts.song!), 'lyrics.txt': fingerprintOf(opts.lyrics!.trim())},
        music: music as unknown as Project['music'],
        stems: Object.fromEntries(names.map(n => [n, `stems/${n}.wav`])) as Project['stems'],
        transcript: {words: []},
        lyricsTiming: timing,
        story: 'a story' as unknown as Project['story'],
    }
    writeFileSync(join(dir, 'project.json'), JSON.stringify(data))
    return dir
}

test('a song goes into the library with its stems and timing, and never over one that is there', async () => {
    const dir = project('first', {song: 'AUDIO', lyrics: LYRICS, planned: true})
    const data = await Bun.file(join(dir, 'project.json')).json()
    const {song, copied} = await exportSong(library, dir, data, {id: 'epa', name: 'EPA streikt', lyricsLanguage: 'de', source: 'first'})
    expect(copied).toBe(8)
    expect(librarySongIds(library)).toEqual(['epa'])
    expect(readdirSync(join(library, 'songs', 'epa', 'stems')).sort()).toEqual(['bass.wav', 'drums.wav', 'guitar.wav', 'other.wav', 'piano.wav', 'vocals.wav'])
    expect((await readLibrarySong(library, 'epa'))!.lyricsTiming.lines[0]!.byHand).toBe(true)
    expect(song.fingerprints).toEqual({song: fingerprintOf('AUDIO'), lyrics: fingerprintOf(LYRICS.trim())})
    expect(exportSong(library, dir, data, {id: 'epa', name: 'again', lyricsLanguage: 'de'})).rejects.toThrow('never overwritten')
})

test('a song whose lyrics changed since they were timed does not go in', async () => {
    const dir = project('changed', {song: 'AUDIO', lyrics: LYRICS, planned: true})
    writeFileSync(join(dir, 'input', 'lyrics.txt'), 'other words')
    const data = await Bun.file(join(dir, 'project.json')).json()
    expect(exportSong(library, dir, data, {id: 'changed', name: 'x', lyricsLanguage: 'de'})).rejects.toThrow('changed since the lyrics were timed')
})

test('a new project takes the song: files, steps and fingerprints - the next run redoes nothing of the song', async () => {
    const dir = project('fresh')
    const store = new ProjectStore('fresh')
    const config = await loadProjectConfig(dir)
    const {putAway, redone, settings} = await importSong(library, (await readLibrarySong(library, 'epa'))!, store, config)
    expect([putAway, redone]).toEqual([[], []])
    // the language the song was transcribed in, and the timing on: else the next run would redo the transcript and the timing
    expect(settings).toEqual(['"lyricsLanguage": "de"', '"alignLyrics": true'])
    expect(await Bun.file(join(dir, 'config.json')).json()).toEqual({lyricsLanguage: 'de', alignLyrics: true})
    expect(existsSync(join(dir, 'input', 'song.wav'))).toBe(true)
    expect(await Bun.file(join(dir, 'stems', 'guitar.wav')).text()).toBe('first guitar')
    const data: Project = await Bun.file(join(dir, 'project.json')).json()
    expect(data.lyricsTiming).toEqual(timing)
    expect(data.music).toEqual(music as unknown as Project['music'])
    // as a plan run would see it: no input changed
    const again = new ProjectStore('fresh')
    await again.load()
    expect(again.changedInputs(await projectInputs(dir, await loadProjectConfig(dir)))).toEqual([])
})

test('a project with another song puts its files away, and what was planned on them goes', async () => {
    const dir = project('other', {song: 'OTHER AUDIO', lyrics: 'other lyrics', planned: true})
    const store = new ProjectStore('other')
    const {putAway, redone} = await importSong(library, (await readLibrarySong(library, 'epa'))!, store, await loadProjectConfig(dir))
    expect(putAway.map(f => f.split(/[\\/]/).at(-1)).sort()).toEqual(['lyrics.txt', 'song.wav'])
    expect(redone).toContain('story')
    expect(await Bun.file(join(dir, 'input', 'lyrics.txt')).text()).toBe(LYRICS)
    const data: Project = await Bun.file(join(dir, 'project.json')).json()
    expect(data.story).toBeUndefined()
    expect(data.lyricsTiming).toEqual(timing)
})

test('a project of the same audio and lyrics finds the song in the library', async () => {
    const dir = project('same', {song: 'AUDIO', lyrics: LYRICS + '\n'})
    expect((await songsLike(library, join(dir, 'input', 'song.wav'), LYRICS + '\n')).map(s => s.id)).toEqual(['epa'])
    expect(await songsLike(library, join(dir, 'input', 'song.wav'), 'other')).toEqual([])
})
