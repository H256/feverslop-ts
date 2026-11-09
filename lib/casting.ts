// casting.json: who plays each role and which picture each place has - the project's own (made as always) or one of the
// asset library (lib/library.ts), copied into the project. The pipeline writes the file once after the cast step, every
// entry "project:<id>", and never again: from then on it is the user's, and only read. Only a cast changed by hand
// (castingAfterCastChange) takes the entries of who left out and gives who came "project:<id>".
//   {"characters": {"kael": "library:kael-red"}, "locations": {"stage": "project:stage"}}
// A library asset is copied once (pinned, renamed to the role's id); project.json remembers which version, so the next
// runs do nothing while entry and files match. A "library:" entry the library does not have stops the run before
// anything is made - a typo never generates a picture.

import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {archiveFiles, versionStamp} from './archive.ts'
import {type AssetKind, assetPaths, copyAsset, copyPlan} from './asset-import.ts'
import {type LibraryAsset, libraryFolder, libraryIds, libraryLayout, libraryRef, readLibraryAsset} from './library.ts'
import {log, styles} from './log.ts'

export const CASTING_FILE = 'casting.json'
export type CastingFile = {characters?: Record<string, string>; locations?: Record<string, string>}
// the roles and places of a music video's cast or a film's (its characters that are seen)
type Cast = {characters: {id: string; name: string; isGroup?: boolean}[]; locations: {id: string; name: string}[]}

/** A role or place played by a library asset. */
export type CastEntry = {kind: AssetKind; id: string; libraryId: string}
/** What a copy was made from - kept in project.json, so the same copy is not made again. */
export type CastingCopies = Record<string, {library: string; fingerprint: string}>
export const copyKey = (kind: AssetKind, id: string) => `${kind}:${id}`

/** Applies one library-authored text only when it differs, and reports whether a cached value changed. */
export function applyLibraryText<T>(values: Record<string, T>, id: string, value: T | undefined): boolean {
    if (value === undefined || JSON.stringify(values[id]) === JSON.stringify(value)) return false
    values[id] = value
    return true
}
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

/**
 * casting.json after the cast was changed by hand (the workspace's Casting page, bun run cast --set): the entries of whoever
 * left the cast go - also a "library:" one, the role is gone - and whoever came gets "project:<id>". Every other entry stays as
 * the user wrote it. Undefined when nothing changes.
 */
