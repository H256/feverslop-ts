// A new library character or place from a picture - no project needed: the picture becomes the anchor, a vision-capable
// model (or you) describes it, a place also gets its background features and floor plan, and ComfyUI renders the
// reference sheet from it. The result goes into the asset library (lib/library.ts) - an existing asset is never
// overwritten. Any project then takes it with import-asset or casting.json.
// usage: bun run create-asset <character|location> <library id> --anchor=<picture> [--name=…] [--role=…] [--description=…] [--like=<project>]
import * as p from "@clack/prompts";
import {existsSync, mkdirSync, renameSync, rmSync, writeFileSync} from "node:fs";
import {basename, dirname, join} from "node:path";
import {type AssetKind, assetPaths, copyAsset} from "../lib/asset-import.ts";
import {pictureAsset} from "../lib/compose.ts";
import {loadProjectConfig} from "../lib/config.ts";
import {describePicture} from "../lib/describe-picture.ts";
import {libraryDir, libraryFolder, libraryIdPattern, libraryLayout, readLibraryAsset, writeLibraryAsset} from "../lib/library.ts";
import {ask, askJson, configureLlm} from "../lib/llm.ts";
import {runProcess} from "../lib/process.ts";
import {locationAnchorPrompt, locationLayoutPrompt} from "../lib/prompts.ts";
import {projectDir, projectExists} from "../lib/project-setup.ts";
import type {LocationLayout} from "../lib/project.ts";
import {pinnedSidecar} from "../lib/provenance.ts";
import {Renderer} from "../lib/render.ts";
import {LOCATION_VIEWS} from "../lib/sequenceSheet.ts";
import {loadSettings} from "../lib/settings.ts";

const usage = 'usage: bun run create-asset <character|location> <library id> --anchor=<picture> [--name=…] [--role=…] [--description=…] [--like=<project>]'
const args = Bun.argv.slice(2)
const flag = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const [kindArg, id] = args.filter(a => !a.startsWith('--'))
const interactive = !!process.stdin.isTTY && !!process.stdout.isTTY
const fail = (message: string): never => {
    if (interactive) p.cancel(message)
    else console.error(message)
    process.exit(1)
}
const kind: AssetKind = kindArg === 'character' || kindArg === 'location' ? kindArg : fail(usage)
if (!id || !libraryIdPattern.test(id)) fail(`${usage}\nThe library id: lowercase letters, digits and dashes`)
const anchorPicture = flag('anchor') ?? fail(`${usage}\n--anchor=<picture> is the picture the asset is made from`)
if (!existsSync(anchorPicture)) fail(`${anchorPicture} not found`)
const like = flag('like')
if (like && !projectExists(like)) fail(`projects/${like} does not exist`)

const library = await libraryDir()
if (await readLibraryAsset(library, kind, id!)) fail(`The library already has a ${kind} "${id}" (${join(library, libraryFolder(kind, id!))}) - it is never overwritten; choose another id`)
const name = flag('name') ?? id!.split('-').map(w => w[0]!.toUpperCase() + w.slice(1)).join(' ')
const role = flag('role') ?? (kind === 'character' ? 'a character' : '')

if (interactive) p.intro(`feverslop-ts · create asset · ${kind} ${id}`)
const say = (message: string) => interactive ? p.log.step(message) : console.log(message)

// the render settings: those of a project given with --like, else the defaults
const config = await loadProjectConfig(like ? projectDir(like) : join(library, '.none'))
const settings = await loadSettings({projectModel: config.llm.model})
configureLlm(settings.llm)

// a project-shaped work folder: the renderer makes the sheet where a project has it, the result then goes into the library
const work = join(library, '.work', `${kind}-${id}`)
rmSync(work, {recursive: true, force: true})
const {sheet} = assetPaths(kind, id!)
const anchor = join(work, sheet, 'anchor.png')
mkdirSync(dirname(anchor), {recursive: true})
// ffmpeg reads whatever format was given and writes the plain PNG every path here expects
await runProcess(['ffmpeg', '-y', '-v', 'error', '-i', anchorPicture, '-frames:v', '1', `${anchor}.partial.png`], {errorMessage: err => `ffmpeg could not read ${anchorPicture} as a picture:\n${err}`})
renameSync(`${anchor}.partial.png`, anchor)
// the user's picture: the sheet is made from it as it is (lib/render.ts)
writeFileSync(`${anchor}.json`, JSON.stringify(pinnedSidecar(`made from ${basename(anchorPicture)}`), null, 2))

// the description: given, or written from the picture - shown and editable before it is kept
let description = flag('description')
if (!description) {
    say('Describing the picture with the vision model - can take a while')
    try {
        description = await describePicture(anchor, kind === 'character' ? {kind, name, role} : {kind, name})
    } catch (e) {
        if (!interactive) fail(`The vision description failed (${(e as Error).message}) - give one with --description=…`)
        p.log.warn(`The vision description failed - the connected model may not take images (${(e as Error).message})`)
    }
    if (interactive) description = answer(await p.text({message: 'Description used in the clip prompts', initialValue: description ?? '', validate: v => v?.trim() ? undefined : 'required'})).trim()
    else if (description) console.log(description)
}
if (!description) fail('No description - give one with --description=…')

// a place: the fixed features behind the people and its floor plan with what each view of the sheet shows - as a project writes them
let anchors: string | undefined
let layout: LocationLayout | undefined
if (kind === 'location') {
    say('Naming the background features and laying out the place')
    anchors = (await ask(locationAnchorPrompt(description!))).replace(/^["']|["'.\s]+$/g, '') || undefined
    const answerJson = await askJson<{ layout?: unknown, views?: unknown[] }>(locationLayoutPrompt(name, description!, description!)).catch(() => undefined)
    if (answerJson?.layout) layout = {layout: String(answerJson.layout).trim(), views: LOCATION_VIEWS.map((_, n) => String(answerJson.views?.[n] ?? '').trim())}
    else say('No usable floor plan - the projects lay the place out themselves')
}

// the reference sheet: sequence video, frames and picture, rendered from the anchor
say('Rendering the reference sheet')
{
    using renderer = new Renderer(`library-${id}`, work, config, settings.comfy)
    await renderer.renderSequenceSheet({kind, id: id!, name, file: pictureAsset(kind, id!), prompt: '', description: description!, ...(layout ? {views: layout.views} : {})})
}

const {copied} = copyAsset({dir: work, layout: assetPaths(kind, id!), label: `create-asset ${basename(anchorPicture)}`}, {dir: library, layout: libraryLayout(kind, id!), archiveName: id!})
writeLibraryAsset(library, {
    kind, id: id!, name, description: description!,
    ...(anchors ? {anchors} : {}), ...(layout ? {layout} : {}),
    source: `picture ${basename(anchorPicture)}`,
    created: new Date().toISOString().slice(0, 10),
})
rmSync(work, {recursive: true, force: true})
const done = `${name} is in the library as ${kind} "${id}" (${copied} files): ${join(library, libraryFolder(kind, id!))} - take it into a project with: bun run import-asset <project-id> <id there> --from=library:${id}`
if (interactive) p.outro(done)
else console.log(done)

// cancelled with Ctrl+C / Esc - the work folder stays, the next run starts it again
function answer<T>(value: T): Exclude<T, symbol> {
    if (p.isCancel(value)) {
        p.cancel('Cancelled - nothing is in the library')
        process.exit(1)
    }
    return value as Exclude<T, symbol>
}
