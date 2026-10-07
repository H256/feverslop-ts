// Replaces a character's reference picture and description in an existing film - for swapping in your own art, a picture
// that came out wrong, or a character carried over from another project. The wizard asks for everything, clears whatever
// the render would otherwise consider stale (a sequence sheet's video, frames and composite, all built from the old
// anchor), lets a vision-capable LLM describe the new picture, names the clips that were rendered with the old one and
// offers to render the new sequence sheet right away. The film counterpart of tools/replace-character.ts.
// usage: bun run film:replace-character [film-id]
import * as p from "@clack/prompts";
import {existsSync, mkdirSync, readdirSync, renameSync, rmSync} from "node:fs";
import {dirname, join} from "node:path";
import {loadFilmConfig} from "../lib/film/config.ts";
import {filmPictureAsset, filmRenderConfig} from "../lib/film/pictures.ts";
import {FilmRenderer} from "../lib/film/render.ts";
import {filmDir, filmExists} from "../lib/film/setup.ts";
import {FILMS_DIR} from "../lib/film/store.ts";
import type {FilmProject} from "../lib/film/types.ts";
import {genderNote} from "../lib/film/gender-check.ts";
import {mentions} from "../lib/film/names.ts";
import {ask, configureLlm} from "../lib/llm.ts";
import {printBanner, styles} from "../lib/log.ts";
import {runProcess} from "../lib/process.ts";
import {characterImageDescriptionPrompt} from "../lib/prompts.ts";
import type {PictureJob} from "../lib/render.ts";
import {loadSettings} from "../lib/settings.ts";

if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('This needs a terminal to ask in - usage: bun run film:replace-character [film-id]')
    process.exit(1)
}

printBanner()
p.intro('feverslop-ts · replace a character of a film')

// what is already changed on disk - a cancel has to say so (see answer())
const changes: string[] = []
let sheetCleared = false

// a film given on the command line, else picked from the films that have been planned
const films = existsSync(FILMS_DIR)
    ? readdirSync(FILMS_DIR, {withFileTypes: true}).filter(d => d.isDirectory() && existsSync(join(FILMS_DIR, d.name, 'project.json'))).map(d => d.name)
    : []
let id = Bun.argv[2]
if (id && !filmExists(id)) {
    p.cancel(`No film "${id}" in ${FILMS_DIR}/`)
    process.exit(1)
}
if (!id) {
    if (!films.length) {
        p.cancel(`No planned film in ${FILMS_DIR}/ yet - create one with: bun run film:init, then plan it: bun film.ts <film-id>`)
        process.exit(1)
    }
    id = films.length === 1 ? films[0]! : answer(await p.select({message: 'Film', options: films.map(f => ({value: f, label: f}))}))
}
const dir = filmDir(id)
const file = join(dir, 'project.json')
if (!existsSync(file)) {
    p.cancel(`${file} not found - plan the film first: bun film.ts ${id}`)
    process.exit(1)
}
const data: FilmProject = await Bun.file(file).json()
// a narrator who is never seen has no picture to replace
const characters = (data.cast?.characters ?? []).filter(c => !c.voiceOnly)
if (!characters.length) {
    p.cancel(`No characters with a picture in ${file} yet - plan the film first: bun film.ts ${id}`)
    process.exit(1)
}
p.log.step(`Film ${styles.name(id)}`)

const charId = answer(await p.select({
    message: 'Character to replace',
    options: characters.map(c => ({value: c.id, label: `${c.name} ${styles.muted(`(${c.id})`)}`})),
}))
const char = characters.find(c => c.id === charId)!

const imagePath = answer(await p.text({
    message: 'Path to the new reference image (any image format)',
    validate: value => {
        if (!value) return 'required'
        if (!existsSync(value)) return 'file not found'
    },
}))

const config = await loadFilmConfig(dir)
const finalPicture = join(dir, filmPictureAsset('character', char.id))
// with sequence sheets the picture the clips use is made from the anchor - the new image is the anchor then
const targetFile = config.sequenceSheets
    ? join(dir, 'assets', 'sequence', 'characters', char.id, 'anchor.png')
    : finalPicture

// the picture that is replaced is kept next to it, in old/ - one wrong click doesn't lose it
if (existsSync(targetFile)) {
    const keep = join(dir, 'old', `${char.id}-${Date.now()}.png`)
    mkdirSync(dirname(keep), {recursive: true})
    renameSync(targetFile, keep)
    p.log.step(`The old picture is kept: ${keep}`)
    changes.push(`the old picture is kept as ${keep}`)
}
mkdirSync(dirname(targetFile), {recursive: true})
const partial = `${targetFile}.partial.png`
// ffmpeg reads whatever format was given and normalizes it to the plain PNG every path here expects
await runProcess(['ffmpeg', '-y', '-v', 'error', '-i', imagePath, '-frames:v', '1', partial], {
    errorMessage: err => `ffmpeg could not read ${imagePath} as an image:\n${err}`,
})
renameSync(partial, targetFile)
p.log.success(`Saved ${targetFile}`)
changes.push(`the new image is saved as ${targetFile}`)