export function castingAfterCastChange(file: CastingFile, before: Cast, after: Cast): CastingFile | undefined {
    const next: CastingFile = {...file}
    let changed = false
    for (const [section, kind] of [
        ['characters', 'characters'],
        ['locations', 'locations'],
    ] as const) {
        const entries = {...file[section]}
        const now = new Set(after[kind].map(m => m.id))
        for (const m of before[kind])
            if (!now.has(m.id) && m.id in entries) {
                delete entries[m.id]
                changed = true
            }
        for (const m of after[kind])
            if (!(m.id in entries) && !before[kind].some(b => b.id === m.id)) {
                entries[m.id] = `project:${m.id}`
                changed = true
            }
        next[section] = entries
    }
    return changed ? next : undefined
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
export function resolveCasting(
    file: CastingFile,
    cast: Cast,
    libraryHas: (kind: AssetKind, id: string) => boolean,
): {entries: CastEntry[]; errors: string[]; warnings: string[]} {
    const entries: CastEntry[] = []
    const errors: string[] = []
    const warnings: string[] = []
    for (const key of Object.keys(file)) {
        if (key !== 'characters' && key !== 'locations')
            warnings.push(`${CASTING_FILE}: unknown top-level key "${key}" - entries belong under characters/locations`)
    }
    const sections: [AssetKind, Record<string, string> | undefined, {id: string; name: string; isGroup?: boolean}[]][] = [
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
                errors.push(
                    `${CASTING_FILE}: ${kind} "${id}" is "library:${libraryId}", but the library has no ${kind} "${libraryId}" (${libraryFolder(kind, libraryId)})`,
                )
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
    const parts = ['asset.json', 'picture.png', 'sheet/anchor.png'].map(f =>
        existsSync(join(folder, f)) ? Bun.hash(readFileSync(join(folder, f))).toString(16) : '-',
    )
    return parts.join('.')
}

/**
 * Copies every library entry that is not in the project yet, or in another version - the project's own pictures of it
 * go to old/attempts first. Returns the entries copied now and the new record of all copies.
 */
export function copyCasting(
    projectDir: string,
    library: string,
    entries: CastEntry[],
    copies: CastingCopies = {},
): {copied: CastEntry[]; copies: CastingCopies} {
    const next: CastingCopies = {}
    const copied: CastEntry[] = []
    for (const entry of entries) {
        const key = copyKey(entry.kind, entry.id)
        const fingerprint = libraryFingerprint(library, entry.kind, entry.libraryId)
        const was = copies[key]
        const target = assetPaths(entry.kind, entry.id)
        const plan = copyPlan(library, libraryLayout(entry.kind, entry.libraryId), target)
        const there = plan.length > 0 && plan.every(file => existsSync(join(projectDir, file.to)))
        if (!(was && was.library === entry.libraryId && was.fingerprint === fingerprint && there)) {
            copyAsset(
                {dir: library, layout: libraryLayout(entry.kind, entry.libraryId), label: `library:${entry.libraryId}`},
                {dir: projectDir, layout: assetPaths(entry.kind, entry.id), archiveName: entry.id},
            )
            copied.push(entry)
        }
        next[key] = {library: entry.libraryId, fingerprint}
    }
    return {copied, copies: next}
}

/** Copies the record has that casting.json no longer asks for - the role went back to "project:" (or left the cast). */
export const droppedCopies = (copies: CastingCopies, entries: CastEntry[]) =>
    Object.keys(copies).filter(key => !entries.some(e => copyKey(e.kind, e.id) === key))

/**
 * The casting of a project - the music video's (index.ts) and a film's (film.ts): casting.json written once and read
 * against the cast and the library, a role that went back to "project:" has its library pictures put away, the library
 * assets are copied in. Throws before anything is made on an entry the library does not have. `copies`: the record of the
 * copies so far; `again`: what the warning of a role that went back to "project:" says makes its texts anew. Returns the
 * library asset of every entry by copyKey, the new record of the copies, and whether anything was copied or put away.
 */
export async function castFromLibrary({
    dir,
    cast,
    library,
    copies,
    again,
}: {
    dir: string
    cast: Cast
    library: string
    copies: CastingCopies | undefined
    again: (kind: AssetKind) => string
}): Promise<{entries: CastEntry[]; assets: Map<string, LibraryAsset>; copies: CastingCopies; changed: boolean}> {
    if (writeCastingOnce(dir, cast))
        log.step('Casting', styles.muted(`${CASTING_FILE} written - every character and place "project:"; "library:<id>" in it takes a library asset instead`))
    const casting = resolveCasting(readCastingFile(dir), cast, (kind, id) => libraryIds(library, kind).includes(id))
    for (const warning of casting.warnings) log.warn(warning)
    if (casting.errors.length)
        throw new Error(
            `${casting.errors.join('\n')}\nNothing was made - fix ${join(dir, CASTING_FILE)} (or put the asset into the library: bun run export-asset / create-asset)`,
        )
    // copyKey -> the library asset that plays it
    const assets = new Map<string, LibraryAsset>()
    for (const entry of casting.entries) assets.set(copyKey(entry.kind, entry.id), (await readLibraryAsset(library, entry.kind, entry.libraryId))!)
    // a role that went back to "project:": the library pictures are put away, the project makes its own again
    const dropped = droppedCopies(copies ?? {}, casting.entries)
    for (const key of dropped) {
        const [kind, id] = key.split(':') as [AssetKind, string]
        const {picture, sheet} = assetPaths(kind, id)
        archiveFiles(dir, `${id}-library-${versionStamp()}`, [picture, `${picture}.json`, sheet])
        log.warn(`${id} is "project:" again - the library pictures are put away in old/attempts; ${again(kind)}`)
    }
    const {copied, copies: next} = copyCasting(dir, library, casting.entries, copies)
    for (const entry of copied)
        log.step('Casting', `${styles.name(entry.id)} ${styles.muted(`← library:${entry.libraryId} - pictures copied, never rendered again`)}`)
    return {entries: casting.entries, assets, copies: next, changed: copied.length > 0 || dropped.length > 0}
}
