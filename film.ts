// The short-film pipeline: a story idea or a screenplay (any language) -> screenplay, cast, locations.
// Separate from the music-video pipeline (index.ts) - it shares the LLM client, the settings and the helpers, nothing else.
// usage: bun film.ts <film-id> [--redo=screenplay,cast]
import {copyFileSync, existsSync, mkdirSync, readdirSync, rmSync} from "node:fs";
import {join} from "node:path";
import {parseArgs} from "node:util";
import {languageName} from "./lib/config.ts";
import {addScore, assembleFilm, SCORE_EXTENSIONS} from "./lib/film/assemble.ts";
import {burnSubtitles, muxSubtitles, subtitleCues, subtitlePrompt, subtitleTexts, toSrt} from "./lib/film/subtitles.ts";
import {buildFilmClipRequests} from "./lib/film/compose.ts";
import {loadFilmConfig} from "./lib/film/config.ts";
import {CoverageProblem, packClips, type RawCoverage, toCoverage} from "./lib/film/coverage.ts";
import {screenplayToFountain} from "./lib/film/fountain.ts";
import {filmPictures, filmRenderConfig, pictureSeed, renderAll, statePictureId} from "./lib/film/pictures.ts";
import type {PictureJob} from "./lib/render.ts";
import {FilmRenderer, promptHash} from "./lib/film/render.ts";
import {archiveClip} from "./lib/film/archive.ts";
import {shotlistMarkdown} from "./lib/film/shotlist.ts";
import {briefPrompt, castPrompt, coveragePrompt, outlinePrompt, screenplayParsePrompt, screenplayWritePrompt, locationViewsPrompt, scriptFixPrompt, scriptNotesPrompt, stateLookPrompt, styleChoicePrompt, summaryPrompt} from "./lib/film/prompts.ts";
import {maxShotsFor} from "./lib/film/shot-checks.ts";
import {applyScriptFixes, estimateSeconds, locationOf, missingDialogue, toCast, toScreenplay} from "./lib/film/screenplay.ts";
import {filmExists} from "./lib/film/setup.ts";
import {askFilmJson as askJson} from "./lib/film/json.ts";
import {FILM_STEP_NAMES, FILMS_DIR, FilmStore, type FilmStepName} from "./lib/film/store.ts";
import type {Brief, FilmMode, LocationView, Outline, SceneCoverage} from "./lib/film/types.ts";
import {ask, configureLlm} from "./lib/llm.ts";
import {log, printBanner, styles} from "./lib/log.ts";
import {characterDescriptionPrompt, characterLookPrompt, locationDescriptionPrompt, locationLookPrompt, lookBriefPrompt} from "./lib/prompts.ts";
import {validProjectId} from "./lib/project-setup.ts";

import {loadSettings} from "./lib/settings.ts";
import {shuffledStyles, stylesById} from "./lib/styles.ts";

process.on('unhandledRejection', e => log.fatal(e instanceof Error ? e.message : String(e)))
process.on('uncaughtException', e => log.fatal(e instanceof Error ? e.message : String(e)))

printBanner()

const usage = `bun film.ts <film-id> [--redo=screenplay,cast] [--render=images,videos,final|all] [--only=clip-005,clip-006] [--again] [--fix-script] [--scenes=s6,s7] [--llm-url=…] [--llm-key=…] [--llm-model=…] [--comfy=http://a:8188,…]
steps: ${FILM_STEP_NAMES.join(', ')}`
const {values: args, positionals} = (() => {
    try {
        return parseArgs({
            args: Bun.argv.slice(2),
            allowPositionals: true,
            options: {
                redo: {type: 'string', default: ''},
                render: {type: 'string', default: ''},
                only: {type: 'string', default: ''},
                again: {type: 'boolean', default: false},
                'fix-script': {type: 'boolean', default: false},
                scenes: {type: 'string', default: ''},
                comfy: {type: 'string'},
                'llm-url': {type: 'string'},
                'llm-key': {type: 'string'},
                'llm-model': {type: 'string'},
            },
        })
    } catch (e) {
        return log.usageError(e instanceof Error ? e.message : String(e), usage)
    }
})()
// --render=all is everything that can be rendered so far
const render = new Set(args.render.split(',').filter(Boolean).flatMap(r => r === 'all' ? ['images', 'videos', 'final'] : [r]))
const unknownRender = [...render].filter(r => !['images', 'videos', 'final'].includes(r))
if (unknownRender.length) log.usageError(`--render: unknown "${unknownRender.join(', ')}" - use images, videos, final or all`, usage)
if (args.again && !render.has('videos')) log.usageError('--again goes with --render=videos: it renders the clips named in --only again, with a new seed', usage)
if (args.again && !args.only) log.usageError('--again needs --only=clip-005,... - say which clips are rendered again, every one is GPU time', usage)
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
// --scenes=s6,s7 with --redo=coverage: only these scenes are planned again, the shots of the others (and the clips rendered from them) stay
const sceneIds = new Set(args.scenes.split(',').filter(Boolean))
if (sceneIds.size && !redoSteps.includes('coverage')) log.usageError('--scenes goes with --redo=coverage: it names the scenes whose shots are planned again', usage)
const keptCoverage = sceneIds.size ? film.data.coverage : undefined
for (const step of redoSteps) film.invalidate(step)

