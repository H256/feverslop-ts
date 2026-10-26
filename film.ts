import {cli} from './lib/cli.ts';
// The short-film pipeline: a story idea or a screenplay (any language) -> screenplay, cast, locations.
// Separate from the music-video pipeline (index.ts) - it shares the LLM client, the settings and the helpers, nothing else.
// usage: bun film.ts <film-id> [--redo=screenplay,cast]
import {copyFileSync, existsSync, mkdirSync, readdirSync, rmSync} from "node:fs";
import {join} from "node:path";
import {parseArgs} from "node:util";
import {languageName} from "./lib/config.ts";
import {addScore, assembleFilm, assembleSmoothFilm, SCORE_EXTENSIONS} from "./lib/film/assemble.ts";
import {finishOf} from "./lib/finish.ts";
import {finishCopy, interpolateClips} from "./lib/final-pass.ts";
import {FPS, maxClipFor, secondsAt} from "./lib/frames.ts";
import {burnSubtitles, muxSubtitles, subtitleCues, subtitlePrompt, subtitleTexts, toSrt} from "./lib/film/subtitles.ts";
import {buildFilmClipRequests} from "./lib/film/compose.ts";
import {loadFilmConfig} from "./lib/film/config.ts";
import {CoverageProblem, MAX_CLIP_SEC, packClips,type RawCoverage, toCoverage} from "./lib/film/coverage.ts";
import {screenplayToFountain} from "./lib/film/fountain.ts";
import {chooseShotViews, readSheetViews, withShotViews} from "./lib/film/views.ts";
import {filmPictures, filmRenderConfig, pictureSeed, renderAll, statePictureId} from "./lib/film/pictures.ts";
import type {PictureJob} from "./lib/render.ts";
import {FilmRenderer, filmClipFreshness, filmRenderState, startedOnContext} from "./lib/film/render.ts";
import {filmInputs, filmMode, filmStepUsed} from "./lib/film/inputs.ts";
import {clipEstimate, pictureEstimate} from "./lib/render-state.ts";
import {formatSlotRanges} from "./lib/assemble.ts";
import {reviewed} from "./lib/review.ts";
import {archiveClip} from "./lib/film/archive.ts";
import {versionStamp} from "./lib/archive.ts";
import {clipChains} from "./lib/batch.ts";
import type {AssetKind} from "./lib/asset-import.ts";
import {castFromLibrary, copyKey} from "./lib/casting.ts";
import {libraryDir} from "./lib/library.ts";
import {lockProject} from "./lib/lock.ts";
import {shotlistMarkdown} from "./lib/film/shotlist.ts";
import {briefPrompt, castPrompt, coveragePrompt, fountainAnnotatePrompt, propsPrompt, outlinePrompt, screenplayParsePrompt, screenplayWritePrompt, locationViewsPrompt, scriptFixPrompt, scriptNotesPrompt, stateLookPrompt, styleChoicePrompt, summaryPrompt} from "./lib/film/prompts.ts";
import {namedByScene} from "./lib/film/names.ts";
import {maxShotsFor} from "./lib/film/shot-checks.ts";
import {timelineEdl} from "./lib/film/timeline.ts";
import {applyScriptFixes, estimateSeconds, locationOf, mergeRawCasts, missingDialogue, omittedSourceLines, toCast, toProps, toScreenplay} from "./lib/film/screenplay.ts";
import {filmExists} from "./lib/film/setup.ts";
import {applyAnnotations, parseFountain} from "./lib/film/fountain-import.ts";
import {askFilmJson as askJson} from "./lib/film/json.ts";
import {FILM_STEP_NAMES, FILMS_DIR, FilmStore, type FilmStepName} from "./lib/film/store.ts";
import type {Brief, FilmMode, LocationView, Outline, SceneCoverage} from "./lib/film/types.ts";
import {ask, configureLlm} from "./lib/llm.ts";
import {log, styles} from "./lib/log.ts";
import {characterDescriptionPrompt, characterLookPrompt, locationDescriptionPrompt, locationLookPrompt, lookBriefPrompt} from "./lib/prompts.ts";
import {validProjectId} from "./lib/project-setup.ts";

import {loadSettings} from "./lib/settings.ts";
import {shuffledStyles, stylesById} from "./lib/styles.ts";
cli('film')




