// Carries a finished character or place over from another project - its picture and its whole reference sheet,
// renamed to the id it has here - instead of rendering it again. Nothing is rendered: the copied files are pinned (never
// reported stale), the old ones go to old/attempts/. The description that goes with the picture is chosen here; what
// the plan built on the old one is printed as a --redo, not done.
// usage: bun run import-asset <project-id> [<character or location id>] [--from=<project-id>[:<id>]]
import * as p from "@clack/prompts";
import {existsSync, readdirSync, readFileSync, rmSync} from "node:fs";
import {join} from "node:path";
import {type AssetKind, assetIds, assetPaths, importAsset} from "../lib/asset-import.ts";
import {loadProjectConfig} from "../lib/config.ts";
import {genderNote} from "../lib/gender-check.ts";
import {ask, configureLlm} from "../lib/llm.ts";
import {printBanner, styles} from "../lib/log.ts";
import {runProcess} from "../lib/process.ts";
import {pictureProp, propMissing} from "../lib/prop-check.ts";
import {characterImageDescriptionPrompt, locationImageDescriptionPrompt} from "../lib/prompts.ts";
import {listProjects, projectDir, projectExists} from "../lib/project-setup.ts";
import {type Project, redoAfter, type StepName} from "../lib/project.ts";
import {loadSettings} from "../lib/settings.ts";

const usage = 'usage: bun run import-asset <project-id> [<character or location id>] [--from=<project-id>[:<id>]]'
if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(`This needs a terminal to ask in - ${usage}`)
    process.exit(1)
}
const args = Bun.argv.slice(2)
const from = args.find(a => a.startsWith('--from='))?.slice('--from='.length)
const [id, wantedId] = args.filter(a => !a.startsWith('--'))
if (!id || !projectExists(id)) {
    console.error(`${usage}${id ? `\nprojects/${id} does not exist` : ''}`)
    process.exit(1)
}
const dir = projectDir(id)
const file = join(dir, 'project.json')
if (!existsSync(file)) {
    console.error(`${file} not found - plan the project first: bun index.ts ${id}`)
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
    console.error(`No characters or locations in projects/${id}/project.json yet - plan the project first: bun index.ts ${id}`)
    process.exit(1)
}

printBanner()
p.intro(`feverslop-ts · import asset · ${id}`)

// 1. what is replaced here
const target = wantedId
    ? targets.find(t => t.id === wantedId) ?? fail(`"${wantedId}" is no character or location of ${id}: ${targets.map(t => t.id).join(', ')}`)
    : targets[Number(answer(await p.select({
        message: 'What gets the imported pictures?',
        options: targets.map((t, n) => ({value: String(n), label: `${t.name} ${styles.muted(`(${t.kind} · ${t.id})`)}`})),
    })))]!

// 2. where it comes from: a project with a finished asset of that kind
const [fromProject, fromId] = from?.split(':') ?? []
const sources = listProjects().filter(other => other !== id && assetIds(projectDir(other), target.kind).length)
if (!sources.length) fail(`No other project has a finished ${target.kind} to import`)
const sourceProject = fromProject
    ? (sources.includes(fromProject) ? fromProject : fail(`projects/${fromProject} has no finished ${target.kind}s`))
    : answer(await p.select({
        message: `Project to take the ${target.kind} from`,
        // the ones with an asset of the same id or name first - the same character in another version of the song
        options: [...sources].sort((a, b) => Number(hasMatch(b)) - Number(hasMatch(a))).map(s => ({value: s, label: `${s}${hasMatch(s) ? styles.muted(' · same id or name') : ''}`})),
    }))
const sourceDir = projectDir(sourceProject)
const sourceData: Partial<Project> = existsSync(join(sourceDir, 'project.json')) ? await Bun.file(join(sourceDir, 'project.json')).json() : {}
const nameIn = (assetId: string) => entries(sourceData as Project).find(e => e.kind === target.kind && e.id === assetId)?.name
const available = assetIds(sourceDir, target.kind)
const sourceId = fromId
    ? (available.includes(fromId) ? fromId : fail(`projects/${sourceProject} has no ${target.kind} "${fromId}": ${available.join(', ')}`))
    : answer(await p.select({
        message: `${target.kind === 'character' ? 'Character' : 'Location'} of ${sourceProject}`,
        initialValue: available.find(a => a === target.id || nameIn(a) === target.name) ?? available[0],
        options: available.map(a => ({value: a, label: `${nameIn(a) ?? a} ${styles.muted(`(${a})`)}`})),
    }))

const {picture, sheet} = assetPaths(target.kind, target.id)
const replacing = [picture, sheet].some(f => existsSync(join(dir, f)))
if (!answer(await p.confirm({
    message: `Copy ${sourceProject}/${sourceId} to ${target.id}${replacing ? ` - the current pictures of ${target.name} are put away in old/attempts/` : ''}?`,
    initialValue: true,
}))) {
    p.cancel('Cancelled - nothing was changed')
    process.exit(0)
}
const done = importAsset(sourceDir, sourceProject, sourceId, dir, target.id, target.kind)
p.log.success(`Copied ${done.copied} file(s) to ${sheet}${existsSync(join(dir, picture)) ? ` and ${picture}` : ''} - pinned, never rendered again`)
if (done.putAway) p.log.step(`The old pictures are in ${done.putAway}`)

