// Replaces a character's (or one group member's) reference image and description in an existing project - for
// swapping in your own art, or carrying a character over from an earlier project. Clears whatever the render
// pipeline would otherwise consider stale (a sequence sheet's video/frames/composite, all built from the old
// anchor image), lets you regenerate the description from the new image with a vision-capable LLM, and offers to
// render the new sequence sheet right away.
// usage: bun run replace-character <project-id>
import * as p from "@clack/prompts";
import {existsSync, mkdirSync, readdirSync, renameSync, rmSync} from "node:fs";
import {dirname, join} from "node:path";
import {computeMemberCounts, groupMemberId, pictureAsset} from "../lib/compose.ts";
import {loadProjectConfig} from "../lib/config.ts";
import {ask, configureLlm} from "../lib/llm.ts";
import {printBanner, styles} from "../lib/log.ts";
import {runProcess} from "../lib/process.ts";
import {characterImageDescriptionPrompt} from "../lib/prompts.ts";
import {projectDir, projectExists} from "../lib/project-setup.ts";
import type {Character, Project} from "../lib/project.ts";
import {type PictureJob, Renderer} from "../lib/render.ts";
import {loadSettings} from "../lib/settings.ts";

if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('This needs a terminal to ask in - usage: bun run replace-character <project-id>')
    process.exit(1)
}

const [id] = Bun.argv.slice(2)
if (!id || !projectExists(id)) {
    console.error(`usage: bun run replace-character <project-id>${id ? `\nprojects/${id} does not exist` : ''}`)
    process.exit(1)
}
const dir = projectDir(id)
const file = join(dir, 'project.json')
if (!existsSync(file)) {
    console.error(`${file} not found - plan the project first: bun index.ts ${id}`)
    process.exit(1)
}
const data: Project = await Bun.file(file).json()
const characters = data.cast?.characters ?? []
if (!characters.length) {
    console.error(`No characters in projects/${id}/project.json yet - plan the project first: bun index.ts ${id}`)
    process.exit(1)
}

printBanner()
p.intro(`feverslop-ts · replace character · ${id}`)

const charId = answer(await p.select({
    message: 'Character to replace',
    options: characters.map(c => ({value: c.id, label: `${c.name} ${styles.muted(`(${c.id})${c.isGroup ? ' · group' : ''}`)}`})),
}))
const char = characters.find(c => c.id === charId)! as Character

const memberCounts = computeMemberCounts(data.beats ?? [], characters)
const memberCount = memberCounts[char.id] ?? 1
let member = 0
if (memberCount > 1) {
    member = Number(answer(await p.select({
        message: `${char.name} is a group with ${memberCount} member variants - which one?`,
        options: Array.from({length: memberCount}, (_, i) => ({value: String(i), label: `Member ${i + 1} ${styles.muted(`(${groupMemberId(char.id, i)})`)}`})),
    })))
}
const assetId = memberCount > 1 ? groupMemberId(char.id, member) : char.id

const imagePath = answer(await p.text({
    message: 'Path to the new reference image',
    validate: value => {
        if (!value) return 'required'
        if (!existsSync(value)) return 'file not found'
    },
}))

const config = await loadProjectConfig(dir)
const targetFile = config.sequenceSheets
    ? join(dir, 'assets', 'sequence', 'characters', assetId, 'anchor.png')
    : join(dir, pictureAsset('character', assetId))

mkdirSync(dirname(targetFile), {recursive: true})
const partial = `${targetFile}.partial.png`
// ffmpeg reads whatever format was given and normalizes it to the plain PNG every path here expects
await runProcess(['ffmpeg', '-y', '-v', 'error', '-i', imagePath, '-frames:v', '1', partial], {
    errorMessage: err => `ffmpeg could not read ${imagePath} as an image:\n${err}`,
})
renameSync(partial, targetFile)
p.log.success(`Saved ${targetFile}`)

// everything downstream of the anchor was built from the OLD image and is now stale
if (config.sequenceSheets) {
    const seqDir = join(dir, 'assets', 'sequence', 'characters', assetId)
    const finalPicture = join(dir, pictureAsset('character', assetId))
    const stale = [
        finalPicture, `${finalPicture}.json`,
        join(seqDir, 'sequence.mp4'), join(seqDir, 'sequence.mp4.json'), join(seqDir, 'sequence.mp4.pending.json'),
        join(seqDir, 'frames'),
    ]
    const removed = stale.filter(existsSync)
    for (const f of removed) rmSync(f, {recursive: true, force: true})
    if (removed.length) p.log.step(`Cleared ${removed.length} file(s)/folder(s) built from the old anchor`)
}