const usage = `bun film.ts <film-id> [--redo=screenplay,cast] [--render=images,videos,final|all] [--only=clip-005,clip-006] [--again] [--fix-script] [--allow-import-gaps] [--refresh=pictures,clips] [--strict] [--debug] [--scenes=s6,s7] [--review] [--dry-run] [--llm-url=…] [--llm-key=…] [--llm-model=…] [--comfy=http://a:8188,…]
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
                'allow-import-gaps': {type: 'boolean', default: false},
                refresh: {type: 'string', default: ''},
                strict: {type: 'boolean', default: false},
                // read by failRun (lib/log.ts) from the raw arguments - declared here so parseArgs accepts it
                debug: {type: 'boolean', default: false},
                scenes: {type: 'string', default: ''},
                review: {type: 'boolean', default: false},
                'dry-run': {type: 'boolean', default: false},
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
if (args.review && !(process.stdin.isTTY && process.stdout.isTTY)) log.usageError('--review asks in the terminal - run it in one', usage)
if (args.review && args['dry-run']) log.usageError('--review and --dry-run do not go together: a dry run generates nothing to look at', usage)
const redoSteps = args.redo.split(',').filter(Boolean) as FilmStepName[]
const unknownRedo = redoSteps.filter(s => !(FILM_STEP_NAMES as string[]).includes(s))
if (unknownRedo.length) log.usageError(`--redo: unknown step "${unknownRedo.join(', ')}" - use ${FILM_STEP_NAMES.join(', ')}`, usage)

const filmId = positionals[0]
if (!filmId || !validProjectId(filmId) || !filmExists(filmId)) {
    const existing = existsSync(FILMS_DIR) ? readdirSync(FILMS_DIR, {withFileTypes: true}).filter(d => d.isDirectory()).map(d => d.name) : []
    log.usageError(`${filmId ? `No film "${filmId}" in ${FILMS_DIR}/` : 'No film id given'} - ${existing.length ? `the films here are: ${existing.join(', ')}. ` : ''}Create one with: bun run film:init`, usage)
}

const film = new FilmStore(filmId!)
// before the load: a run that writes works from the state it read, so no other run may save in between
// --dry-run only reads: no lock, nothing saved
if (!args['dry-run']) lockProject(film.dir, `film ${film.id}`)
await film.load()
// --scenes=s6,s7 with --redo=coverage: only these scenes are planned again, the shots of the others (and the clips rendered from them) stay
const sceneIds = new Set(args.scenes.split(',').filter(Boolean))
if (sceneIds.size && !redoSteps.includes('coverage')) log.usageError('--scenes goes with --redo=coverage: it names the scenes whose shots are planned again', usage)
const keptCoverage = sceneIds.size ? film.data.coverage : undefined
// the shots of a scene stay only for the screenplay, cast, look and views they were planned from: a screenplay that is
// planned again (or edited) gives other scenes and dialogue indices, and old shots would be read against them
const coverageBasis = () => Bun.hash(JSON.stringify([film.data.screenplay, film.data.cast, film.data.lookBrief, film.data.locationViews])).toString(16)
const keptBasis = keptCoverage ? coverageBasis() : undefined
// a dry run only says what would be redone (see dryRun below)
if (!args['dry-run']) for (const step of redoSteps) film.invalidate(step)

const readInput = async (name: string) => existsSync(film.input(name)) ? (await Bun.file(film.input(name)).text()).trim() : ''

/////////// INPUTS AND CONFIG
log.section(`FILM · ${film.id}`)
const config = await loadFilmConfig(film.dir)
const settings = await loadSettings({projectModel: config.llm.model, llmUrl: args['llm-url'], llmApiKey: args['llm-key'], llmModel: args['llm-model'], comfy: args.comfy})
configureLlm(settings.llm)
log.step('LLM', settings.llm.url
    ? `${settings.llm.url} · ${settings.llm.model ? styles.name(settings.llm.model) : styles.muted('the only model on the server')}`
    : styles.muted('none configured - fine while every step is cached, else run: bun run setup llm'))
if (args['dry-run']) {
    await dryRun()
    process.exit(0)
}

let style = await readInput('style.txt')
const idea = await readInput('idea.txt')
const screenplaySource = await readInput('screenplay.txt')
if (!idea && !screenplaySource) throw new Error(`${film.input('idea.txt')} or ${film.input('screenplay.txt')} is needed - a story idea or a screenplay in any language`)
const mode: FilmMode = screenplaySource ? 'screenplay' : 'idea'
if (idea && screenplaySource) log.warn('idea.txt and screenplay.txt both exist - the screenplay is adopted, the idea is ignored')
const source = screenplaySource || idea
log.step('Mode', mode === 'screenplay' ? 'adopting the screenplay' : `developing the idea ${styles.muted(config.targetDuration > 0 ? `for ~${config.targetDuration}s` : '(as long as the story needs)')}`)

// an edited input redoes the steps built on it
await film.syncInputs(await filmInputs(film.dir, config))

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
    outline = await reviewed(film, args.review, 'outline', () => film.step('outline', '2 · PLANNING THE FILM', () => askJson<Outline>(outlinePrompt(idea, brief, config.targetDuration))), value => {
        log.step('Scenes', styles.muted(`(${value.scenes.length}) ${value.scenes.map(s => s.heading).join(' · ')}`))
        log.step('Planned', styles.muted(`${value.scenes.reduce((sum, s) => sum + (Number(s.seconds) || 0), 0)}s`))
    })
}

/////////// 3 · SCREENPLAY
let screenplay = await reviewed(film, args.review, 'screenplay', () => film.step('screenplay', mode === 'idea' ? '3 · WRITING THE SCREENPLAY' : '3 · STRUCTURING THE SCREENPLAY', async () => {
    const meta = {title: brief.title, language: brief.language}
    if (mode === 'idea') return toScreenplay(await askJson(screenplayWritePrompt(brief, outline!)), meta)

    // A source in Fountain is read by code: no line can be dropped, reworded or given to another speaker. The model only
    // annotates what the structure cannot say (the English of place and time, the language of a line, the actions)
    const imported = parseFountain(source)
    if (imported) {
        log.step('Import', styles.muted(`Fountain - ${imported.scenes.length} scene(s) read by code, the model only annotates`))
        const notes = await askJson(fountainAnnotatePrompt(imported.scenes.map(scene => ({
            location: scene.location, time: scene.time,
            actions: scene.elements.flatMap(e => e.type === 'action' ? [e.text] : []),
            lines: scene.elements.flatMap(e => e.type === 'dialogue' ? [{text: e.text, ...(e.delivery ? {delivery: e.delivery} : {})}] : []),
        })), brief.language)).catch((e: unknown) => {
            log.warn(`the annotation is unusable (${e instanceof Error ? e.message : e}) - the script is used as written`)
            return undefined
        })
        return toScreenplay(applyAnnotations(imported, notes), meta)
    }

    // the dialogue is checked against the source: the LLM structures the script, it must not reword a line
    let result = toScreenplay(await askJson(screenplayParsePrompt(source, brief.language)), meta)
    // lost lines count as well: the check above only sees what the LLM added or changed
    const unfaithful = (play: typeof result) => [...missingDialogue(play, source), ...omittedSourceLines(play, source)]
    let missing = unfaithful(result)
    if (missing.length) {
        log.warn(`${missing.length} dialogue line(s) differ from or are missing in the screenplay - asking again`)
        result = toScreenplay(await askJson(screenplayParsePrompt(source, brief.language, missing)), meta)
        missing = unfaithful(result)
    }
    if (missing.length) {
        log.warn(`${missing.length} line(s) still differ from or are missing in the screenplay - fix them in ${film.file}, or run --redo=screenplay:\n${missing.map(m => `  "${m}"`).join('\n')}`)
    }
    return result
}), value => {
    // with --review the whole script, as screenplay.fountain has it - else it is read in that file
    if (args.review) log.box('Screenplay', screenplayToFountain(value))
})
// the screenplay is the base of every expensive step after it: one that does not hold the whole source stops the run here
// (the source is checked again on every run, so a fix in project.json lets it through)
if (mode === 'screenplay') {
    // a Fountain source was read by code: its structure is complete by construction (and its actions are tidied into English, which a word comparison would take for lost lines)
    const unfaithful = parseFountain(source) ? missingDialogue(screenplay, source) : [...missingDialogue(screenplay, source), ...omittedSourceLines(screenplay, source)]
    if (unfaithful.length && !args['allow-import-gaps']) {
        throw new Error(`the structured screenplay is not the source: ${unfaithful.length} line(s) are changed or missing:\n${unfaithful.slice(0, 10).map(m => `  "${m}"`).join('\n')}\nfix them in ${film.file}, run --redo=screenplay, or go on anyway with --allow-import-gaps`)
    }
}
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
            const keep = join(film.dir, 'old', `script-fix-${versionStamp()}`)
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
const cast = await reviewed(film, args.review, 'cast', () => film.step('cast', '4 · CASTING CHARACTERS & LOCATIONS', async () => {
    const attempt = (problems: string[] = []) => askJson<Parameters<typeof toCast>[0]>(castPrompt(screenplay, outline, problems, mode === 'screenplay' ? source : undefined, brief.setting))
    let raw = await attempt()
    // what is left out is asked for - up to twice; an answer that fixes it can leave out something the one before had, so the answers are merged
    for (let tries = 0; ; tries++) {
        try {
            return toCast(raw, screenplay)
        } catch (e) {
            if (!(e instanceof Error) || !e.message.startsWith('not in the cast: ') || tries >= 2) throw e
            log.warn(`${e.message} - asking again`)
            raw = mergeRawCasts(raw, await attempt(e.message.replace('not in the cast: ', '').split('; ')))
        }
    }
}), value => {
    for (const c of value.characters) log.step(c.voiceOnly ? 'Voice' : 'Character', `${styles.name(c.name)} ${styles.muted(`- ${c.role} · ${c.voice}`)}`)
    for (const l of value.locations) log.step('Location', styles.name(l.name))
})

/////////// 4b · CASTING - who plays each role and which picture each place has: the film's own or a library asset (casting.json,
// as in the music video - lib/casting.ts). A library asset is copied into the film and never rendered; its description
// stands in for the look and the description of the steps below. A narrator's voice has no picture and no entry.
const casting = await castFromLibrary({
    dir: film.dir, cast: {characters: cast.characters.filter(c => !c.voiceOnly), locations: cast.locations}, library: await libraryDir(), copies: film.data.castingCopies,
    again: kind => `its look and description were the library's: bun film.ts ${filmId} --redo=${kind === 'character' ? 'characterLooks' : 'locationLooks'} makes them anew`,
})
if (Object.keys(casting.copies).length) film.data.castingCopies = casting.copies
else delete film.data.castingCopies
if (casting.changed) await film.save()
const casted = (kind: AssetKind, id: string) => casting.assets.get(copyKey(kind, id))
// the other looks of a library character: with sequence sheets their sheets start on the library anchor (PictureJob.look);
// without, they are drawn from its description - the picture they are drawn after is not the library's
for (const c of cast.characters) {
    const asset = casted('character', c.id)
    if (asset && c.states?.length && !config.sequenceSheets) log.warn(`${c.id} is library:${asset.id} - its other looks (${c.states.map(s => s.name).join(', ')}) are drawn from the library's description, the face may differ from the library picture`)
}
// designed views (locationViews) describe the sheet the film renders for the place - a library place brings its own sheet
if (config.sequenceSheets && config.locationViews) for (const l of cast.locations) {
    const asset = casted('location', l.id)
    if (asset) log.warn(`${l.id} is library:${asset.id} - its sheet is the library's, not one of the designed views (locationViews): a shot may name a view its picture does not show`)
}
// a library asset's description, also in a step kept from an earlier run (casting.json was changed since)
const fromLibrary = (kind: AssetKind, values: Record<string, string>) => {
    for (const [key, asset] of casting.assets) if (key.startsWith(`${kind}:`)) values[key.slice(kind.length + 1)] = asset.description
}

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
const lookBrief = await reviewed(film, args.review, 'lookBrief', () => film.step('lookBrief', '6 · DESIGNING THE FILM LOOK', () => ask(lookBriefPrompt(style, `${brief.genre}, ${brief.tone}, ${brief.setting}. ${summary}`))),
    value => log.box('Look brief', value))

