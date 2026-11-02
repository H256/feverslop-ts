// The asset library: finished characters and places that any project can take (import-asset, casting.json) - the same
// band in every song, the same stage. Shared between projects, outside of all of them:
//   library/<characters|locations>/<id>/asset.json   name, description, for a place its background features and floor
//                                                    plan; where it came from
//   library/<characters|locations>/<id>/picture.png  the picture (the reference sheet)
//   library/<characters|locations>/<id>/sheet/       anchor.png, sequence.mp4, frames/
// A project always gets a copy (lib/asset-import.ts), so it stays complete without the library.

import {existsSync, mkdirSync, readdirSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import type {AssetKind, AssetLayout} from "./asset-import.ts";
import {log} from "./log.ts";
import type {LocationLayout} from "./project.ts";
import {readSettingsFile} from "./settings.ts";

export type LibraryAsset = {
    kind: AssetKind,
    id: string,
    name: string,
    // what it looks like - the description the clip prompts use
    description: string,
    // a place: the fixed features behind the people (locationAnchors) and its floor plan with what each view shows
    anchors?: string,
    layout?: LocationLayout,
    // where it came from: "<project>/<id>", or the picture it was made from
    source?: string,
    created?: string,
}

/** The library folder: FEVERSLOP_LIBRARY, else "library" in the settings file, else library/ in the working directory. */
export async function libraryDir(): Promise<string> {
    if (process.env.FEVERSLOP_LIBRARY) return resolve(process.env.FEVERSLOP_LIBRARY)
    const file = await readSettingsFile()
    return resolve(file.library ?? 'library')
}

export const libraryIdPattern = /^[a-z0-9][a-z0-9-]*$/

/** An asset's folder, relative to the library. */
export const libraryFolder = (kind: AssetKind, id: string) => `${kind}s/${id}`

/** Where an asset's files are in the library, relative to it - the layout copyAsset reads and writes. */
export const libraryLayout = (kind: AssetKind, id: string): AssetLayout => ({
    picture: `${libraryFolder(kind, id)}/picture.png`,
    sheet: `${libraryFolder(kind, id)}/sheet`,
})

/** The asset's record - undefined when the library has none of that id. */
export async function readLibraryAsset(dir: string, kind: AssetKind, id: string): Promise<LibraryAsset | undefined> {
    const file = join(dir, libraryFolder(kind, id), 'asset.json')
    if (!existsSync(file)) return undefined
    const asset = await Bun.file(file).json() as LibraryAsset
    return {...asset, kind, id}
}

export function writeLibraryAsset(dir: string, asset: LibraryAsset) {
    const folder = join(dir, libraryFolder(asset.kind, asset.id))
    mkdirSync(folder, {recursive: true})
    writeFileSync(join(folder, 'asset.json'), JSON.stringify(asset, null, 2) + '\n')
}

/** Why the library takes no new asset of this id - it has one, and an asset there is never overwritten. Undefined: the id is free. */
export async function libraryTaken(dir: string, kind: AssetKind, id: string): Promise<string | undefined> {
    if (await readLibraryAsset(dir, kind, id)) return `The library already has a ${kind} "${id}" (${join(dir, libraryFolder(kind, id))}) - it is never overwritten`
}

/**
 * The last step of a tool that puts an asset into the library, after its files are copied: the record, dated today, and what to do
 * with it next. `copied`: how many files went in; `tail` goes after the message.
 */
export function finishLibraryAsset(dir: string, asset: Omit<LibraryAsset, 'created'>, copied: number, opts: { tail?: string, success?: boolean } = {}) {
    writeLibraryAsset(dir, {...asset, created: new Date().toISOString().slice(0, 10)})
    const folder = join(dir, libraryFolder(asset.kind, asset.id))
    const message = `${asset.name} is in the library as ${asset.kind} "${asset.id}" (${copied} files): ${folder}${opts.tail ?? ''}`
    if (opts.success) log.success(message)
    else log.info(message)
    log.output(folder)
    log.next(`bun run import-asset <project-id> <asset-id> --from=library:${asset.id}`)
}

/** The ids of a kind in the library that have their record. */
export function libraryIds(dir: string, kind: AssetKind): string[] {
    const folder = join(dir, `${kind}s`)
    if (!existsSync(folder)) return []
    return readdirSync(folder).filter(id => existsSync(join(folder, id, 'asset.json'))).sort()
}

/** "library:<id>" → the id, anything else → undefined. */
export const libraryRef = (value: string | undefined) => value?.startsWith('library:') ? value.slice('library:'.length).trim() : undefined
