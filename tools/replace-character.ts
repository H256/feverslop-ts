import {cli} from '../lib/cli.ts';
import {log} from '../lib/log.ts';
// Replaces a character's (or one group member's) reference image and description in an existing project - for
// swapping in your own art, or carrying a character over from an earlier project. Clears whatever the render
// pipeline would otherwise consider stale (a sequence sheet's video/frames/composite, all built from the old
// anchor image), lets you regenerate the description from the new image with a vision-capable LLM, and offers to
// render the new sequence sheet right away.
// usage: bun run replace-character <project-id>
import * as p from "@clack/prompts";
import {existsSync} from "node:fs";
import {join} from "node:path";
import {computeMemberCounts, groupMemberId, pictureAsset} from "../lib/compose.ts";
import {loadProjectConfig} from "../lib/config.ts";
import {configureLlm} from "../lib/llm.ts";
import {styles} from "../lib/log.ts";
import {genderNote} from "../lib/gender-check.ts";
import {projectDir, projectExists} from "../lib/project-setup.ts";
import {ProjectStore, type Character} from "../lib/project.ts";
import {lockProject} from "../lib/lock.ts";
import {type PictureJob, Renderer} from "../lib/render.ts";
import {loadSettings} from "../lib/settings.ts";
import {answer as wizardAnswer} from "../lib/wizard.ts";
import {askDescription, clearSheetOfOldAnchor, installPicture, renderedClipsWith, replacedPictureFile} from "../lib/replace-character.ts";
cli('replace-character')


if (!process.stdin.isTTY || !process.stdout.isTTY) {
    log.error('This needs a terminal to ask in - usage: bun run replace-character <project-id>')
    process.exit(1)
}

const [id] = Bun.argv.slice(2)
if (!id || !projectExists(id)) {
    log.error(`usage: bun run replace-character <project-id>${id ? `\nprojects/${id} does not exist` : ''}`)
    process.exit(1)
}
const dir = projectDir(id)
const file = join(dir, 'project.json')
if (!existsSync(file)) {
    log.error(`${file} not found - plan the project first: bun index.ts ${id}`)
    process.exit(1)
}
lockProject(dir, id)
const store = new ProjectStore(id)
await store.load()
const data = store.data
const characters = data.cast?.characters ?? []
if (!characters.length) {
    log.error(`No characters in projects/${id}/project.json yet - plan the project first: bun index.ts ${id}`)
    process.exit(1)
}

log.section(`feverslop-ts · replace character · ${id}`)

// what is already changed on disk - a cancel has to say so (see answer())
const changes: string[] = []
let sheetCleared = false

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
const targetFile = replacedPictureFile(dir, assetId, config.sequenceSheets)
await installPicture(dir, assetId, targetFile, imagePath, changes)
// everything downstream of the anchor was built from the OLD image and is now stale
if (config.sequenceSheets) sheetCleared = clearSheetOfOldAnchor(dir, assetId, changes)

const configureProjectLlm = async () => configureLlm((await loadSettings({projectModel: config.llm.model})).llm)
const newDescription = await askDescription(targetFile, char, configureProjectLlm, answer)

if (newDescription) {
    if (memberCount > 1) {
        data.characterDescriptionVariants ??= {}
        const list = data.characterDescriptionVariants[char.id] ??= Array.from({length: memberCount}, () => data.characterDescriptions?.[char.id] ?? '')
        list[member] = newDescription
    } else {
        data.characterDescriptions ??= {}
        data.characterDescriptions[char.id] = newDescription
    }
    await store.save()
    log.success('Saved the new description to project.json')
    changes.push('the new description is saved in project.json')

    // a picture of another gender than the story writes: the beats say "she", the picture is a man (or the other way round)
    try {
        await configureProjectLlm()
        const own = (data.beats ?? []).map(b => b.summary).filter(s => typeof s === 'string' && s.includes(char.name)).slice(0, 4).join(' ')
        const note = await genderNote(char.name, `${char.role ?? ''} ${own}`.trim().slice(0, 2500), newDescription)
        if (note) {
            log.warn(note)
            log.info(styles.muted(`To have the story follow the picture: set "singerVoice" in projects/${id}/config.json ("male" or "female") and redo it (bun index.ts ${id} --redo=story) - everything built on the story is made again - or edit the beats in project.json by hand.`))
        }
    } catch {
        // the check is a courtesy: no language model connected, nothing to say
    }
}

const description = newDescription
    ?? (memberCount > 1 ? data.characterDescriptionVariants?.[char.id]?.[member] : data.characterDescriptions?.[char.id])
    ?? ''

// clips already rendered before this swap are not touched - list them instead of guessing whether to redo them
const affected = await renderedClipsWith(dir, char.id)
if (affected.length) {
    log.warn(`${affected.length} already-rendered clip(s) reference ${char.name} and were not touched: ${affected.join(', ')}`)
    log.info(`Delete the ones you want redone (videos/<clip-id>.mp4, its .json) and render again.`)
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
        log.success(`Done - ${picture.file} rendered.`)
    } else {
        log.success(`Done - run "bun index.ts ${id} --render=images" later to render the new sequence sheet.`)
    }
} else {
    log.success('Done.')
}

// cancelled with Ctrl+C / Esc
function answer<T>(value: T) {
    return wizardAnswer(value, changes.length
            ? `Cancelled - already changed: ${changes.join('; ')}.${sheetCleared ? ` Render the new reference sheet with: bun index.ts ${id} --render=images` : ''}`
            : 'Cancelled - nothing was changed')
}