const readInput = async (name: string) => existsSync(film.input(name)) ? (await Bun.file(film.input(name)).text()).trim() : ''

/////////// INPUTS AND CONFIG
log.section(`FILM · ${film.id}`)
const config = await loadFilmConfig(film.dir)
const settings = await loadSettings({projectModel: config.llm.model, llmUrl: args['llm-url'], llmApiKey: args['llm-key'], llmModel: args['llm-model'], comfy: args.comfy})
configureLlm(settings.llm)
log.step('LLM', settings.llm.url
    ? `${settings.llm.url} · ${settings.llm.model ? styles.name(settings.llm.model) : styles.muted('the only model on the server')}`
    : styles.muted('none configured - fine while every step is cached, else run: bun run setup llm'))

let style = await readInput('style.txt')
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
    targetDuration: {value: String(config.targetDuration), steps: ['outline', 'coverage']},
    'style.txt': {value: style, steps: ['lookBrief']},
    subtitles: {value: config.subtitles, steps: ['subtitles']},
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
let screenplay = await film.step('screenplay', mode === 'idea' ? '3 · WRITING THE SCREENPLAY' : '3 · STRUCTURING THE SCREENPLAY', async () => {
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

/////////// 3b · SCRIPT NOTES - what the script contradicts itself in. The pipeline's own script (an idea) is repaired; a handed-in screenplay is only reported
// - it is the writer's - unless --fix-script asks for the repair
const readScript = async () => {
    const answer = await askJson<{ notes?: unknown }>(scriptNotesPrompt(screenplay, mode === 'idea' ? idea : undefined))
    return Array.isArray(answer.notes) ? answer.notes.filter((n): n is string => typeof n === 'string' && !!n.trim()).map(n => n.trim()) : []
}
let scriptNotes: string[] = film.data.scriptNotes ?? []
try {
    scriptNotes = await film.step('scriptNotes', '3b · READING THE SCRIPT FOR CONTRADICTIONS', readScript)
    // the repair is done in rounds: a repair can leave something over, or make something new - up to 3 rounds with --fix-script, 2 for a script of the pipeline's own
    const maxRounds = args['fix-script'] ? 3 : mode === 'idea' && !film.data.scriptFixes ? 2 : 0
    let backedUp = false
    for (let round = 0; round < maxRounds && scriptNotes.length; round++) {
        const answer = await askJson<{ edits?: unknown }>(scriptFixPrompt(screenplay, scriptNotes))
        const fixed = applyScriptFixes(screenplay, answer.edits)
        for (const reason of fixed.rejected) log.warn(`script repair: ${reason}`)
        if (!fixed.applied.length) break
        // what was there goes to old/ (once), the shots follow the new script - the cast and the looks stay: only action lines and times of day changed
        if (!backedUp) {
            const keep = join(film.dir, 'old', `script-fix-${new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')}`)
            mkdirSync(keep, {recursive: true})
            copyFileSync(film.file, join(keep, 'project.json'))
            log.step('Script', styles.muted(`the old version is in ${keep}; cast and looks are kept, the shots are planned again`))
            backedUp = true
        }
        screenplay = fixed.screenplay
        film.data.screenplay = screenplay
        film.data.scriptFixes = [...(film.data.scriptFixes ?? []), ...fixed.applied]
        delete film.data.coverage
        delete film.data.scriptNotes
        await film.save()
        for (const change of fixed.applied) log.step('Repaired', `${styles.name(change.scene)} ${styles.muted(`- ${change.before.slice(0, 70)}`)} → ${change.after.slice(0, 110)}`)
        scriptNotes = await film.step('scriptNotes', `3c · READING THE REPAIRED SCRIPT (round ${round + 1})`, readScript)
    }
} catch (e) {
    log.warn(`the script could not be checked for contradictions (${e instanceof Error ? e.message : String(e)}) - the film goes on without; --redo=scriptNotes tries again`)
}
for (const note of scriptNotes) log.warn(`script: ${note}`)
if (scriptNotes.length) log.step('Script', styles.muted(mode === 'screenplay' ? 'the film follows the script as it is - --fix-script repairs it (old version kept), or edit project.json (screenplay)' : 'the film follows the script as it is - edit project.json (screenplay) to resolve these before rendering'))

/////////// 4 · CAST
const cast = await film.step('cast', '4 · CASTING CHARACTERS & LOCATIONS', async () => {
    const attempt = (problems: string[] = []) => askJson<Parameters<typeof toCast>[0]>(castPrompt(screenplay, outline, problems, mode === 'screenplay' ? source : undefined, brief.setting))
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

const fountain = join(film.dir, 'screenplay.fountain')
await Bun.write(fountain, screenplayToFountain(screenplay))
log.step('Screenplay', `${fountain} ${styles.muted('- read it; to change something, edit project.json and run again')}`)

/////////// 6 · FILM LOOK
// No style.txt on a film that has no look yet: the LLM shortlists a few styles (lib/styles.ts) that fit the story, one of
// them is drawn at random - so the look neither follows the LLM's favorites nor ignores the story. It is written to
// input/style.txt once and can be edited or swapped. A film whose look is already cached keeps it.
if (!style && film.data.lookBrief === undefined) {
    // the style that fits the film, chosen by the language model - not drawn from a shortlist
    const choice = await askJson<{ style?: string, reason?: string }>(styleChoicePrompt(brief, summary, shuffledStyles()))
    const picked = stylesById([choice.style])[0]
    if (!picked) throw new Error(`the language model did not name a style of the list ("${choice.style}") - write one into ${film.input('style.txt')} (docs/style-examples.md has them) and run again`)
    style = picked.text
    await Bun.write(film.input('style.txt'), style)
    await film.recordInput('style.txt', style)
    log.step('Picked style', `${styles.name(picked.name)} ${styles.muted(`- ${choice.reason ?? 'the best fit'} - written to input/style.txt, edit or replace it to change the look`)}`)
}
const lookBrief = await film.step('lookBrief', '6 · DESIGNING THE FILM LOOK', () => ask(lookBriefPrompt(style, `${brief.genre}, ${brief.tone}, ${brief.setting}. ${summary}`)))
log.box('Look brief', lookBrief)

/////////// 7 · CHARACTER LOOKS - a reference picture for everyone who is seen (a narrator's voice has none)
const seen = cast.characters.filter(c => !c.voiceOnly)
const characterLooks = await film.step('characterLooks', '7 · CRAFTING CHARACTER LOOKS', async () => {
    const looks: Record<string, string> = {}
    for (const [i, char] of seen.entries()) {
        log.step(`Character ${i + 1}/${seen.length}`, styles.name(char.id))
        const otherLooks = seen.filter(c => c.id !== char.id && looks[c.id]).map(c => ({name: c.name, look: looks[c.id]!}))
        // the script's own description of the character is a fact the picture has to show
        looks[char.id] = await ask(characterLookPrompt(lookBrief, {name: char.name, role: `${char.role} Appearance: ${char.appearance} Keep the age, build and proportions this appearance gives, whatever they are - tell the characters apart by hair, face, clothing and gear, never by changing the height or build.`}, otherLooks))
        // other looks of the character (wounded, disguised): the same prompt with only the change applied
        for (const state of char.states ?? []) looks[statePictureId(char.id, state.id)] = await ask(stateLookPrompt(looks[char.id]!, char.name, state))
    }
    return looks
})
for (const [id, look] of Object.entries(characterLooks)) log.box(id, look)

/////////// 7b · the character looks without the reference sheet (pose, grey background, studio light) - for the clip prompts
const characterDescriptions = await film.step('characterDescriptions', '7b · DESCRIBING THE CHARACTERS FOR THE CLIPS', async () => {
    const descriptions: Record<string, string> = {}
    for (const [i, char] of seen.entries()) {
        log.step(`Character ${i + 1}/${seen.length}`, styles.name(char.id))
        descriptions[char.id] = await ask(characterDescriptionPrompt(characterLooks[char.id] ?? ''))
        for (const state of char.states ?? []) descriptions[statePictureId(char.id, state.id)] = await ask(characterDescriptionPrompt(characterLooks[statePictureId(char.id, state.id)] ?? ''))
    }
    return descriptions
})
for (const [id, description] of Object.entries(characterDescriptions)) log.box(id, description)

/////////// 8 · LOCATION LOOKS
const locationLooks = await film.step('locationLooks', '8 · CRAFTING LOCATION LOOKS', async () => {
    const looks: Record<string, string> = {}
    for (const [i, location] of cast.locations.entries()) {
        log.step(`Location ${i + 1}/${cast.locations.length}`, styles.name(location.id))
        looks[location.id] = await ask(locationLookPrompt(lookBrief, summary, `${location.name} - ${location.description}`))
    }
    return looks
})
for (const [id, look] of Object.entries(locationLooks)) log.box(id, look)

/////////// 8b · the location looks without the establishing shot (camera, "empty") - for the clip prompts
const locationDescriptions = await film.step('locationDescriptions', '8b · DESCRIBING THE LOCATIONS FOR THE CLIPS', async () => {
    const descriptions: Record<string, string> = {}
    for (const [i, location] of cast.locations.entries()) {
        log.step(`Location ${i + 1}/${cast.locations.length}`, styles.name(location.id))
        descriptions[location.id] = await ask(locationDescriptionPrompt(locationLooks[location.id] ?? ''))
    }
    return descriptions
})
for (const [id, description] of Object.entries(locationDescriptions)) log.box(id, description)

/////////// 8c · LOCATION VIEWS - the five views of a location's reference sheet, designed for the place and its story (only with sequence sheets)
const locationViews = config.sequenceSheets && config.locationViews
    ? await film.step('locationViews', '8c · DESIGNING THE VIEWS OF THE LOCATIONS', async () => {
        const result: Record<string, LocationView[]> = {}
        for (const [i, location] of cast.locations.entries()) {
            log.step(`Location ${i + 1}/${cast.locations.length}`, styles.name(location.id))
            // what happens there, from the script: the action lines of its scenes
            const scenes = screenplay.scenes.filter(s => locationOf(cast, s.location)?.id === location.id)
                .map(s => `${s.id}: ${s.elements.filter(e => e.type === 'action').map(e => e.text).join(' ')}`.slice(0, 700)).join('\n').slice(0, 3000)
            const answer = await askJson<{ views?: Partial<LocationView>[] }>(locationViewsPrompt(location, locationLooks[location.id] ?? '', scenes))
            const views = (answer.views ?? []).filter(v => typeof v?.name === 'string' && typeof v?.shows === 'string' && v.name.trim() && v.shows.trim()).map(v => ({name: v.name!.trim(), shows: v.shows!.trim()}))
            if (views.length !== 5) throw new Error(`the views of ${location.name}: ${views.length} instead of 5 - run it again (--redo=locationViews)`)
            result[location.id] = views
        }
        return result
    })
    : {} as Record<string, LocationView[]>
for (const [id, views] of Object.entries(locationViews)) log.step(id, styles.muted(views.map((v, i) => `${i + 1}. ${v.name}`).join(' · ')))

const pictures = filmPictures(cast, {characterLooks, characterDescriptions, locationLooks, locationDescriptions, locationViews})
await Bun.write(join(film.dir, 'assets.json'), JSON.stringify(pictures, null, 2))

/////////// 9 · SHOTS - every scene broken into shots, one LLM call per scene
// the length of the film: asked for in the config (an idea always has one), shared out to the scenes by the length of their script
const sceneWeight = (scene: (typeof screenplay.scenes)[number]) => estimateSeconds({...screenplay, scenes: [scene]})
const totalWeight = screenplay.scenes.reduce((sum, s) => sum + sceneWeight(s), 0)
const budgeted = config.targetDuration > 0 && (mode === 'idea' || config.targetDurationSet)
const budgetOf = (scene: (typeof screenplay.scenes)[number]) => budgeted ? Math.max(4, Math.round(config.targetDuration * sceneWeight(scene) / totalWeight)) : undefined
if (budgeted) log.step('Planned length', `${config.targetDuration}s ${styles.muted('- every scene gets its share of it')}`)
const coverage = await film.step('coverage', '9 · PLANNING THE SHOTS', async () => {
    const result: SceneCoverage[] = []
    // what the scene before ended with, by the names of the cast - the shots of this scene start from it where the scene goes on
    const handover = (i: number) => {
        const previous = result[i - 1]
        const ends = Object.entries(previous?.ends ?? {}).map(([id, where]) => [cast.characters.find(c => c.id === id)?.name ?? id, where] as const)
        return previous && ends.length ? {scene: previous.sceneId, ends: Object.fromEntries(ends), view: previous.shots.at(-1)?.view} : undefined
    }
    for (const [i, scene] of screenplay.scenes.entries()) {
        // a scene that is not named keeps the shots it had
        const kept = keptCoverage?.find(c => c.sceneId === scene.id)
        if (sceneIds.size && !sceneIds.has(scene.id) && kept) {
            log.step(`Scene ${i + 1}/${screenplay.scenes.length}`, styles.muted(`${scene.id} keeps its shots`))
            result.push(kept)
            continue
        }
        log.step(`Scene ${i + 1}/${screenplay.scenes.length}`, styles.name(`${scene.setting}. ${scene.location} - ${scene.time}`))
        const location = locationOf(cast, scene.location)!
        let problems: string[] = []
        for (let attempt = 0; ; attempt++) {
            const raw = await askJson<RawCoverage>(coveragePrompt(scene, location, cast.characters, languageName(brief.language) ?? brief.language, lookBrief, budgetOf(scene), maxShotsFor(scene), problems, handover(i), locationViews[location.id]))
            try {
                // the first time what the script checks find is a reason to ask again, the second time it is only noted
                const {coverage: planned, notes} = toCoverage(raw, scene, cast, attempt === 0)
                for (const note of notes) log.warn(note)
                result.push(planned)
                break
            } catch (e) {
                // a dropped line of dialogue or a wrong name is what the model can fix when told - once
                if (!(e instanceof CoverageProblem) || attempt >= 1) throw e
                problems = e.problems
                log.warn(`${e.message} - asking again`)
            }
        }
    }
    return result
})

/////////// 10 · CLIPS - shots packed into clips of up to ~9 s, then the H3 requests, built deterministically and never cached
const clips = packClips(screenplay, coverage, config.continuity)
const requests = buildFilmClipRequests({
    screenplay, cast, clips,
    soundscapes: Object.fromEntries(coverage.map(c => [c.sceneId, c.soundscape])),
    stagings: Object.fromEntries(coverage.map(c => [c.sceneId, c.staging ?? ''])),
    voices: Object.fromEntries(coverage.map(c => [c.sceneId, c.voices === true])),
    characterDescriptions, locationDescriptions, locationViews, lookBrief,
})
const outputDir = join(film.dir, 'output')
// a plan that got shorter leaves the requests of its last clips behind - they would look like clips of the film
const planned = new Set(requests.map(r => `${r.id}.json`))
const clipsDir = join(outputDir, 'clips')
if (existsSync(clipsDir)) for (const entry of readdirSync(clipsDir)) if (entry.endsWith('.json') && !planned.has(entry)) rmSync(join(clipsDir, entry))
for (const request of requests) await Bun.write(join(outputDir, 'clips', `${request.id}.json`), JSON.stringify(request, null, 2))
await Bun.write(join(outputDir, 'timeline.json'), JSON.stringify({
    title: screenplay.title,
    language: screenplay.language,
    totalFrames: clips.reduce((sum, c) => sum + c.frames, 0),
    clips: requests.map(r => ({id: r.id, scene: r.sceneId, frameStart: r.frameStart, frames: r.frames, seconds: r.seconds, shots: r.shots.length, dialogue: r.dialogue.length, ...(r.startsFrom ? {startsFrom: r.startsFrom} : {}), request: `clips/${r.id}.json`})),
}, null, 2))
await Bun.write(join(outputDir, 'shotlist.md'), shotlistMarkdown({screenplay, cast, coverage, clips}))
for (const request of requests) log.box(`${request.id} · ${request.sceneId} · ${request.seconds}s${request.startsFrom ? ` · goes on from ${request.startsFrom}` : ''}`, request.prompt)
log.step('Clips', `${clips.length} ${styles.muted(`· ${(clips.reduce((sum, c) => sum + c.frames, 0) / 24).toFixed(1)}s · ${requests.reduce((sum, r) => sum + r.dialogue.length, 0)} dialogue lines · requests in ${join(outputDir, 'clips')}`)}`)

/////////// 11 · RENDERING WITH COMFYUI
if (render.has('images') || render.has('videos')) {
    const renderConfig = filmRenderConfig(config)
    // the project id is part of ComfyUI's folder - "film-" keeps it apart from a music video of the same name
    using renderer = new FilmRenderer(`film-${film.id}`, film.dir, renderConfig, settings.comfy)
    log.section('11 · RENDERING WITH COMFYUI')
    log.step('Config', styles.muted(`seed ${config.seed}, images ${config.imageResolution} (${renderConfig.imageWorkflow})${config.sequenceSheets ? `, sequence sheets (${renderConfig.sequenceWorkflow})` : ''}`))
    log.step('Servers', settings.comfy.map(s => `${styles.name(s.name)} ${styles.muted(s.url)}`).join(', '))
    if (render.has('images')) {
        log.step('Pictures', `${pictures.length}${config.sequenceSheets ? styles.muted(' (multi-angle reference sheets)') : ''}`)
        const renderPicture = (picture: PictureJob) => config.sequenceSheets ? renderer.renderSequenceSheet(picture) : renderer.renderPicture(picture)
        await renderAll(pictures.filter(p => !p.baseId), renderPicture)
        // another look of a character is drawn with the seed of the normal picture - that keeps the face; it waits for it
        await renderAll(pictures.filter(p => p.baseId), p => renderPicture({...p, seed: pictureSeed(film.dir, p.baseId!)}))
    }
    // clips need all their pictures, so they start after the pictures - free the image model's VRAM first
    if (render.has('videos')) {
        if (render.has('images')) await renderer.freeMemory()
        const only = new Set(args.only.split(',').filter(Boolean))
        const selected = requests.filter(r => only.size === 0 || only.has(r.id))
        const unknown = [...only].filter(id => !requests.some(r => r.id === id))
        if (unknown.length) throw new Error(`--only: no clip ${unknown.join(', ')} - the clips are ${requests.map(r => r.id).join(', ')}`)
        log.step('Clips', `${selected.length}${only.size ? styles.muted(` of ${requests.length} (--only)`) : ''}`)
        // a clip that starts on the last frame of the one before waits for it: those render one after the other, each chain next to the others
        const renderClips = (clips: typeof requests) => renderAll(clipChains(clips), async chain => {
            for (const clip of chain) await renderer.renderFilmClip(clip)
        })
        // on request, and only for the clips named: they are put away in old/attempts/ and rendered again, with a new seed
        if (args.again) {
            if (config.seed !== -1) log.warn(`"seed" is ${config.seed} in config.json - the same seed gives the same clip again; -1 gives a new one every time`)
            const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')
            for (const clip of selected) log.step('Again', `${clip.id} ${styles.muted(`- the old one is in ${archiveClip(film.dir, clip.id, stamp)}`)}`)
            // a clip that goes on from the last frame of one of these starts on a picture that no longer exists
            const later = new Set<string>()
            for (const clip of selected) {
                for (let next = requests.find(c => c.startsFrom === clip.id); next; next = requests.find(c => c.startsFrom === next!.id)) if (!selected.includes(next)) later.add(next.id)
            }
            if (later.size) log.warn(`${[...later].join(', ')} start on the last frame of a clip rendered again and are not - render them again too (--again) if the picture should go on from the new one`)
        }
        await renderClips(selected)

    }
}

/////////// 12 · ASSEMBLING THE FILM
if (render.has('final')) {
    log.section('12 · ASSEMBLING THE FILM')
    const only = new Set(args.only.split(',').filter(Boolean))
    const unknown = [...only].filter(id => !requests.some(r => r.id === id))
    if (unknown.length) throw new Error(`--only: no clip ${unknown.join(', ')} - the clips are ${requests.map(r => r.id).join(', ')}`)
    const selected = requests.filter(r => only.size === 0 || only.has(r.id))
    // some of the clips only: a try-out, never the film itself
    const target = join(film.dir, only.size ? `${film.id}-partial.mp4` : `${film.id}.mp4`)
    log.step('Sound', styles.muted('the sound the model made for each clip, with a short fade at every cut'))
    // a clip with dialogue keeps all the frames the model rendered: its last word can fall behind the planned end
    const result = await assembleFilm({clips: selected.map((r, i) => ({id: r.id, frames: r.frames, useRendered: r.dialogue.length > 0, continuesPrevious: r.startsFrom !== undefined && r.startsFrom === selected[i - 1]?.id, promptHash: promptHash(r)})), projectDir: film.dir, target, levelMatching: config.levelMatching})

    // a score in input/ is mixed under the film
    const score = SCORE_EXTENSIONS.map(ext => film.input(`score.${ext}`)).find(file => existsSync(file))
    if (score) {
        await addScore(target, score, config.scoreVolume)
        log.step('Score', `${score} ${styles.muted(`under the film at ${config.scoreVolume} dB, ducking under the dialogue`)}`)
    }

    // subtitles: the screenplay's own translations, or the film's lines translated into the language in config.json
    let translated = film.data.subtitles
    if (config.subtitles !== 'script' && config.subtitles !== 'off') {
        translated = await film.step('subtitles', '12a · TRANSLATING THE SUBTITLES', async () => {
            const {lines, options} = subtitlePrompt(screenplay, config.subtitles)
            if (!lines.length) return {}
            const answer = await askJson<Record<string, unknown>>(options)
            return Object.fromEntries(lines.flatMap(l => typeof answer[l.key] === 'string' && (answer[l.key] as string).trim() ? [[l.key, (answer[l.key] as string).trim()]] : []))
        })
    }
    const cues = subtitleCues(selected, result.starts, subtitleTexts(screenplay, translated, config.subtitles))
    if (cues.length) {
        const srt = target.replace(/\.mp4$/, '.srt')
        await Bun.write(srt, toSrt(cues))
        // burned in (always visible) or a track of the mp4 (the player switches it on) - not both, the text would be there twice
        if (config.burnSubtitles) await burnSubtitles(target, srt)
        else await muxSubtitles(target, srt, config.subtitles === 'script' ? undefined : config.subtitles)
        log.step('Subtitles', `${srt} ${styles.muted(`${cues.length} cues, ${config.burnSubtitles ? 'burned into the picture' : 'also a track in the mp4'} - timing is estimated`)}`)
    } else if (config.subtitles !== 'off') {
        log.step('Subtitles', styles.muted(config.subtitles === 'script' ? 'none - the screenplay has no translations under its lines (config.json: "subtitles": "en" translates them)' : 'none - every line is in that language already'))
    }
    log.step('Saved', `${target} ${styles.muted(`${result.width}x${result.height}, ${result.frames} frames, ${result.duration}${only.size ? ` - ${selected.length} of ${requests.length} clips (--only)` : ''}`)}`)
}

// Runs of clips where each one starts on the last frame of the one before (FilmClipRequest.startsFrom), in film order
function clipChains(clips: typeof requests): (typeof requests)[] {
    const chains: (typeof requests)[] = []
    for (const clip of clips) {
        const chain = clip.startsFrom ? chains.find(c => c.at(-1)!.id === clip.startsFrom) : undefined
        if (chain) chain.push(clip)
        else chains.push([clip])
    }
    return chains
}
