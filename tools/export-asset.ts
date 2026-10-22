import {cli} from '../lib/cli.ts';
import {log} from '../lib/log.ts';
// Puts a finished character or place of a project into the asset library (lib/library.ts) - its picture, its whole
// reference sheet and the texts that go with them - so any project can take it (import-asset, casting.json). Nothing is
// rendered; an asset already in the library is never overwritten.
// usage: bun run export-asset <project-id> <character or location id> [--as=<library id>]
//        bun run export-asset <film-id> <character, look or location id> --film [--as=<library id>]   (a film's, films/<id>/)
import {existsSync} from "node:fs";
import {join} from "node:path";
import {type AssetKind, assetIds, assetPaths, copyAsset} from "../lib/asset-import.ts";
import {libraryDir, libraryFolder, libraryIdPattern, libraryLayout, readLibraryAsset, writeLibraryAsset} from "../lib/library.ts";
import {projectDir, projectExists} from "../lib/project-setup.ts";
import type {Project} from "../lib/project.ts";
import {filmDir, filmExists} from "../lib/film/setup.ts";
import {statePictureId} from "../lib/film/pictures.ts";
import type {FilmProject} from "../lib/film/types.ts";
cli('export-asset')


const usage = 'usage: bun run export-asset <project-id> <character or location id> [--as=<library id>] [--film]'
const args = Bun.argv.slice(2)
const as = args.find(a => a.startsWith('--as='))?.slice('--as='.length)
const isFilm = args.includes('--film')
const [id, assetId] = args.filter(a => !a.startsWith('--'))
const fail = (message: string): never => {
    log.error(message)
    process.exit(1)
}
if (!id || !assetId) fail(usage)
if (isFilm ? !filmExists(id!) : !projectExists(id!)) fail(`${isFilm ? 'films' : 'projects'}/${id} does not exist`)
const dir = isFilm ? filmDir(id!) : projectDir(id!)
const file = join(dir, 'project.json')
const run = isFilm ? `bun film.ts ${id}` : `bun index.ts ${id}`
if (!existsSync(file)) fail(`${file} not found - plan it first: ${run}`)
const data: Project | FilmProject = await Bun.file(file).json()

// a film's character in one of its other looks (wounded, disguised) has a picture of its own: <character>--<look>
const looks = isFilm ? ((data as FilmProject).cast?.characters ?? []).flatMap(c => (c.states ?? []).map(s => ({id: statePictureId(c.id, s.id), name: `${c.name} (${s.name})`}))) : []
const character = data.cast?.characters.find(c => c.id === assetId) ?? looks.find(l => l.id === assetId)
const location = data.cast?.locations.find(l => l.id === assetId)
const kind: AssetKind = character ? 'character' : location ? 'location' : fail(`"${assetId}" is no character or location of ${id}: ${[...(data.cast?.characters ?? []), ...looks, ...(data.cast?.locations ?? [])].map(e => e.id).join(', ')}`)
if (!assetIds(dir, kind).includes(assetId!)) fail(`${id} has no finished pictures of ${assetId} yet - render them first: ${run} --render=images`)

const library = await libraryDir()
const libraryId = as ?? assetId!
if (!libraryIdPattern.test(libraryId)) fail(`"${libraryId}" is no usable library id - lowercase letters, digits and dashes`)
if (await readLibraryAsset(library, kind, libraryId)) fail(`The library already has a ${kind} "${libraryId}" (${join(library, libraryFolder(kind, libraryId))}) - it is never overwritten; give this one another id: --as=<library id>`)

const description = (kind === 'character' ? data.characterDescriptions : data.locationDescriptions)?.[assetId!]
if (!description) fail(`${id} has no description of ${assetId} yet - plan it further first: ${run}`)
const {copied} = copyAsset(
    {dir, layout: assetPaths(kind, assetId!), label: `${id}`},
    {dir: library, layout: libraryLayout(kind, libraryId), archiveName: libraryId},
)
writeLibraryAsset(library, {
    kind, id: libraryId,
    name: (character ?? location)!.name,
    description: description!,
    ...(kind === 'location' && !isFilm && (data as Project).locationAnchors?.[assetId!] ? {anchors: (data as Project).locationAnchors![assetId!]} : {}),
    ...(kind === 'location' && !isFilm && (data as Project).locationLayouts?.[assetId!] ? {layout: (data as Project).locationLayouts![assetId!]} : {}),
    source: `${id}/${assetId}`,
    created: new Date().toISOString().slice(0, 10),
})
log.info(`${(character ?? location)!.name} is in the library as ${kind} "${libraryId}" (${copied} files): ${join(library, libraryFolder(kind, libraryId))}`)
log.output(join(library, libraryFolder(kind, libraryId)))
log.next(`bun run import-asset <project-id> <asset-id> --from=library:${libraryId}`)