/////////// 7 · CHARACTER LOOKS - a reference picture for everyone who is seen (a narrator's voice has none)
const seen = cast.characters.filter(c => !c.voiceOnly)
const characterLooks = await film.step('characterLooks', '7 · CRAFTING CHARACTER LOOKS', async () => {
    const looks: Record<string, string> = {}
    for (const [i, char] of seen.entries()) {
        log.step(`Character ${i + 1}/${seen.length}`, styles.name(char.id))
        const otherLooks = seen.filter(c => c.id !== char.id && looks[c.id]).map(c => ({name: c.name, look: looks[c.id]!}))
        // the script's own description of the character is a fact the picture has to show
        const lookOptions = characterLookPrompt(lookBrief, {name: char.name, role: `${char.role} Appearance: ${char.appearance} Keep the age, build and proportions this appearance gives, whatever they are - tell the characters apart by hair, face, clothing and gear, never by changing the height or build. The picture shows the whole body: name the whole outfit from head to feet - every garment, trousers or a skirt and the shoes included.`}, otherLooks)
        looks[char.id] = casted('character', char.id)?.description ?? await film.each('characterLooks', char.id, lookOptions, () => ask(lookOptions))
        // other looks of the character (wounded, disguised): the same prompt with only the change applied
        for (const state of char.states ?? []) {
            const stateOptions = stateLookPrompt(looks[char.id]!, char.name, state)
            looks[statePictureId(char.id, state.id)] = await film.each('characterLooks', statePictureId(char.id, state.id), stateOptions, () => ask(stateOptions))
        }
    }
    return looks
})
fromLibrary('character', characterLooks)
for (const [id, look] of Object.entries(characterLooks)) log.box(id, look)