// everything downstream of the anchor was built from the OLD image and is now stale
if (config.sequenceSheets) {
    const seqDir = join(dir, 'assets', 'sequence', 'characters', char.id)
    const stale = [
        finalPicture, `${finalPicture}.json`,
        join(seqDir, 'sequence.mp4'), join(seqDir, 'sequence.mp4.json'), join(seqDir, 'sequence.mp4.pending.json'),
        join(seqDir, 'frames'),
    ]
    const removed = stale.filter(existsSync)
    for (const f of removed) rmSync(f, {recursive: true, force: true})
    if (removed.length) {
        p.log.step(`Cleared ${removed.length} file(s)/folder(s) built from the old anchor`)
        changes.push('the old reference sheet and sequence video were deleted')
        sheetCleared = true
    }
}

const descMode = answer(await p.select({
    message: 'Update the description used in the clip prompts?',
    options: [
        {value: 'vision', label: 'Generate it from the image (vision-capable LLM)', hint: 'recommended'},
        {value: 'manual', label: 'Type it myself'},
        {value: 'skip', label: 'Leave the current description unchanged'},
    ],
}))

let newDescription: string | undefined
if (descMode === 'vision') {
    const settings = await loadSettings({projectModel: config.llm.model})
    configureLlm(settings.llm)
    // a full-resolution picture can make a local vision model hang for minutes on a single request - a description doesn't need
    // that much detail. Downscaled into a temp file - the saved picture itself stays as it is.
    const VISION_MAX_WIDTH = 512
    const downscaled = `${targetFile}.vision.png`
    await runProcess(['ffmpeg', '-y', '-v', 'error', '-i', targetFile, '-vf', `scale=${VISION_MAX_WIDTH}:-1`, downscaled], {
        errorMessage: err => `ffmpeg could not downscale ${targetFile} for the vision request:\n${err}`,
    })
    const base64 = Buffer.from(await Bun.file(downscaled).arrayBuffer()).toString('base64')
    rmSync(downscaled, {force: true})
    p.log.step('Asking the vision model - can take a while')
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
    data.characterDescriptions ??= {}
    data.characterDescriptions[char.id] = newDescription
    await Bun.write(file, JSON.stringify(data, null, 2))
    p.log.success('Saved the new description to project.json')
    changes.push('the new description is saved in project.json')

    // a picture of another gender than the script writes: the action lines say "she", the picture is a man (or the other way round)
    try {
        const settings = await loadSettings({projectModel: config.llm.model})
        configureLlm(settings.llm)
        const own = (data.screenplay?.scenes ?? []).flatMap(s => s.elements).filter(e => e.type === 'action' && mentions(e.text, char)).map(e => e.text).slice(0, 4).join(' ')
        const note = await genderNote(char.name, `${char.role} ${char.appearance} ${own}`.trim().slice(0, 2500), newDescription)
        if (note) {
            p.log.warn(note)
            p.log.message(styles.muted(`Edit the action lines of ${char.name} in films/${id}/project.json (screenplay) and plan the shots again (bun film.ts ${id} --redo=coverage); for a story written from an idea, put the gender into the idea.`))
        }
    } catch {
        // the check is a courtesy: no language model connected, nothing to say
    }
}
const description = newDescription ?? data.characterDescriptions?.[char.id] ?? ''

// clips already rendered before this swap are not touched - list them instead of guessing whether to redo them
const clipsDir = join(dir, 'output', 'clips')
if (existsSync(clipsDir)) {
    const affected: string[] = []
    for (const entry of readdirSync(clipsDir)) {
        if (!entry.endsWith('.json')) continue
        const clip = await Bun.file(join(clipsDir, entry)).json()
        const clipId = entry.replace(/\.json$/, '')
        if (clip.assets?.pictures?.some((pic: { id: string }) => pic.id === char.id) && existsSync(join(dir, 'videos', `${clipId}.mp4`))) affected.push(clipId)
    }
    if (affected.length) {
        p.log.warn(`${affected.length} already-rendered clip(s) show ${char.name} and were not touched: ${affected.join(', ')}`)
        p.log.message('Delete the ones you want redone (videos/<clip-id>.mp4 and its .json) and render again: bun film.ts ' + id + ' --render=videos')
    }
}

if (config.sequenceSheets) {
    const renderNow = answer(await p.confirm({message: 'Render the new reference sheet now?', initialValue: true}))
    if (renderNow) {
        const settings = await loadSettings({projectModel: config.llm.model})
        using renderer = new FilmRenderer(`film-${id}`, dir, filmRenderConfig(config), settings.comfy)
        const picture: PictureJob = {
            kind: 'character', id: char.id, file: filmPictureAsset('character', char.id), name: char.name,
            // the prompt only makes the anchor image, which was supplied here - never read
            prompt: '',
            description,
        }
        await renderer.renderSequenceSheet(picture)
        p.outro(`Done - ${picture.file} rendered.`)
    } else {
        p.outro(`Done - run "bun film.ts ${id} --render=images" later to render the new sequence sheet.`)
    }
} else {
    p.outro('Done.')
}

// cancelled with Ctrl+C / Esc
function answer<T>(value: T): Exclude<T, symbol> {
    if (p.isCancel(value)) {
        p.cancel(changes.length
            ? `Cancelled - already changed: ${changes.join('; ')}.${sheetCleared ? ` Render the new reference sheet with: bun film.ts ${id} --render=images` : ''}`
            : 'Cancelled - nothing was changed')
        process.exit(1)
    }
    return value as Exclude<T, symbol>
}