const descMode = answer(await p.select({
    message: 'Update the description used in clip/video prompts?',
    options: [
        {value: 'vision', label: 'Generate it from the image (vision-capable LLM)'},
        {value: 'manual', label: 'Type it myself'},
        {value: 'skip', label: 'Leave the current description unchanged'},
    ],
}))

let newDescription: string | undefined
if (descMode === 'vision') {
    const settings = await loadSettings({projectModel: config.llm.model})
    configureLlm(settings.llm)
    // full-resolution reference pictures (e.g. 1088x1920) made a real local vision model hang for minutes on a
    // single request - a description doesn't need that much detail, and a small side (VISION_MAX_WIDTH) came back
    // in ~25s instead. Downscaled into a temp file - the saved anchor itself stays full resolution.
    const VISION_MAX_WIDTH = 512
    const downscaled = `${targetFile}.vision.png`
    await runProcess(['ffmpeg', '-y', '-v', 'error', '-i', targetFile, '-vf', `scale=${VISION_MAX_WIDTH}:-1`, downscaled], {
        errorMessage: err => `ffmpeg could not downscale ${targetFile} for the vision request:\n${err}`,
    })
    const base64 = Buffer.from(await Bun.file(downscaled).arrayBuffer()).toString('base64')
    rmSync(downscaled, {force: true})
    p.log.step('Asking the vision model - can take a while, see the spinner below')
    try {
        newDescription = (await ask(characterImageDescriptionPrompt(`data:image/png;base64,${base64}`, char))).trim() || undefined
        if (newDescription) {
            p.log.success('Description generated from the image:')
            p.log.message(newDescription)
        }
    } catch (e) {
        p.log.warn(`Vision description failed - the connected model may not support images (${(e as Error).message})`)
    }
    if (!newDescription) {
        const typed = answer(await p.text({message: 'Type a description instead (leave empty to keep the current one)'}))
        newDescription = typed || undefined
    }
} else if (descMode === 'manual') {
    const typed = answer(await p.text({message: 'New description (leave empty to keep the current one)'}))
    newDescription = typed || undefined
}

if (newDescription) {
    if (memberCount > 1) {
        data.characterDescriptionVariants ??= {}
        const list = data.characterDescriptionVariants[char.id] ??= Array.from({length: memberCount}, () => data.characterDescriptions?.[char.id] ?? '')
        list[member] = newDescription
    } else {
        data.characterDescriptions ??= {}
        data.characterDescriptions[char.id] = newDescription
    }
    await Bun.write(file, JSON.stringify(data, null, 2))
    p.log.success('Saved the new description to project.json')
}

const description = newDescription
    ?? (memberCount > 1 ? data.characterDescriptionVariants?.[char.id]?.[member] : data.characterDescriptions?.[char.id])
    ?? ''

// clips already rendered before this swap are not touched - list them instead of guessing whether to redo them
const clipsDir = join(dir, 'output', 'clips')
if (existsSync(clipsDir)) {
    const affected: string[] = []
    for (const entry of readdirSync(clipsDir)) {
        if (!entry.endsWith('.json')) continue
        const clip = await Bun.file(join(clipsDir, entry)).json()
        const slotId = entry.replace(/\.json$/, '')
        if (clip.assets?.pictures?.some((pic: { id: string }) => pic.id === char.id) && existsSync(join(dir, 'videos', `${slotId}.mp4`))) {
            affected.push(slotId)
        }
    }
    if (affected.length) {
        p.log.warn(`${affected.length} already-rendered clip(s) reference ${char.name} and were not touched: ${affected.join(', ')}`)
        p.log.message(`Delete the ones you want redone (videos/<clip-id>.mp4, its .json) and render again.`)
    }
}

if (config.sequenceSheets) {
    const renderNow = answer(await p.confirm({message: 'Render the new reference sheet now?', initialValue: true}))
    if (renderNow) {
        const settings = await loadSettings({projectModel: config.llm.model})
        using renderer = new Renderer(id, dir, config, settings.comfy)
        const picture: PictureJob = {
            kind: 'character', id: assetId, file: pictureAsset('character', assetId), name: char.name,
            // prompt is only used to (re)generate the anchor image, which we just supplied ourselves - never read here
            prompt: '',
            description,
        }
        await renderer.renderSequenceSheet(picture)
        p.outro(`Done - ${picture.file} rendered.`)
    } else {
        p.outro(`Done - run "bun index.ts ${id} --render=images" later to render the new sequence sheet.`)
    }
} else {
    p.outro('Done.')
}

// cancelled with Ctrl+C / Esc
function answer<T>(value: T): Exclude<T, symbol> {
    if (p.isCancel(value)) {
        p.cancel('Cancelled - nothing further was changed')
        process.exit(1)
    }
    return value as Exclude<T, symbol>
}
