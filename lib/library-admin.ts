// What is in the library and who uses it, and an asset or a song renamed, described anew or put away (#835) - for
// `bun run library` and the Library page alike. Nothing is deleted: a removed entry goes to the library's .trash/ folder, and
// an entry a project still names in its casting.json is not removed at all.

import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import type {AssetKind} from './asset-import.ts'
import {filmDir, filmIds} from './film/setup.ts'
import {libraryFolder, libraryIds, readLibraryAsset, writeLibraryAsset} from './library.ts'
import {listProjects, projectDir} from './project-setup.ts'
import {librarySongIds, readLibrarySong, songFolder, type LibrarySong} from './song-library.ts'

export type LibraryKind = AssetKind | 'song'
export const LIBRARY_KINDS: readonly LibraryKind[] = ['character', 'location', 'song']

/** A project that uses an entry: "music/tides (as Kael)". */
export type LibraryUse = {kind: 'music' | 'film'; id: string; role?: string}
export type LibraryItem = {kind: AssetKind; id: string; name: string; description: string; usedBy: LibraryUse[]}
export type LibrarySongItem = {
    id: string
    name: string
    seconds?: number
    stems: number
    lines: number
    byHand: number
    source?: string
    usedBy: LibraryUse[]
}
export type LibraryListing = {dir: string; characters: LibraryItem[]; locations: LibraryItem[]; songs: LibrarySongItem[]}

const readJson = <T>(file: string): T | undefined => {
    try {
        return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : undefined
    } catch {
        return undefined
    }
}

type Folder = {kind: 'music' | 'film'; id: string; dir: string}
const folders = (): Folder[] => [
    ...listProjects().map(id => ({kind: 'music' as const, id, dir: projectDir(id)})),
    ...filmIds().map(id => ({kind: 'film' as const, id, dir: filmDir(id)})),
]

/** The projects whose casting.json gives a role this asset of the library. */
export function assetUsers(kind: AssetKind, id: string, projects: Folder[] = folders()): LibraryUse[] {
    const section = kind === 'character' ? 'characters' : 'locations'
    return projects.flatMap(p => {
        const casting = readJson<Record<string, Record<string, string>>>(join(p.dir, 'casting.json'))
        return Object.entries(casting?.[section] ?? {})
            .filter(([, value]) => value === `library:${id}`)
            .map(([role]) => ({kind: p.kind, id: p.id, role}))
    })
}

/** The music videos made of this song: their project.json has its audio among the inputs it was planned from. */
export function songUsers(song: LibrarySong, projects: Folder[] = folders()): LibraryUse[] {
    return projects
        .filter(p => p.kind === 'music')
        .filter(p => Object.values(readJson<{inputs?: Record<string, string>}>(join(p.dir, 'project.json'))?.inputs ?? {}).includes(song.fingerprints.song))
        .map(p => ({kind: p.kind, id: p.id}))
}

export async function listLibrary(dir: string): Promise<LibraryListing> {
    const projects = folders()
    const items = async (kind: AssetKind) =>
        (await Promise.all(libraryIds(dir, kind).map(id => readLibraryAsset(dir, kind, id))))
            .filter(a => !!a)
            .map(a => ({kind, id: a.id, name: a.name, description: a.description, usedBy: assetUsers(kind, a.id, projects)}))
    const songs = (await Promise.all(librarySongIds(dir).map(id => readLibrarySong(dir, id))))
        .filter(s => !!s)
        .map(song => ({
            id: song.id,
            name: song.name,
            seconds: song.music?.durationSec,
            stems: Object.keys(song.stems ?? {}).length,
            lines: song.lyricsTiming?.lines.length ?? 0,
            byHand: song.lyricsTiming?.lines.filter(l => l.byHand).length ?? 0,
            source: song.source,
            usedBy: songUsers(song, projects),
        }))
    return {dir, characters: await items('character'), locations: await items('location'), songs}
}

const entryFile = (dir: string, kind: LibraryKind, id: string) =>
    kind === 'song' ? join(dir, songFolder(id), 'song.json') : join(dir, libraryFolder(kind, id), 'asset.json')

/** The record of an entry, or why there is none. */
function entry(dir: string, kind: LibraryKind, id: string): Record<string, unknown> {
    const record = readJson<Record<string, unknown>>(entryFile(dir, kind, id))
    if (!record) throw new Error(`the library has no ${kind} "${id}"`)
    return record
}

/** Another name: what the pages and the prompts call it. The id stays - the projects name it by that. */
export function renameEntry(dir: string, kind: LibraryKind, id: string, name: string) {
    const clean = name.trim()
    if (!clean || clean.length > 120 || /[\r\n]/.test(clean)) throw new Error('a name is one line of at most 120 characters')
    const record = entry(dir, kind, id)
    writeFileSync(entryFile(dir, kind, id), JSON.stringify({...record, name: clean}, null, 2) + '\n')
    return {from: String(record.name ?? id), to: clean}
}

/**
 * A character or place described anew: what the clip prompts say it looks like. A project that took it before keeps its copy
 * (lib/asset-import.ts); it gets the new text when it takes the asset again.
 */
export async function describeEntry(dir: string, kind: AssetKind, id: string, description: string) {
    const clean = description.trim()
    if (!clean || clean.length > 4000) throw new Error('a description is between 1 and 4000 characters')
    const asset = await readLibraryAsset(dir, kind, id)
    if (!asset) throw new Error(`the library has no ${kind} "${id}"`)
    writeLibraryAsset(dir, {...asset, description: clean})
}

/**
 * An entry put away: into .trash/ of the library, under its id and the time. Refused while a project names it in its casting.json
 * - those projects are named - or, for a song, while a music video made of it has nothing of its own (it took a copy: a song is
 * removed all the same, its projects keep their files).
 */
export function removeEntry(dir: string, kind: LibraryKind, id: string, now = new Date()) {
    entry(dir, kind, id)
    if (kind !== 'song') {
        const users = assetUsers(kind, id)
        if (users.length)
            throw new Error(
                `${kind} "${id}" is in use - ${users.map(u => `${u.kind === 'film' ? 'film' : 'project'} ${u.id}${u.role ? ` (as ${u.role})` : ''}`).join(', ')}: give the role another choice on its Casting page first`,
            )
    }
    const from = join(dir, kind === 'song' ? songFolder(id) : libraryFolder(kind, id))
    const stamp = now.toISOString().replace(/[:.]/g, '-')
    const to = join(dir, '.trash', `${kind}s`, `${id}-${stamp}`)
    mkdirSync(join(dir, '.trash', `${kind}s`), {recursive: true})
    renameSync(from, to)
    return to
}
