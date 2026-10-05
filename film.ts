// The short-film pipeline: a story idea or a screenplay (any language) -> screenplay, cast, locations.
// Separate from the music-video pipeline (index.ts) - it shares the LLM client, the settings and the helpers, nothing else.
// usage: bun film.ts <film-id> [--redo=screenplay,cast]
import {existsSync, readdirSync} from "node:fs";
import {join} from "node:path";
import {parseArgs} from "node:util";
import {languageName} from "./lib/config.ts";
import {buildFilmClipRequests} from "./lib/film/compose.ts";
import {loadFilmConfig} from "./lib/film/config.ts";
import {CoverageProblem, packClips, type RawCoverage, toCoverage} from "./lib/film/coverage.ts";
import {screenplayToFountain} from "./lib/film/fountain.ts";
import {filmPictures, filmRenderConfig, renderAll} from "./lib/film/pictures.ts";
import {FilmRenderer} from "./lib/film/render.ts";
import {briefPrompt, castPrompt, coveragePrompt, outlinePrompt, screenplayParsePrompt, screenplayWritePrompt, styleShortlistPrompt, summaryPrompt} from "./lib/film/prompts.ts";
import {estimateSeconds, locationOf, missingDialogue, toCast, toScreenplay} from "./lib/film/screenplay.ts";
import {filmExists} from "./lib/film/setup.ts";
import {askFilmJson as askJson} from "./lib/film/json.ts";
import {FILM_STEP_NAMES, FILMS_DIR, FilmStore, type FilmStepName} from "./lib/film/store.ts";
import type {Brief, FilmMode, Outline, SceneCoverage} from "./lib/film/types.ts";
import {ask, configureLlm} from "./lib/llm.ts";
import {log, printBanner, styles} from "./lib/log.ts";
import {characterDescriptionPrompt, characterLookPrompt, locationDescriptionPrompt, locationLookPrompt, lookBriefPrompt} from "./lib/prompts.ts";
import {validProjectId} from "./lib/project-setup.ts";

import {loadSettings} from "./lib/settings.ts";
import {type FilmStyle, pickStyle, shuffledStyles, stylesById} from "./lib/styles.ts";

process.on('unhandledRejection', e => log.fatal(e instanceof Error ? e.message : String(e)))
process.on('uncaughtException', e => log.fatal(e instanceof Error ? e.message : String(e)))

printBanner()

const usage = `bun film.ts <film-id> [--redo=screenplay,cast] [--render=images,videos|all] [--only=clip-005,clip-006] [--llm-url=…] [--llm-key=…] [--llm-model=…] [--comfy=http://a:8188,…]
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
const render = new Set(args.render.split(',').filter(Boolean).flatMap(r => r === 'all' ? ['images', 'videos'] : [r]))
const unknownRender = [...render].filter(r => r !== 'images' && r !== 'videos')
if (unknownRender.length) log.usageError(`--render: unknown "${unknownRender.join(', ')}" - use images, videos or all`, usage)
const redoSteps =args.redo.split(',').filter(Boolean) as FilmStepName[]
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
    targetDuration: {value: String(config.targetDuration), steps: ['outline']},
    'style.txt': {value: style, steps: ['lookBrief']},
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
    let candidates: FilmStyle[] = []
    try {
        const shortlist = await askJson<{ styles: string[] }>(styleShortlistPrompt(brief, summary, shuffledStyles(), 5))
        candidates = stylesById(shortlist.styles)
    } catch (e) {
        log.step('Style', styles.muted(`no shortlist from the LLM (${e instanceof Error ? e.message : e}) - picking from the whole list`))
    }
    const picked = pickStyle(candidates.length ? candidates : undefined)
    style = picked.text
    await Bun.write(film.input('style.txt'), style)
    await film.recordInput('style.txt', style)
    log.step('Picked style', `${styles.name(picked.name)} ${styles.muted(`${candidates.length ? `- one of: ${candidates.map(c => c.name).join(', ')} ` : ''}- written to input/style.txt, edit or replace it to change the look`)}`)
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

const pictures = filmPictures(cast, {characterLooks, characterDescriptions, locationLooks, locationDescriptions})
await Bun.write(join(film.dir, 'assets.json'), JSON.stringify(pictures, null, 2))

/////////// 9 · SHOTS - every scene broken into shots, one LLM call per scene
const coverage = await film.step('coverage', '9 · PLANNING THE SHOTS', async () => {
    const result: SceneCoverage[] = []
    for (const [i, scene] of screenplay.scenes.entries()) {
        log.step(`Scene ${i + 1}/${screenplay.scenes.length}`, styles.name(`${scene.setting}. ${scene.location} - ${scene.time}`))
        const location = locationOf(cast, scene.location)!
        let problems: string[] = []
        for (let attempt = 0; ; attempt++) {
            const raw = await askJson<RawCoverage>(coveragePrompt(scene, location, cast.characters, languageName(brief.language) ?? brief.language, lookBrief, problems))
            try {
                result.push(toCoverage(raw, scene, cast))
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
    characterDescriptions, locationDescriptions, lookBrief,
})
const outputDir = join(film.dir, 'output')
for (const request of requests) await Bun.write(join(outputDir, 'clips', `${request.id}.json`), JSON.stringify(request, null, 2))
await Bun.write(join(outputDir, 'timeline.json'), JSON.stringify({
    title: screenplay.title,
    language: screenplay.language,
    totalFrames: clips.reduce((sum, c) => sum + c.frames, 0),
    clips: requests.map(r => ({id: r.id, scene: r.sceneId, frameStart: r.frameStart, frames: r.frames, seconds: r.seconds, shots: r.shots.length, dialogue: r.dialogue.length, ...(r.startsFrom ? {startsFrom: r.startsFrom} : {}), request: `clips/${r.id}.json`})),
}, null, 2))
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
        await renderAll(pictures, picture => config.sequenceSheets ? renderer.renderSequenceSheet(picture) : renderer.renderPicture(picture))
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
        await renderAll(clipChains(selected), async chain => {
            for (const clip of chain) await renderer.renderFilmClip(clip)
        })
    }
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
