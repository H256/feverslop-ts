import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {songFileOf} from "./inputs.ts";

describe('songFileOf', () => {
    let dir: string
    const song = (name: string) => join(dir, 'input', name)

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'inputs-test-'))
        mkdirSync(join(dir, 'input'))
    })
    afterEach(() => rmSync(dir, {recursive: true, force: true}))

    test('song.wav when there is no song yet', () => {
        expect(songFileOf(dir)).toBe(song('song.wav'))
    })

    test('a hand-supplied song.mp3 or song.flac', () => {
        writeFileSync(song('song.flac'), '')
        expect(songFileOf(dir)).toBe(song('song.flac'))
        writeFileSync(song('song.mp3'), '')
        expect(songFileOf(dir)).toBe(song('song.mp3'))
    })

    test('song.wav comes first', () => {
        for (const name of ['song.wav', 'song.mp3', 'song.flac']) writeFileSync(song(name), '')
        expect(songFileOf(dir)).toBe(song('song.wav'))
    })
})
