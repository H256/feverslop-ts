// Puts a finished character or place of a project into the asset library (lib/library.ts) - its picture, its whole
// reference sheet and the texts that go with them - so any project can take it (import-asset, casting.json). Nothing is
// rendered; an asset already in the library is never overwritten.
// usage: bun run export-asset <project-id> <character or location id> [--as=<library id>]
import {existsSync} from "node:fs";
import {join} from "node:path";
import {type AssetKind, assetIds, assetPaths, copyAsset} from "../lib/asset-import.ts";
import {libraryDir, libraryFolder, libraryIdPattern, libraryLayout, readLibraryAsset, writeLibraryAsset} from "../lib/library.ts";
import {projectDir, projectExists} from "../lib/project-setup.ts";
import type {Project} from "../lib/project.ts";

const usage = 'usage: bun run export-asset <project-id> <character or location id> [--as=<library id>]'
const args = Bun.argv.slice(2)
const as = args.find(a => a.startsWith('--as='))?.slice('--as='.length)
const [id, assetId] = args.filter(a => !a.startsWith('--'))
const fail = (message: string): never => {
    console.error(message)
    process.exit(1)
}
if (!id || !assetId) fail(usage)
if (!projectExists(id!)) fail(`projects/${id} does not exist`)
const dir = projectDir(id!)
const file = join(dir, 'project.json')
if (!existsSync(file)) fail(`${file} not found - plan the project first: bun index.ts ${id}`)
const data: Project = await Bun.file(file).json()

const character = data.cast?.characters.find(c => c.id === assetId)
const location = data.cast?.locations.find(l => l.id === assetId)
const kind: AssetKind = character ? 'character' : location ? 'location' : fail(`"${assetId}" is no character or location of ${id}: ${[...(data.cast?.characters ?? []), ...(data.cast?.locations ?? [])].map(e => e.id).join(', ')}`)
if (!assetIds(dir, kind).includes(assetId!)) fail(`${id} has no finished pictures of ${assetId} yet - render them first: bun index.ts ${id} --render=images`)

const library = await libraryDir()
const libraryId = as ?? assetId!
if (!libraryIdPattern.test(libraryId)) fail(`"${libraryId}" is no usable library id - lowercase letters, digits and dashes`)
if (await readLibraryAsset(library, kind, libraryId)) fail(`The library already has a ${kind} "${libraryId}" (${join(library, libraryFolder(kind, libraryId))}) - it is never overwritten; give this one another id: --as=<library id>`)

const description = (kind === 'character' ? data.characterDescriptions : data.locationDescriptions)?.[assetId!]
if (!description) fail(`${id} has no description of ${assetId} yet - plan the project further first: bun index.ts ${id}`)
const {copied} = copyAsset(
    {dir, layout: assetPaths(kind, assetId!), label: `${id}`},
    {dir: library, layout: libraryLayout(kind, libraryId), archiveName: libraryId},
)
writeLibraryAsset(library, {
    kind, id: libraryId,
    name: (character ?? location)!.name,
    description: description!,
    ...(kind === 'location' && data.locationAnchors?.[assetId!] ? {anchors: data.locationAnchors[assetId!]} : {}),
    ...(kind === 'location' && data.locationLayouts?.[assetId!] ? {layout: data.locationLayouts[assetId!]} : {}),
    source: `${id}/${assetId}`,
    created: new Date().toISOString().slice(0, 10),
})
console.log(`${(character ?? location)!.name} is in the library as ${kind} "${libraryId}" (${copied} files): ${join(library, libraryFolder(kind, libraryId))}`)
console.log(`Take it into a project with: bun run import-asset <project-id> <id there> --from=library:${libraryId}`)
