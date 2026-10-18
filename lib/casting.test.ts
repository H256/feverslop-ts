import {afterEach, describe, expect, test} from "bun:test";
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {CASTING_FILE, copyCasting, droppedCopies, readCastingFile, resolveCasting, writeCastingOnce} from "./casting.ts";

const dirs: string[] = []
const folder = (files: Record<string, string> = {}) => {
    const dir = mkdtempSync(join(tmpdir(), 'casting-'))
    dirs.push(dir)
    for (const [file, content] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, file)), {recursive: true})
        writeFileSync(join(dir, file), content)
    }
    return dir
}
afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, {recursive: true, force: true})
})

const cast = {
    characters: [{id: 'kael', name: 'Kael'}, {id: 'lyra', name: 'Lyra'}, {id: 'orcs', name: 'Orcs', isGroup: true}],
    locations: [{id: 'stage', name: 'Stage'}],
}
const has = (kind: string, id: string) => (kind === 'character' && id === 'kael-red') || (kind === 'location' && id === 'temple')

describe('casting.json', () => {
    test('written once with every role and place "project:" - never again, whatever is in it', () => {
        const dir = folder()
        expect(writeCastingOnce(dir, cast)).toBe(true)
        expect(readCastingFile(dir)).toEqual({characters: {kael: 'project:kael', lyra: 'project:lyra', orcs: 'project:orcs'}, locations: {stage: 'project:stage'}})
        writeFileSync(join(dir, CASTING_FILE), '{"characters": {"kael": "library:kael-red"}}')
        expect(writeCastingOnce(dir, {...cast, characters: [...cast.characters, {id: 'new', name: 'New'}]})).toBe(false)
        expect(readFileSync(join(dir, CASTING_FILE), 'utf8')).toBe('{"characters": {"kael": "library:kael-red"}}')
    })
    test('library entries are found; project entries and missing ones run as before, the missing ones named', () => {
        const r = resolveCasting({characters: {kael: 'library:kael-red', lyra: 'project:lyra'}, locations: {stage: 'library:temple'}}, cast, has)
        expect(r.entries).toEqual([{kind: 'character', id: 'kael', libraryId: 'kael-red'}, {kind: 'location', id: 'stage', libraryId: 'temple'}])
        expect(r.errors).toEqual([])
        expect(r.warnings).toEqual(['characters without an entry in casting.json run as "project:": orcs'])
    })
    test('a typo or a library asset that does not exist stops the run - it never generates a picture', () => {
        const r = resolveCasting({characters: {kael: 'libary:kael-red', lyra: 'library:nobody'}}, cast, has)
        expect(r.entries).toEqual([])
        expect(r.errors).toEqual([
            'casting.json: character "kael" is "libary:kael-red" - write "project:kael" or "library:<id>"',
            'casting.json: character "lyra" is "library:nobody", but the library has no character "nobody" (characters/nobody)',
        ])
    })
    test('an entry for nobody of the cast and a group as a library asset are warned about, not used', () => {
        const r = resolveCasting({characters: {ghost: 'library:kael-red', orcs: 'library:kael-red', kael: 'project:kael', lyra: 'project:lyra'}, locations: {stage: 'project:stage'}}, cast, has)
        expect(r.entries).toEqual([])
        expect(r.warnings).toEqual([
            'casting.json: "ghost" is no character of the cast (kael, lyra, orcs) - check the entry',
            'casting.json: "orcs" is a group - a group is made by the project, "library:kael-red" is not used',
        ])
    })
})

describe('copyCasting', () => {
    const library = () => folder({
        'characters/kael-red/asset.json': '{"name":"Kael","description":"A man."}',
        'characters/kael-red/picture.png': 'sheet', 'characters/kael-red/sheet/anchor.png': 'anchor',
    })
    const entries = [{kind: 'character' as const, id: 'lyra', libraryId: 'kael-red'}]
    test('copied once; the next run copies nothing while entry and library stay the same', () => {
        const lib = library()
        const project = folder({'assets/characters/lyra.png': 'own'})
        const first = copyCasting(project, lib, entries)
        expect(first.copied).toEqual(entries)
        expect(readFileSync(join(project, 'assets/characters/lyra.png'), 'utf8')).toBe('sheet')
        expect(readdirSync(join(project, 'old/attempts'))).toHaveLength(1)
        const again = copyCasting(project, lib, entries, first.copies)
        expect(again.copied).toEqual([])
        expect(again.copies).toEqual(first.copies)
        expect(readdirSync(join(project, 'old/attempts'))).toHaveLength(1)
    })
    test('another version in the library, or the copy gone from the project, copies again', () => {
        const lib = library()
        const project = folder()
        const first = copyCasting(project, lib, entries)
        writeFileSync(join(lib, 'characters/kael-red/picture.png'), 'new sheet')
        expect(copyCasting(project, lib, entries, first.copies).copied).toEqual(entries)
        expect(readFileSync(join(project, 'assets/characters/lyra.png'), 'utf8')).toBe('new sheet')
        rmSync(join(project, 'assets/characters/lyra.png'))
        const third = copyCasting(project, lib, entries, copyCasting(project, lib, [], {}).copies)
        expect(third.copied).toEqual(entries)
        expect(existsSync(join(project, 'assets/characters/lyra.png'))).toBe(true)
    })
    test('droppedCopies: what the record has and casting.json no longer asks for', () => {
        expect(droppedCopies({'character:lyra': {library: 'kael-red', fingerprint: 'x'}, 'location:stage': {library: 'temple', fingerprint: 'y'}}, [{kind: 'location', id: 'stage', libraryId: 'temple'}])).toEqual(['character:lyra'])
    })
})
