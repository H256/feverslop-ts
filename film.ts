// The short-film pipeline: a story idea or a screenplay (any language) -> screenplay, cast, locations.
// Separate from the music-video pipeline (index.ts) - it shares the LLM client, the settings and the helpers, nothing else.
// usage: bun film.ts <film-id> [--redo=screenplay,cast]
import {existsSync, readdirSync} from "node:fs";
import {join} from "node:path";
import {parseArgs} from "node:util";
import {languageName} from "./lib/config.ts";
import {loadFilmConfig} from "./lib/film/config.ts";
import {screenplayToFountain} from "./lib/film/fountain.ts";
import {briefPrompt, castPrompt, outlinePrompt, screenplayParsePrompt, screenplayWritePrompt, summaryPrompt} from "./lib/film/prompts.ts";
import {estimateSeconds, missingDialogue, toCast, toScreenplay} from "./lib/film/screenplay.ts";
import {filmExists} from "./lib/film/setup.ts";
import {FILM_STEP_NAMES, FILMS_DIR, FilmStore, type FilmStepName} from "./lib/film/store.ts";
import type {Brief, FilmMode, Outline} from "./lib/film/types.ts";
import {askJson, ask, configureLlm} from "./lib/llm.ts";
import {log, printBanner, styles} from "./lib/log.ts";
import {validProjectId} from "./lib/project-setup.ts";
import {loadSettings} from "./lib/settings.ts";

process.on('unhandledRejection', e => log.fatal(e instanceof Error ? e.message : String(e)))
process.on('uncaughtException', e => log.fatal(e instanceof Error ? e.message : String(e)))

printBanner()

const usage = `bun film.ts <film-id> [--redo=screenplay,cast] [--llm-url=…] [--llm-key=…] [--llm-model=…]
steps: ${FILM_STEP_NAMES.join(', ')}`
const {values: args, positionals} = (() => {
    try {
        return parseArgs({
            args: Bun.argv.slice(2),
            allowPositionals: true,
            options: {
                redo: {type: 'string', default: ''},
                'llm-url': {type: 'string'},
                'llm-key': {type: 'string'},
                'llm-model': {type: 'string'},
            },
        })
    } catch (e) {
        return log.usageError(e instanceof Error ? e.message : String(e), usage)
    }
})()
const redoSteps = args.redo.split(',').filter(Boolean) as FilmStepName[]
const unknownRedo = redoSteps.filter(s => !(FILM_STEP_NAMES as string[]).includes(s))
if (unknownRedo.length) log.usageError(`--redo: unknown step "${unknownRedo.join(', ')}" - use ${FILM_STEP_NAMES.join(', ')}`, usage)

const filmId = positionals[0]
if (!filmId || !validProjectId(filmId) || !filmExists(filmId)) {
    const existing = existsSync(FILMS_DIR) ? readdirSync(FILMS_DIR, {withFileTypes: true}).filter(d => d.isDirectory()).map(d => d.name) : []
    log.usageError(`${filmId ? `No film "${filmId}" in ${FILMS_DIR}/` : 'No film id given'} - ${existing.length ? `the films here are: ${existing.join(', ')}. ` : ''}Create one with: bun run film:init`, usage)
}

const film = new FilmStore(filmId!)
await film.load()
for (const step of redoSteps) film.invalidate(step)

const readInput = async (name: string) => existsSync(film.input(name)) ? (await Bun.file(film.input(name)).text()).trim() : ''

/////////// INPUTS AND CONFIG
log.section(`FILM · ${film.id}`)
const config = await loadFilmConfig(film.dir)
const settings = await loadSettings({projectModel: config.llm.model, llmUrl: args['llm-url'], llmApiKey: args['llm-key'], llmModel: args['llm-model']})
configureLlm(settings.llm)
log.step('LLM', settings.llm.url
    ? `${settings.llm.url} · ${settings.llm.model ? styles.name(settings.llm.model) : styles.muted('the only model on the server')}`
    : styles.muted('none configured - fine while every step is cached, else run: bun run setup llm'))

const idea = await readInput('idea.txt')
const screenplaySource = await readInput('screenplay.txt')
if (!idea && !screenplaySource) throw new Error(`${film.input('idea.txt')} or ${film.input('screenplay.txt')} is needed - a story idea or a screenplay in any language`)
const mode: FilmMode = screenplaySource ? 'screenplay' : 'idea'
if (idea && screenplaySource) log.warn('idea.txt and screenplay.txt both exist - the screenplay is adopted, the idea is ignored')
const source = screenplaySource || idea
log.step('Mode', mode === 'screenplay' ? 'adopting the screenplay' : `developing the idea ${styles.muted(config.targetDuration > 0 ? `for ~${config.targetDuration}s` : '(as long as the story needs)')}`)

// an edited input redoes the steps built on it
await film.syncInputs({
    'idea.txt': {value: idea, steps: ['brief']},
    'screenplay.txt': {value: screenplaySource, steps: ['brief']},
    dialogueLanguage: {value: config.dialogueLanguage, steps: ['brief']},
    targetDuration: {value: String(config.targetDuration), steps: ['outline']},
})

