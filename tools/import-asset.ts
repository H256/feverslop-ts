import {cli} from '../lib/cli.ts';
import {log} from '../lib/log.ts';
// Carries a finished character or place over from another project - its picture and its whole reference sheet,
// renamed to the id it has here - instead of rendering it again. Nothing is rendered: the copied files are pinned (never
// reported stale), the old ones go to old/attempts/. The description that goes with the picture is chosen here; what
// the plan built on the old one is printed as a --redo, not done.
// usage: bun run import-asset <project-id> [<character or location id>] [--from=<project-id>[:<id>] | --from=library:<id>]
import * as p from "@clack/prompts";
import {existsSync, readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {type AssetKind, type AssetLayout, assetIds, assetPaths, copyAsset} from "../lib/asset-import.ts";
import {libraryDir, libraryIds, libraryLayout, readLibraryAsset} from "../lib/library.ts";
import {loadProjectConfig} from "../lib/config.ts";
import {genderNote} from "../lib/gender-check.ts";
import {configureLlm} from "../lib/llm.ts";
import {characterViews, describePicture} from "../lib/describe-picture.ts";
import {styles} from "../lib/log.ts";
import {pictureProp, propMissing} from "../lib/prop-check.ts";
import {listProjects, projectDir, projectExists} from "../lib/project-setup.ts";
import {type LocationLayout, type Project, redoAfter, type StepName} from "../lib/project.ts";
import {loadSettings} from "../lib/settings.ts";
cli('import-asset')


const usage = 'usage: bun run import-asset <project-id> [<character or location id>] [--from=<project-id>[:<id>] | --from=library:<id>]'
if (!process.stdin.isTTY || !process.stdout.isTTY) {
    log.error(`This needs a terminal to ask in - ${usage}`)
    process.exit(1)
}
const args = Bun.argv.slice(2)
const from = args.find(a => a.startsWith('--from='))?.slice('--from='.length)
const [id, wantedId] = args.filter(a => !a.startsWith('--'))
if (!id || !projectExists(id)) {
    log.error(`${usage}${id ? `\nprojects/${id} does not exist` : ''}`)
    process.exit(1)
}
const dir = projectDir(id)
const file = join(dir, 'project.json')
if (!existsSync(file)) {
    log.error(`${file} not found - plan the project first: bun index.ts ${id}`)
    process.exit(1)
}
const data: Project = await Bun.file(file).json()
type Entry = { kind: AssetKind, id: string, name: string }
const entries = (project: Project): Entry[] => [
    ...(project.cast?.characters ?? []).map(c => ({kind: 'character' as const, id: c.id, name: c.name})),
    ...(project.cast?.locations ?? []).map(l => ({kind: 'location' as const, id: l.id, name: l.name})),
]
const targets = entries(data)
if (!targets.length) {
    log.error(`No characters or locations in projects/${id}/project.json yet - plan the project first: bun index.ts ${id}`)
    process.exit(1)
}

log.section(`feverslop-ts · import asset · ${id}`)

// 1. what is replaced here
const target = wantedId
    ? targets.find(t => t.id === wantedId) ?? fail(`"${wantedId}" is no character or location of ${id}: ${targets.map(t => t.id).join(', ')}`)
    : targets[Number(answer(await p.select({
        message: 'What gets the imported pictures?',
        options: targets.map((t, n) => ({value: String(n), label: `${t.name} ${styles.muted(`(${t.kind} · ${t.id})`)}`})),
    })))]!

// 2. where it comes from: the library, or another project with a finished asset of that kind
type Source = {
    label: string, dir: string, ids: string[], layout: (assetId: string) => AssetLayout,
    name: (assetId: string) => string | undefined, description: (assetId: string) => string | undefined,
    anchors: (assetId: string) => string | undefined, floorPlan: (assetId: string) => LocationLayout | undefined,
}
const library = await libraryDir()
const libraryRecords = Object.fromEntries(await Promise.all(libraryIds(library, target.kind).map(async l => [l, (await readLibraryAsset(library, target.kind, l))!] as const)))
const librarySource: Source = {
    label: 'the library', dir: library, ids: Object.keys(libraryRecords), layout: l => libraryLayout(target.kind, l),
    name: l => libraryRecords[l]?.name, description: l => libraryRecords[l]?.description,
    anchors: l => libraryRecords[l]?.anchors, floorPlan: l => libraryRecords[l]?.layout,
}
const projectSource = (project: string): Source => {
    const sourceDir = projectDir(project)
    const other: Partial<Project> = existsSync(join(sourceDir, 'project.json')) ? JSON.parse(readFileSync(join(sourceDir, 'project.json'), 'utf8')) : {}
    return {
        label: project, dir: sourceDir, ids: assetIds(sourceDir, target.kind), layout: a => assetPaths(target.kind, a),
        name: a => entries(other as Project).find(e => e.kind === target.kind && e.id === a)?.name,
        description: a => (target.kind === 'character' ? other.characterDescriptions : other.locationDescriptions)?.[a],
        anchors: a => other.locationAnchors?.[a], floorPlan: a => other.locationLayouts?.[a],
    }
}
const [fromWhere, fromId] = from?.split(':') ?? []
const projects = listProjects().filter(other => other !== id && assetIds(projectDir(other), target.kind).length)
if (!projects.length && !librarySource.ids.length) fail(`Neither the library nor another project has a finished ${target.kind} to import`)
const matches = (source: Source) => source.ids.some(a => a === target.id || source.name(a) === target.name)
const source: Source = fromWhere === 'library'
    ? librarySource
    : fromWhere
        ? (projects.includes(fromWhere) ? projectSource(fromWhere) : fail(`projects/${fromWhere} has no finished ${target.kind}s`))
        : await (async () => {
            const choice = answer(await p.select({
                message: `Where to take the ${target.kind} from`,
                // the library first, then the projects with an asset of the same id or name - the same character in another version of the song
                options: [
                    ...(librarySource.ids.length ? [{value: 'library:', label: `The library ${styles.muted(`(${librarySource.ids.length} ${target.kind}s)`)}`}] : []),
                    ...projects.map(projectSource).sort((a, b) => Number(matches(b)) - Number(matches(a))).map(s => ({value: s.label, label: `${s.label}${matches(s) ? styles.muted(' · same id or name') : ''}`})),
                ],
            }))
            return choice === 'library:' ? librarySource : projectSource(choice)
        })()
const sourceId = fromId
    ? (source.ids.includes(fromId) ? fromId : fail(`${source.label} has no ${target.kind} "${fromId}": ${source.ids.join(', ') || 'none'}`))
    : answer(await p.select({
        message: `${target.kind === 'character' ? 'Character' : 'Location'} of ${source.label}`,
        initialValue: source.ids.find(a => a === target.id || source.name(a) === target.name) ?? source.ids[0],
        options: source.ids.map(a => ({value: a, label: `${source.name(a) ?? a} ${styles.muted(`(${a})`)}`})),
    }))
const fromLibrary = source === librarySource
const sourceLabel = fromLibrary ? `library:${sourceId}` : `${source.label}/${sourceId}`

const {picture, sheet} = assetPaths(target.kind, target.id)
const replacing = [picture, sheet].some(f => existsSync(join(dir, f)))
if (!answer(await p.confirm({
    message: `Copy ${sourceLabel} to ${target.id}${replacing ? ` - the current pictures of ${target.name} are put away in old/attempts/` : ''}?`,
    initialValue: true,
}))) {
    log.cancel('Cancelled - nothing was changed')
    process.exit(0)
}
const done = copyAsset({dir: source.dir, layout: source.layout(sourceId), label: fromLibrary ? 'library' : source.label}, {dir, layout: assetPaths(target.kind, target.id), archiveName: target.id})
log.success(`Copied ${done.copied} file(s) to ${sheet}${existsSync(join(dir, picture)) ? ` and ${picture}` : ''} - pinned, never rendered again`)
if (done.putAway) log.info(`The old pictures are in ${done.putAway}`)

// 3. the description that goes with the picture
const config = await loadProjectConfig(dir)
const descriptions = target.kind === 'character' ? (data.characterDescriptions ??= {}) : (data.locationDescriptions ??= {})
const theirs = source.description(sourceId)
const ours = descriptions[target.id]
const mode = answer(await p.select({
    message: 'Description used in the clip prompts',
    options: [
        ...(theirs ? [{value: 'source', label: `${fromLibrary ? 'The library' : source.label}: written for this picture`, hint: theirs.slice(0, 80)}] : []),
        {value: 'vision', label: 'Write it from the picture (vision-capable LLM)'},
        ...(ours ? [{value: 'keep', label: `Keep the one of ${id}`, hint: ours.slice(0, 80)}] : []),
    ],
}))
let description = mode === 'source' ? theirs : mode === 'keep' ? ours : await fromPicture()
if (!description) description = answer(await p.text({message: 'Type the description (leave empty to keep the current one)'})) || ours
const changed: StepName[] = []
if (description && description !== ours) {
    descriptions[target.id] = description
    changed.push(target.kind === 'character' ? 'characterDescriptions' : 'locationDescriptions')
}

// a place's background features and floor plan describe its picture too - taken along when the source has them
if (target.kind === 'location') {
    const anchor = source.anchors(sourceId)
    if (anchor && anchor !== data.locationAnchors?.[target.id]) {
        (data.locationAnchors ??= {})[target.id] = anchor
        changed.push('locationAnchors')
    }
    const layout = source.floorPlan(sourceId)
    if (layout && JSON.stringify(layout) !== JSON.stringify(data.locationLayouts?.[target.id])) {
        (data.locationLayouts ??= {})[target.id] = layout
        changed.push('locationLayouts')
    }
    if (anchor || layout) log.info(`Took ${[anchor && 'the background features', layout && 'the floor plan with its views'].filter(Boolean).join(' and ')} along from ${source.label}`)
}
if (changed.length) {
    await Bun.write(file, JSON.stringify(data, null, 2))
    log.success('Saved project.json')
}

// 4. what to look at: the character's prop, the story's pronouns, the plan and the clips made with the old pictures
if (target.kind === 'character' && description) {
    const character = data.cast!.characters.find(c => c.id === target.id)!
    const prop = pictureProp(character)
    if (prop && propMissing(description, prop)) log.warn(`The description does not name ${target.name}'s "${prop}" - the clips may show the picture's prop, or none.`)
    try {
        const settings = await loadSettings({projectModel: config.llm.model})
        configureLlm(settings.llm)
        const own = (data.beats ?? []).map(b => b.summary).filter(s => typeof s === 'string' && s.includes(target.name)).slice(0, 4).join(' ')
        const note = await genderNote(target.name, `${character.role ?? ''} ${own}`.trim().slice(0, 2500), description)
        if (note) log.warn(note)
    } catch {
        // the check is a courtesy: no language model connected, nothing to say
    }
}
const redo = redoAfter(changed, data)
if (redo.length) {
    log.warn(`The plan was made with the old description${changed.length > 1 ? 's' : ''} - to make it again with the new one:`)
    log.info(`bun index.ts ${id} --redo=${redo.join(',')}`)
}
const clipsDir = join(dir, 'output', 'clips')
if (existsSync(clipsDir)) {
    const rendered: string[] = []
    for (const entry of readdirSync(clipsDir)) {
        if (!entry.endsWith('.json')) continue
        const clip = await Bun.file(join(clipsDir, entry)).json()
        const slotId = entry.replace(/\.json$/, '')
        if (clip.assets?.pictures?.some((pic: { id: string }) => pic.id === target.id) && existsSync(join(dir, 'videos', `${slotId}.mp4`))) rendered.push(slotId)
    }
    if (rendered.length) log.warn(`${rendered.length} rendered clip(s) show the old ${target.name}: ${rendered.join(', ')} - they count as stale now; --render=videos --refresh=clips renders them again.`)
}
log.success('Done - nothing was rendered.')

// the picture described by a vision-capable model - a character from its anchor and the full-body views of its sheet, else the
// picture itself, at a small size
async function fromPicture(): Promise<string | undefined> {
    const isCharacter = data.cast?.characters.some(c => c.id === target.id)
    const views = isCharacter ? characterViews(join(dir, sheet)) : []
    const image = views.length ? views : [join(dir, sheet, 'anchor.png'), join(dir, picture)].find(existsSync)
    if (!image) return undefined
    const settings = await loadSettings({projectModel: config.llm.model})
    configureLlm(settings.llm)
    log.info('Asking the vision model - can take a while')
    try {
        const character = data.cast?.characters.find(c => c.id === target.id)
        const text = await describePicture(image, character ? {kind: 'character', name: character.name, role: character.role} : {kind: 'location', name: target.name})
        if (text) log.info(text)
        return text
    } catch (e) {
        log.warn(`The vision description failed - the connected model may not take images (${(e as Error).message})`)
        return undefined
    }
}

function fail(message: string): never {
    log.cancel(message)
    process.exit(1)
}

// cancelled with Ctrl+C / Esc
function answer<T>(value: T): Exclude<T, symbol> {
    if (p.isCancel(value)) {
        log.cancel('Cancelled')
        process.exit(1)
    }
    return value as Exclude<T, symbol>
}