/////////// 7b · the character looks without the reference sheet (pose, grey background, studio light) - for the clip prompts
const characterDescriptions = await film.step('characterDescriptions', '7b · DESCRIBING THE CHARACTERS FOR THE CLIPS', async () => {
    const descriptions: Record<string, string> = {}
    for (const [i, char] of seen.entries()) {
        log.step(`Character ${i + 1}/${seen.length}`, styles.name(char.id))
        const descriptionOptions = characterDescriptionPrompt(characterLooks[char.id] ?? '')
        descriptions[char.id] = casted('character', char.id)?.description ?? await film.each('characterDescriptions', char.id, descriptionOptions, () => ask(descriptionOptions))
        for (const state of char.states ?? []) {
            const stateOptions = characterDescriptionPrompt(characterLooks[statePictureId(char.id, state.id)] ?? '')
            descriptions[statePictureId(char.id, state.id)] = await film.each('characterDescriptions', statePictureId(char.id, state.id), stateOptions, () => ask(stateOptions))
        }
    }
    return descriptions
})
fromLibrary('character', characterDescriptions)
for (const [id, description] of Object.entries(characterDescriptions)) log.box(id, description)

/////////// 8 · LOCATION LOOKS
const locationLooks = await film.step('locationLooks', '8 · CRAFTING LOCATION LOOKS', async () => {
    const looks: Record<string, string> = {}
    for (const [i, location] of cast.locations.entries()) {
        log.step(`Location ${i + 1}/${cast.locations.length}`, styles.name(location.id))
        const lookOptions = locationLookPrompt(lookBrief, summary, `${location.name} - ${location.description} Show the place only as the film first sees it: leave out what the story reveals, builds or changes later, and every object that anyone picks up, carries, uses or moves.`)
        looks[location.id] = casted('location', location.id)?.description ?? await film.each('locationLooks', location.id, lookOptions, () => ask(lookOptions))
    }
    return looks
})
fromLibrary('location', locationLooks)
for (const [id, look] of Object.entries(locationLooks)) log.box(id, look)

