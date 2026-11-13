import {afterAll, beforeAll, describe, expect, test} from 'bun:test'
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {describeEntry, listLibrary, removeEntry, renameEntry} from './library-admin.ts'

// #835: what is in the library and who uses it; an entry renamed, described anew, or put away - never while a project names it.
const here = process.cwd()
let root: string
let library: string
const write = (file: string, value: unknown) => {
    mkdirSync(join(file, '..'), {recursive: true})
    writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value))
}
beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'library-admin-'))
    library = join(root, 'library')
    write(join(library, 'characters', 'kael', 'asset.json'), {kind: 'character', id: 'kael', name: 'Kael', description: 'a tall drummer'})
    write(join(library, 'locations', 'hall', 'asset.json'), {kind: 'location', id: 'hall', name: 'The hall', description: 'a long hall'})
    write(join(library, 'songs', 'rain', 'song.json'), {
        name: 'Rain',
        fingerprints: {song: 'abc', lyrics: 'def'},
        lyricsLanguage: 'en',
        songFile: 'song.wav',
        music: {durationSec: 181.4},
        stems: {vocals: 'stems/vocals.wav', drums: 'stems/drums.wav'},
        transcript: {},
        lyricsTiming: {lines: [{byHand: true}, {}]},
    })
    // a music video casting Kael and made of the song, and one that uses nothing of the library
    write(join(root, 'projects', 'tides', 'casting.json'), {characters: {drummer: 'library:kael'}})
    write(join(root, 'projects', 'tides', 'project.json'), {inputs: {'song.wav': 'abc'}})
    write(join(root, 'projects', 'tides', 'input', 'lyrics.txt'), 'la')
    write(join(root, 'projects', 'other', 'project.json'), {inputs: {'song.wav': 'zzz'}})
    // a prop of the library (#944), taken by tides as the picture of its guitar
    write(join(library, 'props', 'strat', 'asset.json'), {kind: 'prop', id: 'strat', name: 'sunburst Strat', description: 'a sunburst Stratocaster'})
    write(join(root, 'projects', 'tides', 'assets', 'props', 'strat.png.json'), {
        source: 'user',
        pinned: true,
        note: 'copied from library/props/strat/picture.png',
    })
    write(join(root, 'projects', 'other', 'input', 'lyrics.txt'), 'la')
    process.chdir(root)
})
afterAll(() => {
    process.chdir(here)
    rmSync(root, {recursive: true, force: true})
})

describe('the library', () => {
    test('lists the props, with the projects that took their picture (#944)', async () => {
        expect((await listLibrary(library)).props).toEqual([
            {kind: 'prop', id: 'strat', name: 'sunburst Strat', description: 'a sunburst Stratocaster', usedBy: [{kind: 'music', id: 'tides', role: 'strat'}]},
        ])
    })
    test('lists characters, places and songs with the projects that use them', async () => {
        const listing = await listLibrary(library)
        expect(listing.characters).toEqual([
            {kind: 'character', id: 'kael', name: 'Kael', description: 'a tall drummer', usedBy: [{kind: 'music', id: 'tides', role: 'drummer'}]},
        ])
        expect(listing.locations[0]!.usedBy).toEqual([])
        expect(listing.songs).toEqual([
            {id: 'rain', name: 'Rain', seconds: 181.4, stems: 2, lines: 2, byHand: 1, source: undefined, usedBy: [{kind: 'music', id: 'tides'}]},
        ])
    })
    test('renames an entry, its id kept', async () => {
        expect(renameEntry(library, 'song', 'rain', ' Rain, slow ')).toEqual({from: 'Rain', to: 'Rain, slow'})
        expect(JSON.parse(readFileSync(join(library, 'songs', 'rain', 'song.json'), 'utf8')).name).toBe('Rain, slow')
        expect(() => renameEntry(library, 'character', 'nobody', 'X')).toThrow('the library has no character "nobody"')
        expect(() => renameEntry(library, 'character', 'kael', 'two\nlines')).toThrow('one line')
    })
    test('describes a character or place anew', async () => {
        await describeEntry(library, 'location', 'hall', 'a long hall with candles')
        expect((await listLibrary(library)).locations[0]!.description).toBe('a long hall with candles')
    })
    test('puts an entry away into .trash, but not while a project names it', () => {
        expect(() => removeEntry(library, 'character', 'kael')).toThrow('character "kael" is in use - project tides (as drummer)')
        expect(existsSync(join(library, 'characters', 'kael'))).toBe(true)
        const to = removeEntry(library, 'location', 'hall', new Date('2026-11-12T08:00:00Z'))
        expect(to).toBe(join(library, '.trash', 'locations', 'hall-2026-11-12T08-00-00-000Z'))
        expect(existsSync(join(library, 'locations', 'hall'))).toBe(false)
        expect(readdirSync(to)).toEqual(['asset.json'])
    })
})