/////////// 1 · BRIEF
const brief = await film.step('brief', '1 · READING THE SOURCE', async () => {
    // a screenplay keeps its own language - dialogue is never translated
    const language = mode === 'idea' && config.dialogueLanguage !== 'auto' ? config.dialogueLanguage : undefined
    const result = await askJson<Omit<Brief, 'mode'>>(briefPrompt(source, mode, language))
    if (!languageName(result.language ?? '')) throw new Error(`the dialogue language "${result.language}" is not a language code - run it again`)
    return {mode, ...result, language: result.language.toLowerCase()}
})
log.step('Title', styles.name(brief.title))
log.step('Language', `${languageName(brief.language)} ${styles.muted(`(${brief.language})`)}`)
log.step('Logline', brief.logline)
log.step('Genre · tone · setting', styles.muted(`${brief.genre} · ${brief.tone} · ${brief.setting}`))

/////////// 2 · OUTLINE - an idea only; a screenplay already is the plan
let outline: Outline | undefined
if (mode === 'idea') {
    outline = await film.step('outline', '2 · PLANNING THE FILM', () => askJson<Outline>(outlinePrompt(idea, brief, config.targetDuration)))
    log.step('Scenes', styles.muted(`(${outline.scenes.length}) ${outline.scenes.map(s => s.heading).join(' · ')}`))
    log.step('Planned', styles.muted(`${outline.scenes.reduce((sum, s) => sum + (Number(s.seconds) || 0), 0)}s`))
}

/////////// 3 · SCREENPLAY
const screenplay = await film.step('screenplay', mode === 'idea' ? '3 · WRITING THE SCREENPLAY' : '3 · STRUCTURING THE SCREENPLAY', async () => {
    const meta = {title: brief.title, language: brief.language}
    if (mode === 'idea') return toScreenplay(await askJson(screenplayWritePrompt(brief, outline!)), meta)

    // the dialogue is checked against the source: the LLM structures the script, it must not reword a line
    let result = toScreenplay(await askJson(screenplayParsePrompt(source, brief.language)), meta)
    let missing = missingDialogue(result, source)
    if (missing.length) {
        log.warn(`${missing.length} dialogue line(s) differ from the screenplay - asking again`)
        result = toScreenplay(await askJson(screenplayParsePrompt(source, brief.language, missing)), meta)
        missing = missingDialogue(result, source)
    }
    if (missing.length) {
        log.warn(`${missing.length} dialogue line(s) still differ from the screenplay - fix them in ${film.file}, or run --redo=screenplay:\n${missing.map(m => `  "${m}"`).join('\n')}`)
    }
    return result
})
const lines = screenplay.scenes.flatMap(s => s.elements).filter(e => e.type === 'dialogue').length
const seconds = estimateSeconds(screenplay)
log.step('Scenes', styles.muted(`${screenplay.scenes.length} · ${lines} dialogue lines`))
log.step('Estimated length', `~${seconds}s ${styles.muted(`· ~${Math.ceil(seconds / 9)} clips of up to 10s`)}`)
if (mode === 'idea' && config.targetDuration > 0 && seconds > config.targetDuration * 1.4) {
    log.warn(`the script runs about ${seconds}s, the target is ${config.targetDuration}s - shorten it in ${film.file}, or --redo=outline`)
}
if (mode === 'screenplay' && seconds > 240) log.warn(`~${seconds}s is a long film for this pipeline - every 10 seconds is a clip to render`)

/////////// 4 · CAST
const cast = await film.step('cast', '4 · CASTING CHARACTERS & LOCATIONS', async () => {
    const attempt = (problems: string[] = []) => askJson<Parameters<typeof toCast>[0]>(castPrompt(screenplay, outline, problems))
    let raw = await attempt()
    try {
        return toCast(raw, screenplay)
    } catch (e) {
        if (!(e instanceof Error) || !e.message.startsWith('not in the cast: ')) throw e
        log.warn(`${e.message} - asking again`)
        raw = await attempt(e.message.replace('not in the cast: ', '').split('; '))
        return toCast(raw, screenplay)
    }
})
for (const c of cast.characters) log.step(c.voiceOnly ? 'Voice' : 'Character', `${styles.name(c.name)} ${styles.muted(`- ${c.role} · ${c.voice}`)}`)
for (const l of cast.locations) log.step('Location', styles.name(l.name))

/////////// 5 · SUMMARY
const summary = await film.step('summary', '5 · SUMMARIZING THE STORY', () => ask(summaryPrompt(screenplay, cast)))
log.step('Summary', styles.muted(summary))

/////////// OUTPUT
const fountain = join(film.dir, 'screenplay.fountain')
await Bun.write(fountain, screenplayToFountain(screenplay))
log.step('Screenplay', `${fountain} ${styles.muted('- read it; to change something, edit project.json and run again')}`)