/////////// 8b · the location looks without the establishing shot (camera, "empty") - for the clip prompts
const locationDescriptions = await film.step('locationDescriptions', '8b · DESCRIBING THE LOCATIONS FOR THE CLIPS', async () => {
    const descriptions: Record<string, string> = {}
    for (const [i, location] of cast.locations.entries()) {
        log.step(`Location ${i + 1}/${cast.locations.length}`, styles.name(location.id))
        const descriptionOptions = locationDescriptionPrompt(locationLooks[location.id] ?? '')
        descriptions[location.id] = casted('location', location.id)?.description ?? await film.each('locationDescriptions', location.id, descriptionOptions, () => ask(descriptionOptions))
    }
    return descriptions
})
fromLibrary('location', locationDescriptions)
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
            const viewsOptions = locationViewsPrompt(location, locationLooks[location.id] ?? '', scenes)
            result[location.id] = await film.each('locationViews', location.id, viewsOptions, async () => {
                const answer = await askJson<{ views?: Partial<LocationView>[] }>(viewsOptions)
                const views = (answer.views ?? []).filter(v => typeof v?.name === 'string' && typeof v?.shows === 'string' && v.name.trim() && v.shows.trim()).map(v => ({name: v.name!.trim(), shows: v.shows!.trim()}))
                if (views.length !== 5) throw new Error(`the views of ${location.name}: ${views.length} instead of 5 - run it again (--redo=locationViews)`)
                return views
            })
        }
        return result
    })
    : {} as Record<string, LocationView[]>
for (const [id, views] of Object.entries(locationViews)) log.step(id, styles.muted(views.map((v, i) => `${i + 1}. ${v.name}`).join(' · ')))

/////////// 8d · PROPS - the things people handle that come back (an umbrella, a key), each with a picture of its own: without it the video
// model drew the thing anew in every clip, with another canopy and handle
const props = await film.step('props', '8d · FINDING THE PROPS', async () => toProps((await askJson<{ props?: unknown }>(propsPrompt(screenplay, cast))).props))
for (const prop of props) log.step(prop.id, styles.muted(prop.description))

