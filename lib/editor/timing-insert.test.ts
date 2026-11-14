import {expect, test} from 'bun:test'
import type {Project} from '../project.ts'
import {applyTiming, writeTiming} from './timing.ts'
import {updateInsertedLyrics} from './timing-lyrics.ts'
import {mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {exportSong} from '../song-library.ts'

const fixture = (): Project => ({
    music: {durationSec: 10} as Project['music'],
    lyricsTiming: {
        lines: [
            {
                line: 0,
                section: 'Outro',
                sectionIndex: 0,
                text: 'sein Herz!',
                start: 2,
                end: 6,
                confidence: 1,
                byHand: true,
                words: [
                    {text: 'sein', start: 2, end: 3},
                    {text: 'Herz!', start: 3, end: 6, anchor: true},
                ],
            },
        ],
    },
    singing: {
        singers: ['a', 'b'],
        lines: [
            {
                line: 0,
                text: 'sein Herz!',
                singers: ['a', 'b'],
                parts: [
                    {from: 0, singers: ['a']},
                    {from: 1, singers: ['b']},
                ],
            },
        ],
    },
})
test('inserts words without moving existing timings or losing singer boundaries', () => {
    const data = fixture(),
        original = structuredClone(data.lyricsTiming!.lines[0]!.words)
    const result = applyTiming(data, {lines: [{line: 0, insert: {at: 0, expected: original, words: [{text: 'und', start: 1, end: 2}]}}]}, [])
    expect(result.changed).toEqual([0])
    expect(data.lyricsTiming!.lines[0]!.text).toBe('und sein Herz!')
    expect(data.lyricsTiming!.lines[0]!.words.slice(1)).toEqual(original)
    expect(data.singing!.lines[0]!.parts).toEqual([
        {from: 0, singers: ['a']},
        {from: 2, singers: ['b']},
    ])
    expect(data.singing!.lines[0]!.text).toBe('und sein Herz!')
})
test('stale and overlapping insertions fail atomically', () => {
    for (const stale of [true, false]) {
        const data = fixture(),
            before = JSON.stringify(data)
        expect(() =>
            applyTiming(
                data,
                {lines: [{line: 0, insert: {at: 0, expected: stale ? [] : data.lyricsTiming!.lines[0]!.words, words: [{text: 'und', start: 1, end: 2.5}]}}]},
                [],
            ),
        ).toThrow()
        expect(JSON.stringify(data)).toBe(before)
    }
})
test('an extended ad-lib becomes a real lyric line; line and singer references follow', () => {
    const data = fixture()
    const original = structuredClone(data.lyricsTiming!)
    const adlib = {...structuredClone(original.lines[0]!), line: 1, adlib: true, text: 'oh', start: 7, end: 8, words: [{text: 'oh', start: 7, end: 8}]}
    original.lines.push(structuredClone(adlib))
    data.lyricsTiming!.lines.push({...adlib, text: 'oh ja', words: [...adlib.words, {text: 'ja', start: 8, end: 9}]})
    const result = updateInsertedLyrics('[Outro]\n[soft]\nsein Herz!\n', original, data, [1])
    expect(result.lyrics).toBe('[Outro]\n[soft]\nsein Herz!\noh ja\n')
    expect(data.lyricsTiming!.lines[1]!.adlib).toBeUndefined()
    expect(data.lyricsTiming!.lines[1]!.line).toBe(1)
    expect(data.inputs?.['lyrics.txt']).toBeDefined()
})
test('promotion before an existing lyric remaps its singer and preserves its words', () => {
    const data = fixture(),
        canonical = structuredClone(data.lyricsTiming!.lines[0]!)
    data.lyricsTiming!.lines.unshift({...canonical, line: 1, adlib: true, text: 'oh', start: 0, end: 1, words: [{text: 'oh', start: 0, end: 1}]})
    const before = structuredClone(data.lyricsTiming!)
    data.lyricsTiming!.lines[0]!.text = 'oh ja'
    const result = updateInsertedLyrics('[Outro]\nsein Herz!\n', before, data, [1])
    expect(result.lyrics).toBe('[Outro]\noh ja\nsein Herz!\n')
    expect(data.lyricsTiming!.lines.find(l => l.text === 'sein Herz!')!.words).toEqual(canonical.words)
    expect(data.singing!.lines[0]!.line).toBe(1)
})
test('inserted lyrics and timing survive the real save and library export', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'timing-insert-'))
    try {
        mkdirSync(join(dir, 'input'))
        const data = fixture()
        data.transcript = {words: []}
        data.stems = {vocals: 'input/song.wav', drums: 'input/song.wav', bass: 'input/song.wav', other: 'input/song.wav'}
        writeFileSync(join(dir, 'input', 'song.wav'), 'test audio')
        writeFileSync(join(dir, 'input', 'lyrics.txt'), '[Outro]\nsein Herz!\n')
        writeFileSync(join(dir, 'project.json'), JSON.stringify(data))
        await writeTiming(
            {dir, id: 'test', kind: 'music'},
            {lines: [{line: 0, insert: {at: 0, expected: data.lyricsTiming!.lines[0]!.words, words: [{text: 'und', start: 1, end: 2}]}}]},
        )
        expect(readFileSync(join(dir, 'input', 'lyrics.txt'), 'utf8')).toBe('[Outro]\nund sein Herz!\n')
        await writeTiming(
            {dir, id: 'test', kind: 'music'},
            {lines: [], add: {afterLine: 0, expectedText: 'und sein Herz!', words: [{text: 'oh', start: 7, end: 8}]}},
        )
        const saved = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')) as Project
        const {song} = await exportSong(join(dir, 'library'), dir, saved, {id: 'test', name: 'test', lyricsLanguage: 'de'})
        expect(song.lyricsTiming.lines[0]!.words.slice(1)).toEqual(data.lyricsTiming!.lines[0]!.words)
        expect(readFileSync(join(dir, 'library', 'songs', 'test', 'lyrics.txt'), 'utf8')).toContain('und sein Herz!')
        expect(song.lyricsTiming.lines[1]).toMatchObject({text: 'oh', start: 7, end: 8})
        expect(readFileSync(join(dir, 'library', 'songs', 'test', 'lyrics.txt'), 'utf8')).toBe('[Outro]\nund sein Herz!\noh\n')
    } finally {
        rmSync(dir, {recursive: true, force: true})
    }
})
test('enabling an ad-lib and saving pending timing edits is one change', () => {
    const data = fixture()
    data.lyricsTiming!.lines[0]!.adlib = true
    data.lyricsTiming!.lines[0]!.off = true
    applyTiming(
        data,
        {
            lines: [
                {
                    line: 0,
                    off: false,
                    words: [
                        {start: 1.8, end: 3},
                        {start: 3, end: 6},
                    ],
                },
            ],
        },
        [],
    )
    expect(data.lyricsTiming!.lines[0]!.off).toBeUndefined()
    expect(data.lyricsTiming!.lines[0]!.words[0]!.start).toBe(1.8)
})
test('a separate sung segment can be added without changing the existing line', () => {
    const data = fixture(),
        original = structuredClone(data.lyricsTiming!.lines[0]!)
    const result = applyTiming(data, {lines: [], add: {afterLine: 0, expectedText: 'sein Herz!', words: [{text: 'oh', start: 7, end: 8}]}}, [])
    expect(result.changed).toEqual([1])
    expect(data.lyricsTiming!.lines[0]).toEqual(original)
    expect(data.lyricsTiming!.lines[1]).toMatchObject({text: 'oh', start: 7, end: 8, byHand: true})
    expect(data.lyricsTiming!.lines[1]!.off).toBeUndefined()
})
