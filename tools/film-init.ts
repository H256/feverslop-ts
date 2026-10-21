import {cli} from '../lib/cli.ts';
import {log} from '../lib/log.ts';
// Creates a new short film: asks for a story idea or a screenplay (any language), a visual style and, if wanted, the
// film's settings - then writes films/<id>/ and prints the command to run it.
// usage: bun run film:init
import * as p from "@clack/prompts";
import {loadFilmConfig, filmDefaults, type FilmConfig} from "../lib/film/config.ts";
import {filmExists, writeFilm} from "../lib/film/setup.ts";
import {FILMS_DIR} from "../lib/film/store.ts";
import {languageName} from "../lib/config.ts";
import {styles} from "../lib/log.ts";
import {validProjectId} from "../lib/project-setup.ts";
import {answer, askResolution, askStyle, askText} from "../lib/wizard.ts";
cli('film:init')


if (!process.stdin.isTTY || !process.stdout.isTTY) {
    log.error(`No terminal to ask in - create ${FILMS_DIR}/<id>/input/ by hand instead:
  input/idea.txt          a story idea, in any language - developed into a screenplay
  input/screenplay.txt    or a screenplay, in any language - adopted as it is (wins if both exist)
  input/style.txt         optional visual style - see docs/style-examples.md
  config.json             optional - see docs/film.md`)
    process.exit(1)
}

log.section('feverslop-ts · new short film')

const id = answer(await p.text({
    message: 'Film id (used as the directory name)',
    placeholder: 'the-last-lighthouse',
    validate: value => {
        if (!value) return 'required'
        if (!validProjectId(value)) return 'lowercase letters, digits and "-" only'
        if (filmExists(value)) return `${FILMS_DIR}/${value} already exists`
    },
}))

const kind = answer(await p.select({
    message: 'What do you start from?',
    options: [
        {value: 'idea', label: 'A story idea', hint: 'the pipeline writes the characters, scenes and dialogue'},
        {value: 'screenplay', label: 'A screenplay', hint: 'adopted as it is - the dialogue is never reworded or translated'},
    ],
}))
const text = (await askText(kind === 'idea' ? 'Story idea (any language)' : 'Screenplay (any language)', {required: true}))!
const style = await askStyle()

const config: Partial<FilmConfig> = {}
if (kind === 'idea') {
    const duration = answer(await p.text({
        message: 'Target length in seconds',
        initialValue: String(filmDefaults.targetDuration),
        validate: value => Number(value) >= 10 || Number(value) === -1 ? undefined : 'at least 10, or -1 for as long as the story needs',
    }))
    if (Number(duration) !== filmDefaults.targetDuration) config.targetDuration = Number(duration)
} else {
    // a screenplay keeps its length unless a shorter film is asked for: the shots are then planned to it
    const duration = answer(await p.text({
        message: 'Plan the film to a length? (seconds - empty = as long as the screenplay needs)',
        placeholder: 'empty',
        initialValue: '',
        validate: value => !value || Number(value) >= 10 ? undefined : 'at least 10 seconds, or empty',
    }))
    if (duration) config.targetDuration = Number(duration)
}

const customize = answer(await p.confirm({message: 'Customize the film settings (language, resolution, ...)?', initialValue: false}))
if (customize) {
    if (kind === 'idea') {
        const language = answer(await p.text({
            message: 'Dialogue language (ISO 639-1 code, or "auto" for the language of the idea)',
            initialValue: filmDefaults.dialogueLanguage,
            validate: value => value === 'auto' || languageName(value ?? '') ? undefined : `unknown language code "${value}"`,
        }))
        if (language !== filmDefaults.dialogueLanguage) config.dialogueLanguage = language
    }
    config.imageResolution = await askResolution('Image resolution')
    config.videoResolution = await askResolution('Video resolution')
}

log.info(`Writing ${styles.muted(`${FILMS_DIR}/${id}/`)}`)
await writeFilm(id, {...(kind === 'idea' ? {idea: text} : {screenplay: text}), style, config})
// the file is checked once, here, so a typo in the written settings shows up now and not on the first run
await loadFilmConfig(`${FILMS_DIR}/${id}`)

log.output(`${FILMS_DIR}/${id}/`)
log.next(`bun film.ts ${id}`)