// 3. the description that goes with the picture
const config = await loadProjectConfig(dir)
const descriptions = target.kind === 'character' ? (data.characterDescriptions ??= {}) : (data.locationDescriptions ??= {})
const theirs = (target.kind === 'character' ? sourceData.characterDescriptions : sourceData.locationDescriptions)?.[sourceId]
const ours = descriptions[target.id]
const mode = answer(await p.select({
    message: 'Description used in the clip prompts',
    options: [
        ...(theirs ? [{value: 'source', label: `${sourceProject}'s - written for this picture`, hint: theirs.slice(0, 80)}] : []),
        {value: 'vision', label: 'Write it from the picture (vision-capable LLM)'},
        ...(ours ? [{value: 'keep', label: `Keep ${id}'s own`, hint: ours.slice(0, 80)}] : []),
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
    const anchor = sourceData.locationAnchors?.[sourceId]
    if (anchor && anchor !== data.locationAnchors?.[target.id]) {
        (data.locationAnchors ??= {})[target.id] = anchor
        changed.push('locationAnchors')
    }
    const layout = sourceData.locationLayouts?.[sourceId]
    if (layout && JSON.stringify(layout) !== JSON.stringify(data.locationLayouts?.[target.id])) {
        (data.locationLayouts ??= {})[target.id] = layout
        changed.push('locationLayouts')
    }
    if (anchor || layout) p.log.step(`Took ${[anchor && 'the background features', layout && 'the floor plan with its views'].filter(Boolean).join(' and ')} along from ${sourceProject}`)
}
if (changed.length) {
    await Bun.write(file, JSON.stringify(data, null, 2))
    p.log.success('Saved project.json')
}

// 4. what to look at: the character's prop, the story's pronouns, the plan and the clips made with the old pictures
if (target.kind === 'character' && description) {
    const character = data.cast!.characters.find(c => c.id === target.id)!
    const prop = pictureProp(character)
    if (prop && propMissing(description, prop)) p.log.warn(`The description does not name ${target.name}'s "${prop}" - the clips may show the picture's prop, or none.`)
    try {
        const settings = await loadSettings({projectModel: config.llm.model})
        configureLlm(settings.llm)
        const own = (data.beats ?? []).map(b => b.summary).filter(s => typeof s === 'string' && s.includes(target.name)).slice(0, 4).join(' ')
        const note = await genderNote(target.name, `${character.role ?? ''} ${own}`.trim().slice(0, 2500), description)
        if (note) p.log.warn(note)
    } catch {
        // the check is a courtesy: no language model connected, nothing to say
    }
}
const redo = redoAfter(changed, data)
if (redo.length) {
    p.log.warn(`The plan was made with the old description${changed.length > 1 ? 's' : ''} - to make it again with the new one:`)
    p.log.message(`bun index.ts ${id} --redo=${redo.join(',')}`)
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
    if (rendered.length) p.log.warn(`${rendered.length} rendered clip(s) show the old ${target.name}: ${rendered.join(', ')} - they count as stale now; --render=videos --refresh=clips renders them again.`)
}
p.outro('Done - nothing was rendered.')

// the picture described by a vision-capable model - its anchor (one view), else the picture itself, at a small size
async function fromPicture(): Promise<string | undefined> {
    const image = [join(dir, sheet, 'anchor.png'), join(dir, picture)].find(existsSync)
    if (!image) return undefined
    const settings = await loadSettings({projectModel: config.llm.model})
    configureLlm(settings.llm)
    const small = `${image}.vision.png`
    await runProcess(['ffmpeg', '-y', '-v', 'error', '-i', image, '-vf', 'scale=512:-1', small], {errorMessage: err => `ffmpeg could not downscale ${image}:\n${err}`})
    const url = `data:image/png;base64,${Buffer.from(await Bun.file(small).arrayBuffer()).toString('base64')}`
    rmSync(small, {force: true})
    p.log.step('Asking the vision model - can take a while')
    try {
        const character = data.cast?.characters.find(c => c.id === target.id)
        const text = (await ask(character ? characterImageDescriptionPrompt(url, character) : locationImageDescriptionPrompt(url, target.name))).trim()
        if (text) p.log.message(text)
        return text || undefined
    } catch (e) {
        p.log.warn(`The vision description failed - the connected model may not take images (${(e as Error).message})`)
        return undefined
    }
}

function hasMatch(project: string) {
    const other: Partial<Project> = existsSync(join(projectDir(project), 'project.json')) ? JSON.parse(readFileSync(join(projectDir(project), 'project.json'), 'utf8')) : {}
    const names = new Set(entries(other as Project).filter(e => e.kind === target.kind).map(e => e.name))
    return assetIds(projectDir(project), target.kind).includes(target.id) || names.has(target.name)
}

function fail(message: string): never {
    p.cancel(message)
    process.exit(1)
}

// cancelled with Ctrl+C / Esc
function answer<T>(value: T): Exclude<T, symbol> {
    if (p.isCancel(value)) {
        p.cancel('Cancelled')
        process.exit(1)
    }
    return value as Exclude<T, symbol>
}
