import {existsSync, readdirSync, readFileSync, statSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import type {AssetKind} from "../asset-import.ts";
import {assetPaths} from "../asset-import.ts";
import {CASTING_FILE, type CastingFile, readCastingFile, resolveCasting} from "../casting.ts";
import {libraryDir, libraryFolder, libraryIds, readLibraryAsset} from "../library.ts";
import {withProjectLock} from "../lock.ts";
import {listProjects, projectDir} from "../project-setup.ts";
import type {Project} from "../project.ts";
import {filmDir, filmIds} from "../film/setup.ts";
import type {FilmProject} from "../film/types.ts";
import type {EditorTarget} from "./project.ts";

// The asset library and casting.json as the workspace shows them. Taking something out of the library stays with the pipeline:
// the page only changes the entry in casting.json, and the next run copies the asset, pins it and writes its texts.

const versioned = (dir: string, file: string) => existsSync(join(dir, file)) ? {file, v: Math.round(statSync(join(dir, file)).mtimeMs)} : undefined

function castingOf(dir: string): CastingFile {
    try {
        return readCastingFile(dir)
    } catch {
        return {}      // written wrongly by hand: the casting page of that project says so
    }
}

export type LibraryEntry = {
    kind: AssetKind, id: string, name: string, description: string, anchors?: string, source?: string, created?: string,
    picture?: { file: string, v: number }, anchor?: { file: string, v: number }, video?: { file: string, v: number },
    frames: { file: string, v: number }[],
    usedBy: { kind: 'music' | 'film', id: string, role: string }[],
}

/** Everything in the library, with who uses it: the library does not know that itself, every project's casting.json does. */
export async function readLibrary(): Promise<{ dir: string, assets: LibraryEntry[] }> {
    const dir = await libraryDir()
    const projects = [
        ...listProjects().map(id => ({kind: 'music' as const, id, casting: castingOf(projectDir(id))})),
        ...filmIds().map(id => ({kind: 'film' as const, id, casting: castingOf(filmDir(id))})),
    ]
    const usedBy = (section: 'characters' | 'locations', id: string) => projects.flatMap(p => Object.entries(p.casting[section] ?? {}).filter(([, value]) => value === `library:${id}`).map(([role]) => ({kind: p.kind, id: p.id, role})))
    const assets: LibraryEntry[] = []
    for (const kind of ['character', 'location'] as const) {
        for (const id of libraryIds(dir, kind)) {
            const asset = await readLibraryAsset(dir, kind, id)
            if (!asset) continue
            const folder = libraryFolder(kind, id)
            const framesDir = join(dir, folder, 'sheet', 'frames')
            assets.push({
                kind, id, name: asset.name, description: asset.description, anchors: asset.anchors, source: asset.source, created: asset.created,
                picture: versioned(dir, `${folder}/picture.png`),
                anchor: versioned(dir, `${folder}/sheet/anchor.png`),
                video: versioned(dir, `${folder}/sheet/sequence.mp4`),
                frames: existsSync(framesDir) ? readdirSync(framesDir).filter(f => f.endsWith('.png')).sort().flatMap(f => versioned(dir, `${folder}/sheet/frames/${f}`) ?? []) : [],
                usedBy: usedBy(kind === 'character' ? 'characters' : 'locations', id),
            })
        }
    }
    return {dir, assets}
}

export type CastingRole = {
    kind: AssetKind, id: string, name: string, role?: string,
    entry?: string,             // what casting.json says; none: it runs as "project:"
    libraryId?: string,
    copied: boolean,            // the library asset is in the project already
    picture?: { file: string, v: number },
    clips: string[],            // the clips that have its picture
    errors: string[],
    warnings: string[],
}

type Cast = { characters: { id: string, name: string, role?: string, isGroup?: boolean, voiceOnly?: boolean }[], locations: { id: string, name: string }[] }

/** The roles and places of the project, with what casting.json and the library say about each. */
export async function readCasting(target: EditorTarget, clips: { id: string, pictures: { file: string }[] }[]): Promise<{ roles: CastingRole[], errors: string[], warnings: string[], options: { character: string[], location: string[] } }> {
    const data: (Project | FilmProject) = existsSync(join(target.dir, 'project.json')) ? JSON.parse(readFileSync(join(target.dir, 'project.json'), 'utf8')) : {}
    const raw = data.cast as Cast | undefined
    const cast: Cast = {characters: (raw?.characters ?? []).filter(c => !c.voiceOnly), locations: raw?.locations ?? []}
    const library = await libraryDir()
    const options = {character: libraryIds(library, 'character'), location: libraryIds(library, 'location')}
    let file: CastingFile = {}
    let broken: string | undefined
    try {
        file = readCastingFile(target.dir)
    } catch (e) {
        broken = (e as Error).message
    }
    const resolved = resolveCasting(file, cast, (kind, id) => options[kind].includes(id))
    const copies = (data as { castingCopies?: Record<string, { library: string }> }).castingCopies ?? {}
    const about = (lines: string[], id: string) => lines.filter(line => line.includes(`"${id}"`))
    const role = (kind: AssetKind, member: { id: string, name: string, role?: string }): CastingRole => {
        const entry = (kind === 'character' ? file.characters : file.locations)?.[member.id]
        const libraryId = entry?.startsWith('library:') ? entry.slice('library:'.length) : undefined
        const picture = assetPaths(kind, member.id).picture
        return {
            kind, id: member.id, name: member.name, role: member.role, entry, libraryId,
            copied: !!libraryId && copies[`${kind}:${member.id}`]?.library === libraryId,
            picture: versioned(target.dir, picture),
            clips: clips.filter(c => c.pictures.some(p => p.file === picture || p.file.startsWith(`${assetPaths(kind, member.id).sheet}/`))).map(c => c.id),
            errors: about(resolved.errors, member.id),
            warnings: about(resolved.warnings, member.id),
        }
    }
    return {
        roles: [...cast.characters.map(c => role('character', c)), ...cast.locations.map(l => role('location', l))],
        errors: broken ? [broken] : resolved.errors.filter(line => !cast.characters.some(c => line.includes(`"${c.id}"`)) && !cast.locations.some(l => line.includes(`"${l.id}"`))),
        warnings: resolved.warnings.filter(line => !cast.characters.some(c => line.includes(`"${c.id}"`)) && !cast.locations.some(l => line.includes(`"${l.id}"`))),
        options,
    }
}

/** Changes one entry of casting.json and leaves all the others as they are. The file stays the user's: this happens only on an explicit choice, never while a run holds the lock. */
export async function writeCastingEntry(target: EditorTarget, kind: AssetKind, id: string, value: string) {
    const library = await libraryDir()
    const expected = value === `project:${id}` || (value.startsWith('library:') && libraryIds(library, kind).includes(value.slice('library:'.length)))
    if (!expected) throw new Error(`${value} is neither "project:${id}" nor a ${kind} of the library`)
    await withProjectLock(target.dir, target.id, () => {
        const file = readCastingFile(target.dir)
        const section = kind === 'character' ? 'characters' : 'locations'
        file[section] = {...file[section], [id]: value}
        writeFileSync(join(target.dir, CASTING_FILE), JSON.stringify(file, null, 2) + '\n')
    })
}
