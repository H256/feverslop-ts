// casting.json: who plays each role and which picture each place has - the project's own (made as always) or one of the
// asset library (lib/library.ts), copied into the project. The pipeline writes the file once after the cast step, every
// entry "project:<id>", and never again: from then on it is the user's, and only read.
//   {"characters": {"kael": "library:kael-red"}, "locations": {"stage": "project:stage"}}
// A library asset is copied once (pinned, renamed to the role's id); project.json remembers which version, so the next
// runs do nothing while entry and files match. A "library:" entry the library does not have stops the run before
// anything is made - a typo never generates a picture.

import {existsSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {type AssetKind, assetPaths, copyAsset} from "./asset-import.ts";
import {type LibraryAsset, libraryFolder, libraryLayout, libraryRef} from "./library.ts";
import type {Character, Location} from "./project.ts";

export const CASTING_FILE = 'casting.json'
export type CastingFile = { characters?: Record<string, string>, locations?: Record<string, string> }
type Cast = { characters: Pick<Character, 'id' | 'name' | 'isGroup'>[], locations: Pick<Location, 'id' | 'name'>[] }

/** A role or place played by a library asset. */
export type CastEntry = { kind: AssetKind, id: string, libraryId: string }
/** What a copy was made from - kept in project.json, so the same copy is not made again. */
export type CastingCopies = Record<string, { library: string, fingerprint: string }>
export const copyKey = (kind: AssetKind, id: string) => `${kind}:${id}`

/** Every character and place of the cast as "project:<id>" - what the file starts as. */
export const defaultCasting = (cast: Cast): CastingFile => ({
    characters: Object.fromEntries(cast.characters.map(c => [c.id, `project:${c.id}`])),
    locations: Object.fromEntries(cast.locations.map(l => [l.id, `project:${l.id}`])),
})

/** Writes casting.json when there is none - true when it did. An existing one is never touched. */
export function writeCastingOnce(projectDir: string, cast: Cast): boolean {
    const file = join(projectDir, CASTING_FILE)
    if (existsSync(file)) return false
    writeFileSync(file, JSON.stringify(defaultCasting(cast), null, 2) + '\n')
    return true
}

export function readCastingFile(projectDir: string): CastingFile {
    const file = join(projectDir, CASTING_FILE)
    if (!existsSync(file)) return {}
    try {
        return JSON.parse(readFileSync(file, 'utf8')) as CastingFile
    } catch (e) {
        throw new Error(`${file} is not valid JSON (${(e as Error).message}) - fix it, or delete it: the next run writes it again with every entry "project:"`)
    }
}

/**
 * The entries read against the cast and the library. errors: what stops the run (an entry that is neither "project:"
 * nor "library:", a library asset that does not exist); warnings: what runs on as it is (an entry for nobody of the cast,
 * a group as a library asset, characters and places without an entry - they run as "project:").
 */
export function resolveCasting(file: CastingFile, cast: Cast, libraryHas: (kind: AssetKind, id: string) => boolean): { entries: CastEntry[], errors: string[], warnings: string[] } {
    const entries: CastEntry[] = []
    const errors: string[] = []
    const warnings: string[] = []
    const sections: [AssetKind, Record<string, string> | undefined, { id: string, name: string, isGroup?: boolean }[]][] = [
        ['character', file.characters, cast.characters],
        ['location', file.locations, cast.locations],
    ]
    for (const [kind, section, members] of sections) {
        const unlisted: string[] = []
        for (const member of members) if (section?.[member.id] === undefined) unlisted.push(member.id)
        if (unlisted.length) warnings.push(`${kind}s without an entry in ${CASTING_FILE} run as "project:": ${unlisted.join(', ')}`)
        for (const [id, value] of Object.entries(section ?? {})) {
            const member = members.find(m => m.id === id)
            if (!member) {
                warnings.push(`${CASTING_FILE}: "${id}" is no ${kind} of the cast (${members.map(m => m.id).join(', ')}) - check the entry`)
                continue
            }
            const text = typeof value === 'string' ? value.trim() : ''
            if (text.startsWith('project:')) continue
            const libraryId = libraryRef(text)
            if (libraryId === undefined) {
                errors.push(`${CASTING_FILE}: ${kind} "${id}" is ${JSON.stringify(value)} - write "project:${id}" or "library:<id>"`)
                continue
            }
            if (!libraryHas(kind, libraryId)) {
                errors.push(`${CASTING_FILE}: ${kind} "${id}" is "library:${libraryId}", but the library has no ${kind} "${libraryId}" (${libraryFolder(kind, libraryId)})`)
                continue
            }
            if (member.isGroup) {
                warnings.push(`${CASTING_FILE}: "${id}" is a group - a group is made by the project, "library:${libraryId}" is not used`)
                continue
            }
            entries.push({kind, id, libraryId})
        }
    }
    return {entries, errors, warnings}
}

/** What a library asset is now: its record and its picture - another fingerprint means another version to copy. */
export function libraryFingerprint(library: string, kind: AssetKind, libraryId: string): string {
    const folder = join(library, libraryFolder(kind, libraryId))
    const parts = ['asset.json', 'picture.png', 'sheet/anchor.png'].map(f => existsSync(join(folder, f)) ? Bun.hash(readFileSync(join(folder, f))).toString(16) : '-')
    return parts.join('.')
}

/**
 * Copies every library entry that is not in the project yet, or in another version - the project's own pictures of it
 * go to old/attempts first. Returns the entries copied now and the new record of all copies.
 */
export function copyCasting(projectDir: string, library: string, entries: CastEntry[], copies: CastingCopies = {}): { copied: CastEntry[], copies: CastingCopies } {
    const next: CastingCopies = {}
    const copied: CastEntry[] = []
    for (const entry of entries) {
        const key = copyKey(entry.kind, entry.id)
        const fingerprint = libraryFingerprint(library, entry.kind, entry.libraryId)
        const was = copies[key]
        const there = existsSync(join(projectDir, assetPaths(entry.kind, entry.id).picture))
        if (!(was && was.library === entry.libraryId && was.fingerprint === fingerprint && there)) {
            copyAsset({dir: library, layout: libraryLayout(entry.kind, entry.libraryId), label: `library:${entry.libraryId}`}, {dir: projectDir, layout: assetPaths(entry.kind, entry.id), archiveName: entry.id})
            copied.push(entry)
        }
        next[key] = {library: entry.libraryId, fingerprint}
    }
    return {copied, copies: next}
}

/** Copies the record has that casting.json no longer asks for - the role went back to "project:" (or left the cast). */
export const droppedCopies = (copies: CastingCopies, entries: CastEntry[]) =>
    Object.keys(copies).filter(key => !entries.some(e => copyKey(e.kind, e.id) === key))

/** A library asset's texts for the steps that would otherwise write them: look, description, background, floor plan. */
export const libraryTexts = (asset: LibraryAsset) => ({
    description: asset.description,
    ...(asset.anchors ? {anchors: asset.anchors} : {}),
    ...(asset.layout ? {layout: asset.layout} : {}),
})
