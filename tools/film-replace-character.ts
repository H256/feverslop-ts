import {cli} from '../lib/cli.ts';
import {log} from '../lib/log.ts';
// Replaces a character's reference picture and description in an existing film - for swapping in your own art, a picture
// that came out wrong, or a character carried over from another project. The wizard asks for everything, clears whatever
// the render would otherwise consider stale (a sequence sheet's video, frames and composite, all built from the old
// anchor), lets a vision-capable LLM describe the new picture, names the clips that were rendered with the old one and
// offers to render the new sequence sheet right away. The film counterpart of tools/replace-character.ts.
// usage: bun run film:replace-character [film-id]
import * as p from "@clack/prompts";
import {existsSync} from "node:fs";
import {join} from "node:path";
import {loadFilmConfig} from "../lib/film/config.ts";
import {pictureAsset} from "../lib/compose.ts";
import {filmRenderConfig} from "../lib/film/pictures.ts";
import {FilmRenderer} from "../lib/film/render.ts";
import {filmDir, filmExists, plannedFilmIds} from "../lib/film/setup.ts";
import {FILMS_DIR} from "../lib/film/store.ts";
import type {FilmProject} from "../lib/film/types.ts";
import {genderNote} from "../lib/gender-check.ts";
import {mentions} from "../lib/film/names.ts";
import {configureLlm} from "../lib/llm.ts";
import {styles} from "../lib/log.ts";
import type {PictureJob} from "../lib/render.ts";
import {loadSettings} from "../lib/settings.ts";
import {answer as wizardAnswer} from "../lib/wizard.ts";
import {askDescription, clearSheetOfOldAnchor, installPicture, renderedClipsWith, replacedPictureFile} from "../lib/replace-character.ts";
cli('film:replace-character')


if (!process.stdin.isTTY || !process.stdout.isTTY) {
    log.error('This needs a terminal to ask in - usage: bun run film:replace-character [film-id]')
    process.exit(1)
}

log.section('feverslop-ts · replace a character of a film')

// what is already changed on disk - a cancel has to say so (see answer())
const changes: string[] = []
let sheetCleared = false

// a film given on the command line, else picked from the films that have been planned
const films = plannedFilmIds()
let id = Bun.argv[2]
if (id && !filmExists(id)) {
    log.cancel(`No film "${id}" in ${FILMS_DIR}/`)
    process.exit(1)
}
if (!id) {
    if (!films.length) {
        log.cancel(`No planned film in ${FILMS_DIR}/ yet - create one with: bun run film:init, then plan it: bun film.ts <film-id>`)
        process.exit(1)
    }
    id = films.length === 1 ? films[0]! : answer(await p.select({message: 'Film', options: films.map(f => ({value: f, label: f}))}))
}
const dir = filmDir(id)
const file = join(dir, 'project.json')
if (!existsSync(file)) {
    log.cancel(`${file} not found - plan the film first: bun film.ts ${id}`)
    process.exit(1)
}
const data: FilmProject = await Bun.file(file).json()
// a narrator who is never seen has no picture to replace
const characters = (data.cast?.characters ?? []).filter(c => !c.voiceOnly)
if (!characters.length) {
    log.cancel(`No characters with a picture in ${file} yet - plan the film first: bun film.ts ${id}`)
    process.exit(1)
}
log.info(`Film ${styles.name(id)}`)

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
const targetFile = replacedPictureFile(dir, char.id, config.sequenceSheets)
await installPicture(dir, char.id, targetFile, imagePath, changes)
// everything downstream of the anchor was built from the OLD image and is now stale
if (config.sequenceSheets) sheetCleared = clearSheetOfOldAnchor(dir, char.id, changes)

const configureFilmLlm = async () => configureLlm((await loadSettings({projectModel: config.llm.model})).llm)
const newDescription = await askDescription(targetFile, char, configureFilmLlm, answer)

if (newDescription) {
    data.characterDescriptions ??= {}
    data.characterDescriptions[char.id] = newDescription
    await Bun.write(file, JSON.stringify(data, null, 2))
    log.success('Saved the new description to project.json')
    changes.push('the new description is saved in project.json')

    // a picture of another gender than the script writes: the action lines say "she", the picture is a man (or the other way round)
    try {
        await configureFilmLlm()
        const own = (data.screenplay?.scenes ?? []).flatMap(s => s.elements).filter(e => e.type === 'action' && mentions(e.text, char)).map(e => e.text).slice(0, 4).join(' ')
        const note = await genderNote(char.name, `${char.role} ${char.appearance} ${own}`.trim().slice(0, 2500), newDescription, 'script')
        if (note) {
            log.warn(note)
            log.info(styles.muted(`Edit the action lines of ${char.name} in films/${id}/project.json (screenplay) and plan the shots again (bun film.ts ${id} --redo=coverage); for a story written from an idea, put the gender into the idea.`))
        }
    } catch {
        // the check is a courtesy: no language model connected, nothing to say
    }
}
const description = newDescription ?? data.characterDescriptions?.[char.id] ?? ''

// clips already rendered before this swap are not touched - list them instead of guessing whether to redo them
const affected = await renderedClipsWith(dir, char.id)
if (affected.length) {
    log.warn(`${affected.length} already-rendered clip(s) show ${char.name} and were not touched: ${affected.join(', ')}`)
    log.info('Delete the ones you want redone (videos/<clip-id>.mp4 and its .json) and render again: bun film.ts ' + id + ' --render=videos')
}

if (config.sequenceSheets) {
    const renderNow = answer(await p.confirm({message: 'Render the new reference sheet now?', initialValue: true}))
    if (renderNow) {
        const settings = await loadSettings({projectModel: config.llm.model})
        using renderer = new FilmRenderer(`film-${id}`, dir, filmRenderConfig(config), settings.comfy)
        const picture: PictureJob = {
            kind: 'character', id: char.id, file: pictureAsset('character', char.id), name: char.name,
            // the prompt only makes the anchor image, which was supplied here - never read
            prompt: '',
            description,
        }
        await renderer.renderSequenceSheet(picture)
        log.success(`Done - ${picture.file} rendered.`)
    } else {
        log.success(`Done - run "bun film.ts ${id} --render=images" later to render the new sequence sheet.`)
    }
} else {
    log.success('Done.')
}

// cancelled with Ctrl+C / Esc
function answer<T>(value: T) {
    return wizardAnswer(value, changes.length
            ? `Cancelled - already changed: ${changes.join('; ')}.${sheetCleared ? ` Render the new reference sheet with: bun film.ts ${id} --render=images` : ''}`
            : 'Cancelled - nothing was changed')
}