const pictures = filmPictures(cast, {characterLooks, characterDescriptions, locationLooks, locationDescriptions, locationViews, props})
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
    const keepsShots = keptBasis === undefined || keptBasis === coverageBasis()
    if (!keepsShots) log.warn('the screenplay, cast or look changed since the shots were planned - every scene is planned again, --scenes cannot keep the old shots')
    for (const [i, scene] of screenplay.scenes.entries()) {
        // a scene that is not named keeps the shots it had
        const kept = keepsShots ? keptCoverage?.find(c => c.sceneId === scene.id) : undefined
        if (sceneIds.size && !sceneIds.has(scene.id) && kept) {
            log.step(`Scene ${i + 1}/${screenplay.scenes.length}`, styles.muted(`${scene.id} keeps its shots`))
            result.push(kept)
            continue
        }
        log.step(`Scene ${i + 1}/${screenplay.scenes.length}`, styles.name(`${scene.setting}. ${scene.location} - ${scene.time}`))
        const location = locationOf(cast, scene.location)!
        const planScene = async () => {
            let problems: string[] = []
            for (let attempt = 0; ; attempt++) {
                const raw = await askJson<RawCoverage>(coveragePrompt(scene, location, cast.characters, languageName(brief.language) ?? brief.language, lookBrief, budgetOf(scene), maxShotsFor(scene), problems, handover(i), locationViews[location.id], i + 1, props))
                try {
                    // the first time what the script checks find is a reason to ask again, the second time it is only noted
                    const {coverage: planned, notes} = toCoverage(raw, scene, cast, attempt === 0, namedByScene(screenplay.scenes, cast.characters, i), i + 1, props)
                    for (const note of notes) log.warn(note)
                    return planned
                } catch (e) {
                    // a dropped line of dialogue or a wrong name is what the model can fix when told - once
                    if (!(e instanceof CoverageProblem) || attempt >= 1) throw e
                    problems = e.problems
                    log.warn(`${e.message} - asking again`)
                }
            }
        }
        // kept as soon as it is planned: a failure on a later scene does not cost the scenes before it. What it was asked
        // (the first prompt, with the hand-over of the scene before) decides whether it is asked again
        const firstAsk = coveragePrompt(scene, location, cast.characters, languageName(brief.language) ?? brief.language, lookBrief, budgetOf(scene), maxShotsFor(scene), [], handover(i), locationViews[location.id], i + 1, props)
        result.push(await film.each('coverage', scene.id, firstAsk, planScene))
    }
    return result
})

/////////// 10 · CLIPS - shots packed into clips of up to ~9 s, then the H3 requests, built deterministically and never cached
// Without designed views every clip is given the one view of its place its shots are in, read from the rendered sheet
// (lib/film/views.ts) - made again after the pictures of this run, so a sheet rendered now gets its views at once.
let clips: ReturnType<typeof packClips> = []
let requests: ReturnType<typeof buildFilmClipRequests> = []
async function planClips() {
    const sheetViews = config.sequenceSheets && !config.locationViews ? await readSheetViews(film, cast, locationDescriptions) : {}
    const shotViews = await chooseShotViews(film, coverage, sceneId => locationOf(cast, screenplay.scenes.find(s => s.id === sceneId)!.location)?.id, sheetViews)
    clips = packClips(screenplay, withShotViews(coverage, shotViews), config.continuity, maxClipFor(MAX_CLIP_SEC, config.contextFrames, config.continuity))
    requests = buildFilmClipRequests({
        screenplay, cast, clips,
        soundscapes: Object.fromEntries(coverage.map(c => [c.sceneId, c.soundscape])),
        stagings: Object.fromEntries(coverage.map(c => [c.sceneId, c.staging ?? ''])),
        voices: Object.fromEntries(coverage.map(c => [c.sceneId, c.voices === true])),
        characterDescriptions, locationDescriptions, locationViews: {...sheetViews, ...locationViews}, lookBrief, props,
        pinStartFrame: filmRenderConfig(config).pinStartFrame,   // the film renders with the defaults of the render config
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
    await Bun.write(join(outputDir, 'timeline.edl'), timelineEdl(screenplay.title, requests.map(r => ({id: r.id, frames: r.frames, startsFrom: r.startsFrom}))))
    await Bun.write(join(outputDir, 'shotlist.md'), shotlistMarkdown({screenplay, cast, coverage, clips}))
    for (const request of requests) log.box(`${request.id} · ${request.sceneId} · ${request.seconds}s${request.startsFrom ? ` · goes on from ${request.startsFrom}` : ''}`, request.prompt)
    log.step('Clips', `${clips.length} ${styles.muted(`· ${(clips.reduce((sum, c) => sum + c.frames, 0) / 24).toFixed(1)}s · ${requests.reduce((sum, r) => sum + r.dialogue.length, 0)} dialogue lines · requests in ${join(outputDir, 'clips')}`)}`)
}
await planClips()

/////////// 11 · RENDERING WITH COMFYUI
if (render.has('images') || render.has('videos')) {
    const renderConfig = filmRenderConfig(config)
    // the project id is part of ComfyUI's folder - "film-" keeps it apart from a music video of the same name
    using renderer = new FilmRenderer(`film-${film.id}`, film.dir, renderConfig, settings.comfy)
    // what was made from another request than the plan has now is rendered again - the old ones are kept (lib/provenance.ts)
    renderer.refresh = new Set(args.refresh.split(',').filter(Boolean))
    log.section('11 · RENDERING WITH COMFYUI')
    log.step('Config', styles.muted(`seed ${config.seed}, images ${config.imageResolution} (${renderConfig.imageWorkflow})${config.sequenceSheets ? `, sequence sheets (${renderConfig.sequenceWorkflow})` : ''}`))
    log.step('Servers', settings.comfy.map(s => `${styles.name(s.name)} ${styles.muted(s.url)}`).join(', '))
    if (render.has('images')) {
        log.step('Pictures', `${pictures.length}${config.sequenceSheets ? styles.muted(' (multi-angle reference sheets)') : ''}`)
        const renderPicture = (picture: PictureJob) => config.sequenceSheets && picture.kind !== 'prop' ? renderer.renderSequenceSheet(picture) : renderer.renderPicture(picture)
        await renderAll(pictures.filter(p => !p.baseId), renderPicture)
        // another look of a character is drawn with the seed of the normal picture - that keeps the face; it waits for it
        await renderAll(pictures.filter(p => p.baseId), p => renderPicture({...p, seed: pictureSeed(film.dir, p.baseId!)}))
    }
    // a sheet rendered just now gets its views read, and the clips their view, before they are rendered
    if (render.has('images') && render.has('videos') && config.sequenceSheets && !config.locationViews) await planClips()
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
            for (const clip of chain) await renderer.renderFilmClip(clip, requests.find(r => r.id === clip.startsFrom))
        })
        // on request, and only for the clips named: they are put away in old/attempts/ and rendered again, with a new seed
        if (args.again) {
            if (config.seed !== -1) log.warn(`"seed" is ${config.seed} in config.json - the same seed gives the same clip again; -1 gives a new one every time`)
            const stamp = versionStamp()
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
    // a clip made from another picture, workflow or start frame than the plan has now is still a clip: said here, an error only with --strict
    const filmConfig = filmRenderConfig(config)
    const stale = selected.filter(r => filmClipFreshness(r, film.dir, filmConfig) === 'stale').map(r => r.id)
    if (stale.length) {
        const message = `${stale.length} clip(s) were made from another prompt, picture or start frame than the plan has now: ${stale.join(', ')} - render them again with --render=videos --refresh=clips`
        if (args.strict) throw new Error(message)
        log.warn(message)
    }
    // a clip with dialogue keeps all the frames the model rendered: its last word can fall behind the planned end
    const result = await assembleFilm({clips: selected.map((r, i) => ({id: r.id, frames: r.frames, useRendered: r.dialogue.length > 0, continuesPrevious: r.startsFrom !== undefined && r.startsFrom === selected[i - 1]?.id && !startedOnContext(film.dir, r.id)})), projectDir: film.dir, target, levelMatching: config.levelMatching})

    // a score in input/ is mixed under the film
    const score = SCORE_EXTENSIONS.map(ext => film.input(`score.${ext}`)).find(file => existsSync(file))
    if (score) {
        await addScore(target, score, config.scoreVolume)
        log.step('Score', `${score} ${styles.muted(`under the film at ${config.scoreVolume} dB, ducking under the dialogue`)}`)
    }

    // the finish and a film at another frame rate, as in the music video (lib/final-pass.ts) - before the subtitles, which every
    // one of the films then gets: burned in after the grade and the grain, the text stays clean
    const videos = [target]
    const finishing = finishOf(config.finish)
    // where each clip is in the film - the same seconds at every frame rate
    const spans = selected.map((r, i) => ({id: r.id, start: result.starts[i]!, end: result.starts[i]! + secondsAt(result.used[i]! - result.skipped[i]!)}))
    if (finishing) videos.push(await finishCopy(target, finishing, spans))
    if (config.finalFps !== FPS) {
        using smoother = new FilmRenderer(`film-${film.id}`, film.dir, filmRenderConfig(config), settings.comfy)
        const {files, multiplier} = await interpolateClips(smoother, selected.map((r, i) => ({id: r.id, frames: result.used[i]!, shots: r.shots})), config.interpolationModel, config.finalFps)
        const smooth = target.replace(/\.mp4$/, `-${config.finalFps}fps.mp4`)
        const more = await assembleSmoothFilm({clips: selected.map((r, i) => ({id: r.id, used: result.used[i]!, skipped: result.skipped[i]!})), files, multiplier, fps: config.finalFps, sound: target, target: smooth})
        log.step('Saved', `${smooth} ${styles.muted(`${more.width}x${more.height}, ${more.frames} frames at ${config.finalFps} fps, ${more.seconds.toFixed(3)}s`)}`)
        videos.push(smooth)
        if (finishing) videos.push(await finishCopy(smooth, finishing, spans))
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
        for (const video of videos) {
            if (config.burnSubtitles) await burnSubtitles(video, srt)
            else await muxSubtitles(video, srt, config.subtitles === 'script' ? undefined : config.subtitles)
        }
        log.step('Subtitles', `${srt} ${styles.muted(`${cues.length} cues, ${config.burnSubtitles ? 'burned into the picture' : 'also a track in the mp4'}${videos.length > 1 ? ` of all ${videos.length} films` : ''} - timing is estimated`)}`)
    } else if (config.subtitles !== 'off') {
        log.step('Subtitles', styles.muted(config.subtitles === 'script' ? 'none - the screenplay has no translations under its lines (config.json: "subtitles": "en" translates them)' : 'none - every line is in that language already'))
    }
    log.step('Saved', `${target} ${styles.muted(`${result.width}x${result.height}, ${result.frames} frames, ${result.duration}${only.size ? ` - ${selected.length} of ${requests.length} clips (--only)` : ''}`)}`)
}


/** --dry-run: what the run would redo and render, with an estimate - nothing is done (as in the music video). */
async function dryRun() {
    const mode = await filmMode(film.dir)
    const changed = film.changedInputs(await filmInputs(film.dir, config))
    const reasons: [string, FilmStepName[]][] = [
        ...(redoSteps.length ? [['--redo', redoSteps] as [string, FilmStepName[]]] : []),
        ...changed.map(c => [`${c.name} changed`, c.steps] as [string, FilmStepName[]]),
    ]
    const redone = film.redoneBy(reasons.flatMap(([, steps]) => steps))
    // the subtitles are translated when the film is assembled - only --render=final makes them
    const missing = FILM_STEP_NAMES.filter(step => film.data[step] === undefined && !redone.includes(step) && filmStepUsed(step, mode, film.data, config) && (step !== 'subtitles' || render.has('final')))

    log.section('DRY RUN - nothing is done')
    for (const [why, steps] of reasons) log.step(why, styles.muted(`redoes ${steps.join(', ')}`))
    log.step('Redone', redone.length ? redone.map(styles.name).join(', ') : styles.muted('nothing - every step is taken from project.json'))
    if (missing.length) log.step('Generated', `${missing.map(styles.name).join(', ')} ${styles.muted('- not generated yet')}`)

    if (!render.has('images') && !render.has('videos') && !render.has('final')) return
    const renderConfig = filmRenderConfig(config)
    const state = await filmRenderState(film.dir, film.id, renderConfig)
    const servers = settings.comfy.map(s => s.name)
    const refreshKinds = new Set(args.refresh.split(',').filter(Boolean))
    if (redone.length || missing.length) log.warn('the renders below are counted from the requests of the last plan run - the steps redone now can change them')
    if (render.has('images')) {
        const stale = refreshKinds.has('pictures') ? styles.muted(' (stale pictures are not counted - --refresh=pictures renders those too)') : ''
        log.step('Pictures', state.missingPictures.length ? `${await pictureEstimate(state.missingPictures.length, renderConfig, servers)}${stale}` : styles.muted('all rendered'))
    }
    if (render.has('videos')) {
        const only = new Set(args.only.split(',').filter(Boolean))
        const selected = state.clips.filter(c => !only.size || only.has(c.id))
        const todo = selected.filter(c => args.again || state.missingClips.includes(c) || (refreshKinds.has('clips') && state.staleClips.includes(c)))
        log.step('Clips', todo.length ? `${await clipEstimate(todo, renderConfig, servers)} ${styles.muted(`- ${formatSlotRanges(todo.map(c => c.id))}`)}` : styles.muted('all rendered'))
    }
    if (render.has('final')) log.step('Film', state.missingClips.length ? styles.warning(`needs every clip - ${state.missingClips.length} missing`) : styles.muted('assembled from the clips'))
}
