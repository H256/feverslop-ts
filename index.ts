import slugify from "slugify";
import {existsSync} from "node:fs";
import {parseArgs} from "node:util";
import {failRun, formatDuration, hideDetails, keepLogIn, log, printBanner, runLogFile, runWarnings, setOutput, showsDetails, styles} from "./lib/log.ts";
import {keepTimingsIn, readTimings, recordTiming, runTimings} from "./lib/timings.ts";
import {describePrediction, predictJobs, type RenderJob, resolutionPixels} from "./lib/predict.ts";
import {ask, askJson, configureLlm, llmMap} from "./lib/llm.ts";
import {mkdirSync, rmSync} from "node:fs";
import {join} from "node:path";
import {LOCATION_VIEWS, SEQUENCE_FRAMES} from "./lib/sequenceSheet.ts";
import {type BeatShots, type Blocking, type Character, type Fact, type Location, type LocationLayout, ProjectStore, type PropStem, type Singing, STEP_NAMES, type StepName, type StoryBeat} from "./lib/project.ts";
import {clipChains, renderAll} from "./lib/batch.ts";
import {multiplierFor} from "./lib/interpolate.ts";
import {finishFilter, finishOf, finishVideo} from "./lib/finish.ts";
import {lockProject} from "./lib/lock.ts";
import {analyzeSong, buildTimeline, cutAudio, mapBeatsToSlots, mixStems, parseLyricSections, separateInstrumentStems, splitFightSlots, separateStems, stemActivity, transcribeVocals} from "./lib/music.ts";
import {asBeatShots, type Issue, parseShotLines, readBeatPlan} from "./lib/shot-plan.ts";
import {playingCases, playingIssues} from "./lib/playing-check.ts";
import {resolveUnknownTokens} from "./lib/refs.ts";
import {beatsPrompt, blockingPrompt, filmableRules, musicStretches, type PlanContext, plannerCalls, planPrompt} from "./lib/shot-planner.ts";
import {boundaryFrameAsset, buildClipRequests, type ClipRequest, computeMemberCounts, isContinuous, countShotsPerBeat, groupMemberId, pictureAsset, propActivityPerBeat, singingPerBeat} from "./lib/compose.ts";
import {clipFingerprint, type PictureJob, Renderer, workflowHash} from "./lib/render.ts";
import {languageName, loadProjectConfig} from "./lib/config.ts";
import {alignLyrics, lowConfidence, sungLines} from "./lib/lyrics.ts";
import {projectLyricSections} from "./lib/music.ts";
import {archiveFiles, versionStamp} from "./lib/archive.ts";
import {assembleFinal, formatSlotRanges} from "./lib/assemble.ts";
import {freshness} from "./lib/provenance.ts";
import {PREVIOUS, requestChanges, startOutput} from "./lib/previous-output.ts";
import {writeGallery} from "./lib/gallery.ts";
import {EXPORT_FORMATS, type ExportFormat, exportTimelines} from "./lib/timeline-export.ts";
import {FPS, formatTime, frameAt, secondsAt} from "./lib/frames.ts";
import {loadSettings} from "./lib/settings.ts";
import {MAX_REFERENCE_IMAGES} from "./comfy/helpers.ts";
import {type FilmStyle, pickStyle, shuffledStyles, stylesById} from "./lib/styles.ts";
import {listProjects, projectExists, validProjectId} from "./lib/project-setup.ts";
import * as clack from "@clack/prompts";
import {pictureProp, propMissing} from "./lib/prop-check.ts";
import {projectInputs, stepUsed} from "./lib/inputs.ts";
import {clipEstimate, pictureEstimate, renderState} from "./lib/render-state.ts";
import {reviewed} from "./lib/review.ts";
import {CASTING_FILE, copyCasting, copyKey, droppedCopies, readCastingFile, resolveCasting, writeCastingOnce} from "./lib/casting.ts";
import {type LibraryAsset, libraryDir, libraryIds, readLibraryAsset} from "./lib/library.ts";
import {assetPaths, type AssetKind} from "./lib/asset-import.ts";
import {redoAfter} from "./lib/project.ts";
import {
    castPrompt, voiceRules, characterDescriptionPrompt, characterLookPrompt, characterVariantLookPrompt, locationAnchorPrompt, locationDescriptionPrompt, locationLayoutPrompt,
    locationLookPrompt, lookBriefPrompt, songLyricsPrompt, songStylePrompt, storyPrompt, styleShortlistPrompt, summaryPrompt,
} from "./lib/prompts.ts";

// any step's rejected promise (everything here is awaited, so a thrown Error from deep in the pipeline surfaces
// as one of these) gets the same tidy red box as a bad --flag, instead of Bun's raw stack-trace dump
process.on('unhandledRejection', failRun)
process.on('uncaughtException', failRun)

printBanner()

// hardware limit: the longest clip the video model can generate in one go. Set a little below the real
// limit - the H3 node only renders 5 + 17·k frames, so every clip is rounded up to the next such length at
// render time (up to 16 extra frames / 0.67s, see docs/comfyui.md) - a clip targeted at exactly the real
// limit can still render over it.
const MAX_CLIP_SEC = 10 - 17 / FPS

// bun index.ts [project-id] [--redo=story,beats] [--render=song,images,videos,final|all] [--only=slot-001,slot-002]
//              [--llm-url=…] [--llm-key=…] [--llm-model=…] [--comfy=http://a:8188,http://b:8188] [--legacy-moments] [--debug-audio]  (this run only)
const usage = `bun index.ts [project-id] [--redo=story,beats] [--render=song,images,videos,final|all] [--only=slot-001,slot-002] [--again]
             [--llm-url=…] [--llm-key=…] [--llm-model=…] [--llm-parallel=2] [--comfy=http://a:8188,http://b:8188] [--legacy-moments] [--debug-audio]
             [--refresh=pictures,clips] [--strict] [--debug] [--review] [--dry-run] [-v|--verbose] [--show=story,cast,clips]   (--debug: the stack trace of a failure · --review: stop after story, cast, look and beats to accept, edit or redo them · --dry-run: what the run would redo and render, nothing is done · -v: every detail as before · --show: the details of these cached steps, clips = the prompts · --refresh: render stale ones again, the old ones are kept · --strict: the final video needs every clip to be current)
bun index.ts [project-id] --export=mlt,openshot|all   (writes timeline.mlt for Shotcut/Kdenlive and/or timeline.osp for OpenShot: the rendered clips on one track, the song under them)
bun index.ts [project-id] --gallery   (writes <project>/gallery.html, an overview of the assets generated so far - runs nothing else)`
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
                'llm-url': {type: 'string'},
                'llm-key': {type: 'string'},
                'llm-model': {type: 'string'},
                'llm-parallel': {type: 'string'},
                comfy: {type: 'string'},
                // skips step 11b and spreads/reuses beat.moments across shots the old way - a fallback while 11b is new
                'legacy-moments': {type: 'boolean', default: false},
                'debug-audio': {type: 'boolean', default: false},
                refresh: {type: 'string', default: ''},
                strict: {type: 'boolean', default: false},
                // read by failRun (lib/log.ts) from the raw arguments - declared here so parseArgs accepts it
                debug: {type: 'boolean', default: false},
                gallery: {type: 'boolean', default: false},
                // says what --redo, changed inputs and --render would do, and does nothing
                'dry-run': {type: 'boolean', default: false},
                export: {type: 'string', default: ''},
                // the terminal shows a cached step as one line; -v everything, --show=story,clips the details of those
                verbose: {type: 'boolean', short: 'v', default: false},
                show: {type: 'string', default: ''},
                // stop after story, cast, look and beats when they were just generated: accept, edit, again, stop
                review: {type: 'boolean', default: false},
            },
        })
    } catch (e) {
        return log.usageError(e instanceof Error ? e.message : String(e), usage)
    }
})()
setOutput({verbose: args.verbose, show: args.show.split(',').filter(Boolean)})
// --render=all is images, videos and the final video, in that order - "song" is never part of "all", it has to be asked for
const render = new Set(args.render.split(',').filter(Boolean).flatMap(r => r === 'all' ? ['images', 'videos', 'final'] : [r]))
const unknownRender = [...render].filter(r => !['song', 'images', 'videos', 'final'].includes(r))
if (unknownRender.length) log.usageError(`--render: unknown "${unknownRender.join(', ')}" - use song, images, videos, final or all`, usage)
// --refresh=pictures,clips renders what was made from another request than the plan has now (lib/provenance.ts) again
const refreshKinds = new Set(args.refresh.split(',').filter(Boolean))
const unknownRefresh = [...refreshKinds].filter(k => k !== 'pictures' && k !== 'clips')
if (unknownRefresh.length) log.usageError(`--refresh: unknown "${unknownRefresh.join(', ')}" - use pictures, clips`, usage)
// --again renders the clips named in --only once more, with a new seed - the old version is put away in old/attempts/, never overwritten
if (args.again && !render.has('videos')) log.usageError('--again goes with --render=videos: it renders the clips named in --only again, with a new seed', usage)
if (args.again && !args.only) log.usageError('--again needs --only=slot-001,... - say which clips are rendered again, every one is GPU time', usage)
if (args.review && !(process.stdin.isTTY && process.stdout.isTTY)) log.usageError('--review asks in the terminal - run it in one', usage)
const exportFormats = [...new Set(args.export.split(',').filter(Boolean).flatMap(f => f === 'all' ? [...EXPORT_FORMATS] : [f]))]
const unknownFormats = exportFormats.filter(f => !(EXPORT_FORMATS as readonly string[]).includes(f))
if (unknownFormats.length) log.usageError(`--export: unknown "${unknownFormats.join(', ')}" - use ${EXPORT_FORMATS.join(', ')} or all`, usage)
const redoSteps = args.redo.split(',').filter(Boolean) as StepName[]
const unknownRedo = redoSteps.filter(s => !(STEP_NAMES as string[]).includes(s))
if (unknownRedo.length) log.usageError(`--redo: unknown step "${unknownRedo.join(', ')}" - use ${STEP_NAMES.join(', ')}`, usage)
// without an id: the projects to pick from in a terminal, else the list of them in the usage error
const projectId = positionals[0] ?? await pickProject()
if (!validProjectId(projectId)) log.usageError(`"${projectId}" is not a project id - lowercase letters, digits and "-" only (it is the folder name in projects/ and part of the ComfyUI client id)`, usage)
if (!projectExists(projectId)) {
    const existing = listProjects()
    log.usageError(`No project "${projectId}" in projects/ - ${existing.length ? `the projects here are: ${existing.join(', ')}. ` : ''}Create one with: bun run init`, usage)
}
const project = new ProjectStore(projectId)
const maxClipSec = MAX_CLIP_SEC
// before the load: a run that writes works from the state it read, so no other run may save in between
// --dry-run only reads: no lock, nothing saved
if (!args.gallery && !args['dry-run']) lockProject(project.dir, `project ${project.id}`)
await project.load()
if (!args['dry-run']) keepTimingsIn(project.dir)
// everything this run prints, also into the project (the terminal may show less of it) - not for a run that only reads
if (!args.gallery && !args['dry-run']) keepLogIn(join(project.dir, 'logs', `${versionStamp()}.log`))
if (args.gallery) {
    if (!existsSync(project.dir)) throw new Error(`No project "${project.id}" in projects/`)
    const {file, counts} = await writeGallery(project.dir, project.id, project.data)
    log.step('Gallery', `${file} ${styles.muted(Object.entries(counts).map(([tab, n]) => `${tab}: ${n}`).join(' · '))}`)
    process.exit(0)
}
// a dry run only says what would be redone (see dryRun below)
const timelineOutdated = project.data.timeline !== undefined && project.data.timeline.maxClipSec !== maxClipSec
if (!args['dry-run']) {
    for (const step of redoSteps) project.invalidate(step)
    if (timelineOutdated) project.invalidate('timeline')
}

const toId = (name: string) => slugify(name, {lower: true, strict: true})
const readInput = async (name: string) => existsSync(project.input(name)) ? (await Bun.file(project.input(name)).text()).trim() : ''
// true if `value`'s fingerprint differs from the one project.syncInputs() recorded after the previous run - a
// read-only check, for a step that needs to know this before that call itself has run (and recorded) this run's
// values; undefined (nothing recorded yet, e.g. the first run) never counts as changed
const inputChangedSinceLastRun = (name: string, value: string) => {
    const saved = project.data.inputs?.[name]
    return saved !== undefined && saved !== Bun.hash(value).toString(16)
}

/////////// GET LYRICS, STORY IDEA, STYLE AND CONFIG
log.section(`FEVERSLOP TS · ${project.id}`)
const config = await loadProjectConfig(project.dir)
const settings = await loadSettings({
    projectModel: config.llm.model,
    llmUrl: args['llm-url'],
    llmApiKey: args['llm-key'],
    llmModel: args['llm-model'],
    llmParallel: args['llm-parallel'],
    comfy: args.comfy,
})
configureLlm(settings.llm)
// where a setting comes from: (settings), (project), (env), (flag), (default)
const from = (source: string) => styles.muted(`(${source === 'file' ? 'settings' : source})`)
// the model itself is checked on the first LLM call - a fully cached project needs no server
log.step('LLM', settings.llm.url
    ? `${settings.llm.url} ${from(settings.sources.llmUrl)} · ${settings.llm.model ? `${styles.name(settings.llm.model)} ${from(settings.sources.llmModel)}` : styles.muted('the only model on the server')}`
    : styles.muted('none configured - fine while every step is cached, else run: bun run setup llm'))
if (args['dry-run']) {
    await dryRun()
    process.exit(0)
}
const language = languageName(config.lyricsLanguage)!
// --render=song always writes wav (see Renderer.renderSong); a hand-supplied song can be wav or mp3
const generatedSongFile = project.input('song.wav')

////////// WRITING & GENERATING THE SONG - only with --render=song
const idea = await readInput('idea.txt')
const musicStyleInput = await readInput('music-style.txt')
const lyricsBeforeSong = await readInput('lyrics.txt')
if (render.has('song')) {
    if (!idea) throw new Error('--render=song needs a song idea in input/idea.txt')

    // A hand-edit (or a deletion) of idea.txt/music-style.txt/lyrics.txt since the last run needs a new style this
    // run already - read-only, so the fingerprints it compares against are only recorded once, by the main
    // syncInputs() call further down, once this run's final lyrics.txt content is known.
    if (inputChangedSinceLastRun('idea.txt', idea) || inputChangedSinceLastRun('music-style.txt', musicStyleInput) || inputChangedSinceLastRun('lyrics.txt', lyricsBeforeSong)) {
        project.invalidate('songStyle')
    }

    // LYRICS - generated once from idea.txt; once lyrics.txt exists it's a plain input like story-idea.txt, never
    // auto-rewritten - delete it (or hand-correct it) to get it touched again.
    const lyricsExisted = existsSync(project.input('lyrics.txt'))
    if (!lyricsExisted) {
        log.section('1 · WRITING THE LYRICS')
        const generatedLyrics = await ask(songLyricsPrompt(idea, language, config.songDuration === -1 ? undefined : config.songDuration))
        log.box('Lyrics', generatedLyrics)
        await Bun.write(project.input('lyrics.txt'), generatedLyrics)
        project.invalidate('songStyle') // fresh lyrics need a style written to match them
    }
    const songLyrics = await readInput('lyrics.txt')

    // STYLE - redone whenever the lyrics or music-style.txt changed since the style currently cached was written
    const styleWasCached = project.data.songStyle !== undefined
    const songStyle = await project.step('songStyle', '1a · WRITING THE MUSICAL STYLE', () => ask(songStylePrompt(songLyrics, musicStyleInput, language)))
    log.box('Style', songStyle)
    if (!existsSync(project.input('music-style.txt'))) await Bun.write(project.input('music-style.txt'), songStyle)

    // AUDIO - only rendered again if the lyrics or the style actually changed this run, or there is none yet
    if (lyricsExisted && styleWasCached && existsSync(generatedSongFile)) {
        log.step('Song', styles.muted('input/song.wav is up to date - delete lyrics.txt, edit music-style.txt, or --redo=songStyle, to generate a new one'))
    } else {
        log.section('1b · GENERATING THE SONG AUDIO')
        if (existsSync(generatedSongFile)) {
            rmSync(generatedSongFile)
            log.step('Redo', styles.muted('song.wav - the lyrics or style changed'))
        }
        using songRenderer = new Renderer(project.id, project.dir, config, settings.comfy)
        await songRenderer.renderSong({style: songStyle, lyrics: songLyrics}, generatedSongFile)
    }
}

// the song a user supplies by hand can be song.wav or song.mp3 in input/ - a generated one (above) is always wav
const songFile = existsSync(generatedSongFile) ? generatedSongFile
    : existsSync(project.input('song.mp3')) ? project.input('song.mp3')
    : generatedSongFile

// re-read: the song block above may have just written lyrics.txt/music-style.txt for the first time
const lyrics = await readInput('lyrics.txt')
const musicStyle = await readInput('music-style.txt')
const storyIdea = await readInput('story-idea.txt')
let style = await readInput('style.txt')
// No style.txt on a project that has no look yet: the LLM shortlists a few styles from the list (lib/styles.ts) that
// fit the story, one of them is drawn at random - so the look neither follows the LLM's favorites nor ignores the
// story. It's written out like lyrics.txt/music-style.txt, so it is only picked once and can be edited or swapped.
// A project whose look is already cached keeps it - writing the file now would redo the look brief.
if (!style && project.data.lookBrief === undefined) {
    const storyText = [storyIdea, lyrics, idea].find(Boolean)
    let candidates: FilmStyle[] = []
    if (storyText) {
        try {
            const shortlist = await askJson<{ styles: string[] }>(styleShortlistPrompt(storyText, shuffledStyles(), 5))
            candidates = stylesById(shortlist.styles)
        } catch (e) {
            log.step('Style', styles.muted(`no shortlist from the LLM (${e instanceof Error ? e.message : e}) - picking from the whole list`))
        }
    }
    const picked = pickStyle(candidates.length ? candidates : undefined)
    style = picked.text
    await Bun.write(project.input('style.txt'), style)
    log.step('Picked style', `${styles.name(picked.name)} ${styles.muted(`${candidates.length ? `- one of: ${candidates.map(c => c.name).join(', ')} ` : ''}- written to input/style.txt, edit or replace it to change the look`)}`)
}
const lyricSections = projectLyricSections(lyrics, project.data.music?.sections.map(s => s.label))
log.step('Lyrics', lyrics ? styles.muted(`${lyricSections.length} sections: ${lyricSections.map(s => s.label).join(' · ')}`) : styles.muted('(none)'))
log.step('Story idea', storyIdea || styles.muted('(none)'))
log.step('Style', style || styles.muted('(none - the look is designed from the story)'))
log.step('Max clip length', `${maxClipSec}s`)
log.step('Mode', config.singers.length
    ? `performance - ${config.singers[0] === 'auto' ? 'the LLM picks the singer' : `${config.singers.join(', ')} sing${config.singers.length > 1 ? '' : 's'}`} (${language})`
    : `clip - the song is the soundtrack${config.alignLyrics ? ', lyrics aligned' : ''} ${styles.muted('(set "singers" in config.json to let characters sing)')}`)
if (config.alignLyrics && sungLines(lyricSections).length === 0) throw new Error('Aligning the lyrics needs sung lines in input/lyrics.txt - without lyrics, remove "singers" from config.json (clip mode)')
if (!lyrics && !storyIdea) throw new Error('Neither lyrics nor a story idea given - add input/lyrics.txt or input/story-idea.txt')

// an edited input redoes the steps built on it - the inputs and the steps they redo are listed in lib/inputs.ts
await project.syncInputs(await projectInputs(project.dir, config))
// the sections are named after the lyrics tags
if (project.data.music && lyricSections.length && project.data.music.sections.map(s => s.label).join('|') !== lyricSections.map(s => s.label).join('|')) {
    project.invalidate('music')
}
if (project.data.stems && Object.values(project.data.stems).some(file => !existsSync(join(project.dir, file)))) project.invalidate('stems')
if (project.data.instrumentStems && Object.values(project.data.instrumentStems).some(file => !existsSync(join(project.dir, file)))) project.invalidate('instrumentStems')

////////// ANALYZE THE SONG
if (!existsSync(songFile)) throw new Error(`No song found at ${project.input('song.wav')} or ${project.input('song.mp3')}${idea ? ' - run with --render=song to generate one from input/idea.txt' : ''}`)
const music = await project.step('music', '2 · ANALYZING THE SONG', async () => {
    log.step('Analyzing', styles.muted(`${songFile} - beats, bars and ${lyricSections.length} sections`))
    return analyzeSong(songFile, lyricSections.map(s => s.label))
})
log.step('Tempo', `${music.bpm} BPM, ${music.downbeats.length} bars, ${Math.round(music.durationSec)}s`)
for (const s of music.sections) {
    log.line(`   ${energyBar(s.energy)} ${styles.muted(`${formatTime(s.start)} – ${formatTime(s.end)}`)} ${styles.name(s.label)}`)
}
log.step('Sections', styles.muted(config.alignLyrics
    ? 'estimated from audio - refined from the lyrics timing when the song is cut into clips'
    : `estimated from audio - fix them by hand in ${project.file} if they are off, then --redo=timeline`))

////////// ALIGNING THE LYRICS - only when someone sings, or with "alignLyrics": true
const stems = config.alignLyrics ? await project.step('stems', '2a · SEPARATING THE STEMS', async () => {
    log.step('Separating', styles.muted(`${songFile} with demucs htdemucs_ft - the first run downloads the model (~320 MB)`))
    return separateStems(songFile, project.dir)
}) : undefined
if (stems) log.step('Stems', styles.muted(Object.values(stems).join(' · ')))

const transcript = stems ? await project.step('transcript', '2b · TRANSCRIBING THE VOCALS', async () => {
    log.step('Transcribing', styles.muted(`${stems.vocals} with Whisper large-v3 (${language}) - the first run downloads the model (~3 GB)`))
    return transcribeVocals(join(project.dir, stems.vocals), config.lyricsLanguage, project.input('lyrics.txt'))
}) : undefined
if (transcript) {
    log.step('Heard', styles.muted(`${transcript.words.length} words: ${transcript.words.slice(0, 12).map(w => w.text).join(' ')} …`))
    if (transcript.activity) log.step('Vocal activity', styles.muted(`${transcript.activity.length} range(s) from RMS energy, independent of whisper`))
}

const lyricsTiming = transcript ? await project.step('lyricsTiming', '2c · ALIGNING THE LYRICS', async () => alignLyrics(lyricSections, transcript.words, music.sections, transcript.activity, music.bpm)) : undefined
if (lyricsTiming) {
    for (const line of lyricsTiming.lines) {
        const confidence = line.confidence < 0.5 ? styles.warning(line.confidence.toFixed(2)) : styles.muted(line.confidence.toFixed(2))
        log.line(`   ${styles.muted(`${formatTime(line.start, true)} – ${formatTime(line.end, true)}`)} ${confidence} ${styles.name(line.section.padEnd(12))} ${line.text}`)
    }
    const unsure = lowConfidence(lyricsTiming)
    if (unsure.length) log.warn(`${unsure.length} line(s) barely found in the transcript - their times are interpolated. Check them and fix lyricsTiming in ${project.file} by hand if needed, then --redo=timeline`)
}

////////// CRAFT A STORY FOR THE LYRICS
const storyBase = await reviewed(project, args.review, 'story',
    () => project.step('story', '3 · CRAFTING THE STORY', () => ask(storyPrompt(lyrics, storyIdea, config.singerVoice))),
    story => log.box('Story', story))
if (storyBase === 'NO STORY') throw new Error('Neither lyrics nor a story idea given')

////////// SUMMARIZE THE STORY
const storySummary = await project.step('summary', '4 · SUMMARIZING THE STORY', () => ask(summaryPrompt(storyBase)))
log.box('Summary', storySummary)

////////// EXTRACT LOCATIONS AND CHARACTERS
const cast = await reviewed(project, args.review, 'cast', () => project.step('cast', '5 · EXTRACTING CHARACTERS & LOCATIONS', async () => {
    const extracted = await askJson<{ characters: (Omit<Character, 'id' | 'propCarried'> & { propStem?: string, propCarried?: boolean })[], locations: Omit<Location, 'id'>[] }>(castPrompt(storyBase, config.singerVoice))
    const stemNames = new Set(['drums', 'bass', 'other', 'guitar', 'piano'])
    const takenCharacters = new Set<string>()
    const takenLocations = new Set<string>()
    const uniqueId = (base: string, taken: Set<string>) => {
        let id = base
        for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
        taken.add(id)
        return id
    }
    const locations = extracted.locations.map(l => ({...l, id: uniqueId(toId(l.name), takenLocations)}))
    // the place a prop stands in, by the name the answer gives it - the only place when there is just one
    const placeOf = (name: string | undefined) => locations.find(l => l.name === name || l.id === toId(name ?? ''))?.id ?? (locations.length === 1 ? locations[0]!.id : undefined)
    return {
        // "A B" and "A-B" give the same slug: a second one gets its own id instead of overwriting the first one's look
        characters: extracted.characters.map(c => ({
            id: uniqueId(toId(c.name), takenCharacters), name: c.name, role: c.role,
            ...(c.isGroup === true ? {isGroup: true} : {}),
            ...(c.isGroup === true && c.alike === true ? {alike: true} : {}),
            ...(c.prop ? {prop: c.prop} : {}),
            ...(c.prop && c.propStem && stemNames.has(c.propStem) ? {propStem: c.propStem as PropStem} : {}),
            ...(c.prop && c.propCarried === false ? {
                propCarried: false as const,
                ...(c.propInHand ? {propInHand: c.propInHand} : {}),
                ...(placeOf(c.propPlace) ? {propPlace: placeOf(c.propPlace)} : {}),
            } : {}),
        })),
        locations,
    }
}), cast => {
    log.step('Characters', styles.muted(`(${cast.characters.length})`))
    for (const c of cast.characters) log.line(`   ${styles.name(c.id)} ${styles.muted('—')} ${c.role}${c.prop ? styles.muted(` · ${c.prop}${c.propStem ? ` (${c.propStem})` : ''}${c.propCarried === false ? ` - stands in ${c.propPlace ?? '?'}${c.propInHand ? `, in hand: ${c.propInHand}` : ''}` : ''}`) : ''}`)
    log.step('Locations', styles.muted(`(${cast.locations.length})`))
    for (const l of cast.locations) log.line(`   ${styles.name(l.id)}`)
})

////////// CASTING - who plays each role and which picture each place has: the project's own or a library asset
// (casting.json, written once here and then only read - lib/casting.ts). A library asset is copied into the project, so
// the project stays complete without the library; its texts stand in for the look and description steps below.
const library = await libraryDir()
if (writeCastingOnce(project.dir, cast)) log.step('Casting', styles.muted(`${CASTING_FILE} written - every character and place "project:"; "library:<id>" in it takes a library asset instead`))
const casting = resolveCasting(readCastingFile(project.dir), cast, (kind, id) => libraryIds(library, kind).includes(id))
for (const warning of casting.warnings) log.warn(warning)
if (casting.errors.length) throw new Error(`${casting.errors.join('\n')}\nNothing was made - fix ${join(project.dir, CASTING_FILE)} (or put the asset into the library: bun run export-asset / create-asset)`)
// copyKey -> the library asset that plays it
const castLibrary = new Map<string, LibraryAsset>()
for (const entry of casting.entries) castLibrary.set(copyKey(entry.kind, entry.id), (await readLibraryAsset(library, entry.kind, entry.libraryId))!)
const casted = (kind: AssetKind, id: string) => castLibrary.get(copyKey(kind, id))
{
    // a role that went back to "project:": the library pictures are put away, the project makes its own again
    const dropped = droppedCopies(project.data.castingCopies ?? {}, casting.entries)
    for (const key of dropped) {
        const [kind, id] = key.split(':') as [AssetKind, string]
        const {picture, sheet} = assetPaths(kind, id)
        archiveFiles(project.dir, `${id}-library-${versionStamp()}`, [picture, `${picture}.json`, sheet])
        log.warn(`${id} is "project:" again - the library pictures are put away in old/attempts; its look and description were the library's: bun index.ts ${projectId} --redo=${kind === 'character' ? 'characterLooks' : 'locationLooks'} makes them anew`)
    }
    const {copied, copies} = copyCasting(project.dir, library, casting.entries, project.data.castingCopies)
    for (const entry of copied) log.step('Casting', `${styles.name(entry.id)} ${styles.muted(`← library:${entry.libraryId} - pictures copied, never rendered again`)}`)
    if (Object.keys(copies).length) project.data.castingCopies = copies
    else delete project.data.castingCopies
    if (copied.length || dropped.length) await project.save()
    // the picture fits the role? the prop the role has is named in the asset's description
    for (const entry of casting.entries.filter(e => e.kind === 'character')) {
        const role = cast.characters.find(c => c.id === entry.id)!
        const shown = pictureProp(role)
        if (shown && propMissing(casted('character', entry.id)!.description, shown)) log.warn(`${entry.id}: library:${entry.libraryId} does not name the role's prop "${shown}" - the clips may show the picture's prop, or none`)
    }
}
// the steps below that a library asset stands in for: its texts replace theirs, also in a step kept from an earlier run
// (the entry was changed since) - what was planned with the old ones is named at the end
const castChanged = new Set<StepName>()
function castTexts<T>(step: StepName, kind: AssetKind, values: Record<string, T>, pick: (asset: LibraryAsset) => T | undefined) {
    for (const [key, asset] of castLibrary) {
        if (!key.startsWith(`${kind}:`)) continue
        const id = key.slice(kind.length + 1)
        const value = pick(asset)
        if (value === undefined || JSON.stringify(values[id]) === JSON.stringify(value)) continue
        values[id] = value
        castChanged.add(step)
    }
}

////////// DETECTING INSTRUMENT ACTIVITY - band scenes only: needs stems and at least one character with a propStem
const neededStems = [...new Set(cast.characters.map(c => c.propStem).filter((s): s is PropStem => Boolean(s)))]
const neededInstrumentStems = neededStems.filter((s): s is 'guitar' | 'piano' => s === 'guitar' || s === 'piano')

// guitar/piano aren't in the htdemucs_ft stems above (folded into "other") - a second, narrower htdemucs_6s pass
// gets just those, on top of (never overwriting) the cleaner htdemucs_ft vocals/drums/bass/other already on disk
const instrumentStems = stems && neededInstrumentStems.length ? await project.step('instrumentStems', '5a · SEPARATING GUITAR/PIANO', async () => {
    log.step('Separating', styles.muted(`${songFile} with demucs htdemucs_6s (${neededInstrumentStems.join(', ')} only)`))
    return separateInstrumentStems(songFile, project.dir, neededInstrumentStems)
}) : undefined
if (instrumentStems) log.step('Stems', styles.muted(Object.values(instrumentStems).join(' · ')))

const allStems = {...stems, ...instrumentStems}
// every stem's absolute path, plus a "song" fallback (the whole, unseparated song) for the clip-mode anchor
// track lib/compose.ts falls back to when stemsAvailable is false (see buildClipRequests below)
const stemFiles: Record<string, string> = {
    ...Object.fromEntries(Object.entries(allStems).map(([stem, file]) => [stem, join(project.dir, file)])),
    song: songFile,
}
const propActivity = stems && neededStems.length ? await project.step('propActivity', '5c · DETECTING INSTRUMENT ACTIVITY', async () => {
    const result: NonNullable<typeof project.data.propActivity> = {}
    for (const stemName of neededStems) {
        const stemFile = allStems[stemName]
        if (!stemFile) continue
        log.step('Analyzing', styles.muted(stemFile))
        result[stemName] = await stemActivity(join(project.dir, stemFile), music.bpm)
    }
    return result
}) : undefined
if (propActivity) for (const [stemName, ranges] of Object.entries(propActivity)) log.step('Activity', styles.muted(`${stemName}: ${ranges!.length} range(s), ${ranges!.reduce((sum, r) => sum + r.end - r.start, 0).toFixed(0)} s active`))
else if (neededStems.length) log.warn(`${neededStems.length} character(s) have an audible instrument prop, but stems weren't separated (set "alignLyrics": true in config.json) - instruments will be shown playing throughout`)

////////// CHOOSING THE SINGERS - performance mode only
const singing = config.singers.length ? await project.step('singing', '5b · CHOOSING THE SINGERS', () => chooseSingers(config.singers)) : undefined
if (singing) {
    const nameOf = (id: string) => cast.characters.find(c => c.id === id)?.name ?? id
    log.step('Singers', singing.singers.map(id => styles.name(nameOf(id))).join(', '))
    if (singing.singers.length > 1) {
        for (const line of singing.lines) log.line(`   ${styles.muted(line.singers.map(nameOf).join(' + ').padEnd(24))} ${line.text}`)
    }
}

/////////// DESIGNING THE LOOK - invented from the story, or extending the director's style.txt
const lookBrief = await reviewed(project, args.review, 'lookBrief',
    () => project.step('lookBrief', '6 · DESIGNING THE FILM LOOK', () => ask(lookBriefPrompt(style, storySummary))),
    look => log.box('Look brief', look))

////////// CRAFTING CHARACTER LOOKS
const characterLooks = await project.step('characterLooks', '7 · CRAFTING CHARACTER LOOKS', async () => {
    const looks: Record<string, string> = {}
    for (const [i, char] of cast.characters.entries()) {
        log.step(`Character ${i + 1}/${cast.characters.length}`, styles.name(char.id))
        const fromLibrary = casted('character', char.id)
        if (fromLibrary) {
            looks[char.id] = fromLibrary.description
            continue
        }
        const otherLooks = cast.characters.filter(c => c.id !== char.id && looks[c.id]).map(c => ({name: c.name, look: looks[c.id]!}))
        const options = characterLookPrompt(lookBrief, char, otherLooks)
        looks[char.id] = await project.each('characterLooks', char.id, options, () => ask(options))
    }
    return looks
})
castTexts('characterLooks', 'character', characterLooks, asset => asset.description)
for (const [id, look] of Object.entries(characterLooks)) log.box(id, look)
// a prop the look does not name is not in the reference picture - the clips would show the model's own idea of it
for (const c of cast.characters) {
    const shown = pictureProp(c)
    if (shown && !casted('character', c.id) && characterLooks[c.id] && propMissing(characterLooks[c.id]!, shown)) log.warn(`${c.id}: the look does not show its prop "${shown}" - redo characterLooks, or edit the look in ${project.file} by hand`)
}

////////// DESCRIBING THE CHARACTERS - the look prompt without the reference sheet (pose, grey background, studio light)
// one call per character, independent of each other - as many at once as llm.parallel allows
const characterDescriptions = await project.step('characterDescriptions', '7b · DESCRIBING THE CHARACTERS FOR THE CLIPS', async () => {
    const descriptions = await llmMap(cast.characters, async (char, i) => {
        log.step(`Character ${i + 1}/${cast.characters.length}`, styles.name(char.id))
        const fromLibrary = casted('character', char.id)
        if (fromLibrary) return fromLibrary.description
        const options = characterDescriptionPrompt(characterLooks[char.id] ?? '')
        return project.each('characterDescriptions', char.id, options, () => ask(options))
    })
    return Object.fromEntries(cast.characters.map((char, i) => [char.id, descriptions[i]!]))
})
castTexts('characterDescriptions', 'character', characterDescriptions, asset => asset.description)
for (const [id, description] of Object.entries(characterDescriptions)) log.box(id, description)

////////// CRAFTING LOCATION LOOKS
// unlike the characters, the places are not contrasted with each other - asked at once, up to llm.parallel
const locationLooks = await project.step('locationLooks', '8 · CRAFTING LOCATION LOOKS', async () => {
    const looks = await llmMap(cast.locations, async (location, i) => {
        log.step(`Location ${i + 1}/${cast.locations.length}`, styles.name(location.id))
        const fromLibrary = casted('location', location.id)
        if (fromLibrary) return fromLibrary.description
        const options = locationLookPrompt(lookBrief, storySummary, location.name,
            [...new Set(cast.characters.flatMap(c => c.prop && c.propCarried !== false ? [c.prop] : []))],
            [...new Set(cast.characters.flatMap(c => c.prop && c.propCarried === false && c.propPlace === location.id ? [c.prop] : []))])
        return project.each('locationLooks', location.id, options, () => ask(options))
    })
    return Object.fromEntries(cast.locations.map((location, i) => [location.id, looks[i]!]))
})
castTexts('locationLooks', 'location', locationLooks, asset => asset.description)
for (const [id, look] of Object.entries(locationLooks)) log.box(id, look)

////////// DESCRIBING THE LOCATIONS - the look prompt without the establishing shot (camera, "empty", medium)
const locationDescriptions = await project.step('locationDescriptions', '8b · DESCRIBING THE LOCATIONS FOR THE CLIPS', async () => {
    const descriptions = await llmMap(cast.locations, async (location, i) => {
        log.step(`Location ${i + 1}/${cast.locations.length}`, styles.name(location.id))
        const fromLibrary = casted('location', location.id)
        if (fromLibrary) return fromLibrary.description
        const options = locationDescriptionPrompt(locationLooks[location.id] ?? '')
        return project.each('locationDescriptions', location.id, options, () => ask(options))
    })
    return Object.fromEntries(cast.locations.map((location, i) => [location.id, descriptions[i]!]))
})
castTexts('locationDescriptions', 'location', locationDescriptions, asset => asset.description)
for (const [id, description] of Object.entries(locationDescriptions)) log.box(id, description)

////////// THE BACKGROUND OF EACH PLACE - the fixed features every shot with people in it keeps behind them
const locationAnchors = await project.step('locationAnchors', '8c · NAMING THE BACKGROUND OF EACH PLACE', async () => {
    const anchors = await llmMap(cast.locations, async (location, i) => {
        log.step(`Location ${i + 1}/${cast.locations.length}`, styles.name(location.id))
        const fromLibrary = casted('location', location.id)?.anchors
        if (fromLibrary) return fromLibrary
        const options = locationAnchorPrompt(locationDescriptions[location.id] ?? '')
        return (await project.each('locationAnchors', location.id, options, () => ask(options))).replace(/^["']|["'.\s]+$/g, '')
    })
    return Object.fromEntries(cast.locations.map((location, i) => [location.id, anchors[i]!]))
})
castTexts('locationAnchors', 'location', locationAnchors, asset => asset.anchors)
for (const [id, anchor] of Object.entries(locationAnchors)) log.step(id, styles.muted(anchor))

////////// THE LAYOUT OF EACH PLACE - one floor plan per place: every beat there is staged in it, not in a room of its own
const locationLayouts = await project.step('locationLayouts', '8d · LAYING OUT EACH PLACE', async () => {
    const answers = await llmMap(cast.locations, async (location, i) => {
        log.step(`Location ${i + 1}/${cast.locations.length}`, styles.name(location.id))
        const fromLibrary = casted('location', location.id)?.layout
        if (fromLibrary) return fromLibrary
        const options = locationLayoutPrompt(location.name, locationLooks[location.id] ?? '', locationDescriptions[location.id] ?? '')
        // an answer that cannot be read is asked once more; then the place has no layout and its beats write their own
        // staging, as before - a broken answer for one place does not stop the run
        let answer: { layout?: unknown, views?: unknown[] } | undefined
        for (let attempt = 1; attempt <= 2 && !answer; attempt++) {
            answer = await project.each('locationLayouts', location.id, options, () => askJson<{ layout?: unknown, views?: unknown[] }>(options)).catch((e: unknown) => {
                log.warn(`${location.id}: the layout is unusable (${e instanceof Error ? e.message : e})${attempt < 2 ? ' - asking again' : ' - its beats stage the place themselves'}`)
                return undefined
            })
        }
        return answer && {layout: String(answer.layout ?? '').trim(), views: LOCATION_VIEWS.map((_, n) => String(answer!.views?.[n] ?? '').trim())}
    })
    const layouts: Record<string, LocationLayout> = {}
    cast.locations.forEach((location, i) => {
        if (answers[i]) layouts[location.id] = answers[i]
    })
    return layouts
})
castTexts('locationLayouts', 'location', locationLayouts, asset => asset.layout)
if (castChanged.size) {
    await project.save()
    // a changed casting.json after the plan was made: what was made from the old texts is named, not redone (it costs)
    // every step a library asset stands in for counts as changed: redoing one of them would only ask the LLM for what the library gives
    const redo = redoAfter(['characterLooks', 'characterDescriptions', 'locationLooks', 'locationDescriptions', 'locationAnchors', 'locationLayouts'], project.data)
    if (redo.length) log.warn(`${CASTING_FILE} changed since the plan was made - it is made with the library's texts again by: bun index.ts ${projectId} --redo=${redo.join(',')}`)
}
for (const [id, {layout, views}] of Object.entries(locationLayouts)) log.box(`${id} · layout`, [layout, ...views.map((v, n) => `${n}: ${v}`)].join('\n'))

////////// BREAKING THE STORY INTO BEATS
// one beat per ~15 s of the song, so that no beat has to be stretched over far more clips than it has story for
const beatCount = Math.max(6, Math.round(music.durationSec / 15))
// where the last sung word ends - the singer is on screen until then
const vocalsEnd = Math.max(0, ...(lyricsTiming?.lines.flatMap(l => l.words.map(w => w.end)) ?? []))
const beats = await reviewed(project, args.review, 'beats', () => project.step('beats', '9 · BREAKING THE STORY INTO BEATS', async () => {
    // what the beats must do so the singers can be lip-synced - the singers are on screen until the last sung word
    const performance = `${singing ? performanceRules(singing) : ''}
${singing && vocalsEnd ? `The singer${singing.singers.length > 1 ? 's sing' : ' sings'} on screen until ${formatTime(vocalsEnd)} of the ${formatTime(music.durationSec)} song and ${singing.singers.length > 1 ? 'are' : 'is'} visible, with the mouth in view, in every shot while singing - singing is part of what they do, not a number for the camera: a singer in a fight sings through it, at the opponent, between and over the blows. So nobody who sings leaves, vanishes, dies or is swallowed before ${formatTime(vocalsEnd)}: such an ending happens gradually while they keep singing, or only after the last vocal - the beats after that show the place without them.
` : ''}`
    // the music along the way - loudness and whose instrument is heard - so the story's curve follows the song's
    const players = cast.characters.flatMap(c => c.prop && c.propStem && propActivity?.[c.propStem] ? [{name: c.name, prop: c.prop, ranges: propActivity[c.propStem]!}] : [])
    const stretches = musicStretches(music, beatCount, players)
    const extracted = await askJson<{ beats: Omit<StoryBeat, 'id' | 'order'>[] }>(beatsPrompt({durationSec: music.durationSec, beatCount, characters: cast.characters, locations: cast.locations, lyrics, story: storyBase, performance, stretches}))

    const BEAT_KINDS: string[] = ['establish', 'build', 'hit', 'release']
    const characterIds = new Set(cast.characters.map(c => c.id))
    const groupIds = new Set(cast.characters.filter(c => c.isGroup).map(c => c.id))
    const locationIds = cast.locations.map(l => l.id)
    const built = extracted.beats.map((beat, i) => {
        if (!locationIds.includes(beat.locationId)) {
            log.warn(`beat ${i + 1} uses unknown location "${beat.locationId}" - using ${locationIds[0]}`)
        }
        const beatCharacterIds = (Array.isArray(beat.characterIds) ? beat.characterIds : []).filter(id => characterIds.has(id))
        const summary = String(beat.summary ?? '')
        const groupSize = Object.fromEntries(
            Object.entries(beat.groupSize ?? {})
                .filter(([id]) => groupIds.has(id) && beatCharacterIds.includes(id))
                .map(([id, count]) => [id, Math.min(20, Math.max(1, Math.round(Number(count)) || 1))]),
        )
        return {
            ...beat,
            // written with {Name} tokens (lib/refs.ts) - a beat from before them has plain names
            tokens: true,
            kind: BEAT_KINDS.includes(beat.kind) ? beat.kind : 'build' as const,
            summary,
            id: `beat-${String(i + 1).padStart(2, '0')}`,
            order: i + 1,
            locationId: locationIds.includes(beat.locationId) ? beat.locationId : locationIds[0]!,
            characterIds: beatCharacterIds,
            moments: Array.isArray(beat.moments) && beat.moments.length ? beat.moments.map(String) : [summary],
            intensity: Math.min(1, Math.max(0, Number(beat.intensity) || 0.5)),
            weight: Math.max(1, Number(beat.weight) || 1),
            continuous: beat.continuous === true,
            entrance: beat.entrance === true,
            // each fact with whether it is one of the place; a plain string (the model forgot the object) is read as written
            stateAfter: (Array.isArray(beat.stateAfter) ? beat.stateAfter : []).map((f: unknown): Fact => f && typeof f === 'object'
                ? {fact: String((f as Record<string, unknown>).fact ?? ''), place: (f as Record<string, unknown>).place === true}
                : {fact: String(f), place: false}).filter(f => f.fact.trim()),
            ...(Object.keys(groupSize).length ? {groupSize} : {}),
        }
    })
    // a token that is nobody of the cast ({Aldric} for "Aldric Thorne") is mapped by one short call, not by matching words
    const texts = built.flatMap(b => [b.summary, ...b.moments, ...b.stateAfter.map(f => f.fact)])
    const {texts: fixed, mapped} = await resolveUnknownTokens(texts, cast.characters)
    if (Object.keys(mapped).length) log.step('Names', Object.entries(mapped).map(([token, name]) => `{${token}} → ${name ? `{${name}}` : 'nobody of the cast'}`).join(', '))
    let next = 0
    return built.map(b => ({...b, summary: fixed[next++]!, moments: b.moments.map(() => fixed[next++]!), stateAfter: b.stateAfter.map(f => ({...f, fact: fixed[next++]!}))}))
}), beats => {
    for (const beat of beats) {
        log.line(`   ${styles.name(beat.id)} ${styles.muted(`${beat.kind.padEnd(9)} ${energyBar(beat.intensity)} @${beat.locationId}${beat.lyricAnchor ? ` ♪${beat.lyricAnchor}` : ''}`)}`)
        log.line(`      ${beat.summary}`)
        for (const moment of beat.moments) log.line(styles.muted(`        · ${moment}`))
    }
})

////////// GENERATING GROUP MEMBER VARIANT LOOKS
// group characters (cast.characters[].isGroup) that ever show more than one individual on screen at once (beats
// groupSize) get one extra look prompt per member here, so they don't all render from the same shared reference
// picture - see computeMemberCounts/groupMemberId in lib/compose.ts for how a shot picks which member to show.
const memberCounts = computeMemberCounts(beats, cast.characters)
const characterLookVariants = await project.step('characterLookVariants', '9c · GENERATING GROUP MEMBER VARIANTS', async () => {
    const variants: Record<string, string[]> = {}
    for (const char of cast.characters) {
        const count = memberCounts[char.id] ?? 1
        if (count <= 1) continue
        log.step('Group', `${styles.name(char.id)} ${styles.muted(`${count} members`)}`)
        const looks = [characterLooks[char.id] ?? '']
        for (let i = 1; i < count; i++) {
            log.step(`Member ${i + 1}/${count}`, styles.name(char.id))
            const options = characterVariantLookPrompt(lookBrief, char, looks)
            looks.push(await project.each('characterLookVariants', `${char.id}/${i}`, options, () => ask(options)))
        }
        variants[char.id] = looks
        const shown = pictureProp(char)
        if (shown) looks.forEach((look, i) => { if (propMissing(look, shown)) log.warn(`${char.id} member ${i + 1}: the look does not show the prop "${shown}"`) })
    }
    return variants
})

////////// DESCRIBING THE GROUP MEMBER VARIANTS
// each member has its own look image, so it needs its own description too - reusing the group's shared
// characterDescriptions entry (derived from member 0's look alone) described every other member's anchor image
// with member 0's text, which reads as the video model fighting itself and drifting the whole sequence toward
// whichever member the text actually described.
const characterDescriptionVariants = await project.step('characterDescriptionVariants', '9d · DESCRIBING THE GROUP MEMBER VARIANTS', async () => {
    const descriptions: Record<string, string[]> = {}
    for (const [id, looks] of Object.entries(characterLookVariants)) {
        log.step('Group', `${styles.name(id)} ${styles.muted(`${looks.length} members`)}`)
        descriptions[id] = [
            characterDescriptions[id] ?? '',
            ...await llmMap(looks.slice(1), (look, i) => {
                const options = characterDescriptionPrompt(look)
                return project.each('characterDescriptionVariants', `${id}/${i + 1}`, options, () => ask(options))
            }),
        ]
    }
    return descriptions
})

////////// CUTTING THE SONG INTO CLIPS
// switched alignLyrics on or off since the timeline was built
if (project.data.timeline && (project.data.timeline.aligned ?? false) !== Boolean(lyricsTiming)) project.invalidate('timeline')
const timeline = await project.step('timeline', '10 · CUTTING THE SONG INTO CLIPS', async () => buildTimeline(music, lyricSections, maxClipSec, lyricsTiming, config.vocalGap))
log.step('Clips', `${timeline.slots.length} clips of ${timeline.barsPerSlot} bars (${(timeline.barsPerSlot * 240 / music.bpm).toFixed(1)}s) - max ${timeline.maxClipSec}s`)
if (timeline.aligned) {
    log.step('Sections', styles.muted('from the lyrics timing (estimate from the audio in brackets)'))
    timeline.sections.forEach((s, i) => {
        const estimate = music.sections[i]
        log.line(`   ${styles.name(s.label.padEnd(12))} ${formatTime(s.start, true)} – ${formatTime(s.end, true)} ${styles.muted(estimate ? `(${formatTime(estimate.start, true)} – ${formatTime(estimate.end, true)})` : '')}`)
    })
    log.step('Sung in clips', `${timeline.slots.filter(s => s.vocals?.length).length} of ${timeline.slots.length}`)
}

////////// MATCHING THE STORY TO THE MUSIC
const storyMapping = await project.step('mapping', '11 · MATCHING THE STORY TO THE MUSIC', async () => mapBeatsToSlots(beats, timeline.slots))
// config.fightClips: the clips of a fight beat are cut into one-bar pieces (not cached - derived from the timeline and the mapping)
const {slots: clipSlots, mapping} = config.fightClips
    ? splitFightSlots(timeline.slots, storyMapping, beats, cast.characters, music)
    : {slots: timeline.slots, mapping: storyMapping}
if (config.fightClips && clipSlots.length !== timeline.slots.length) {
    const fightBeats = new Set(clipSlots.filter(s => s.micro).map(s => mapping[s.index]!.beatId))
    log.step('Fight clips', styles.muted(`${clipSlots.length} clips instead of ${timeline.slots.length}: the fight beats ${[...fightBeats].join(', ')} are cut into one-bar pieces`))
}
const beatById = new Map(beats.map(b => [b.id, b]))
for (const slot of clipSlots) {
    const beat = beatById.get(mapping[slot.index]!.beatId)!
    log.line(`   ${styles.muted(`${formatTime(slot.start)}`)} ${slot.section.padEnd(12)} ${energyBar(slot.energy)} ${styles.name(beat.id)} ${styles.muted(energyBar(beat.intensity))}`)
}

////////// REFINING THE MOMENTS TO ONE PER SHOT
// beat.moments (2-6 sentences) is written before the beat's shot count is known, so a beat can end up covering far
// more shots than it has moments for - the old code just reused/repeated moments across shots (--legacy-moments
// still does). This step asks for exactly one distinct, progressing action per shot instead.
const beatProps = propActivity ? propActivityPerBeat({slots: clipSlots, mapping, beats, characters: cast.characters}, propActivity) : undefined
const beatSinging = singingPerBeat({slots: clipSlots, mapping, beats, singing})
// One call per beat does not fit on a long song: thinking and ~100 shot sentences share max_output_tokens (see #91). So the
// beats are blocked first, one after the other - the floor plan, where everybody starts and ends, each beat from the end
// of the one before - and then the shots of every beat are written from its blocking, the beats at once (steps 11a and 11b).
// a beat whose answer stayed unusable has no plan and plays on its beat moments: the next run plans just those beats
// again, the ones already planned stay as they are
const plannedBefore = args['legacy-moments'] ? undefined : (() => {
    const before = project.data.shotMoments
    if (!before || beats.every(b => before[b.id] !== undefined)) return undefined
    return Object.fromEntries(Object.entries(before).filter(([, plan]) => !Array.isArray(plan))) as Record<string, BeatShots>
})()
if (plannedBefore) {
    const missing = beats.filter(b => !plannedBefore[b.id]).map(b => b.id)
    log.step('Planning again', styles.muted(`${missing.join(', ')} - no plan of their own yet, the other ${beats.length - missing.length} stay`))
    delete project.data.shotMoments
    // the beats planned now have no view yet - the views of the others stay (see shotViews)
    delete project.data.shotViews
}
const shotCounts = countShotsPerBeat({slots: clipSlots, mapping, beats})
const planContext: PlanContext = {characters: cast.characters, locations: cast.locations, characterDescriptions, locationDescriptions, locationLayouts, continuity: config.continuity, slots: clipSlots, mapping, shotCounts, beatProps, beatSinging}
// The blocking, beat after beat - short calls: the floor plan, where everybody starts and ends. Each beat starts where the
// one before it ends, so this is the only part that has to go in order. A step of its own: --redo=shotMoments plans the shots
// again on the same floor plans. A beat whose blocking stays unusable has no entry and plans its staging and ends itself.
// Made only when the shots are planned - shots planned before this step existed stay without one
const blockings = args['legacy-moments'] || project.data.shotMoments !== undefined ? undefined : await project.step('blocking', '11a · BLOCKING THE BEATS', async () => {
    const blockings: Record<string, Blocking> = {}
    for (const [i, beat] of beats.entries()) {
        const prev = beats[i - 1]
        const before = prev && blockings[prev.id] ? {beatId: prev.id, staging: blockings[prev.id]!.staging, ends: blockings[prev.id]!.ends} : undefined
        log.step(`Blocking ${i + 1}/${beats.length}`, styles.name(beat.id))
        for (let attempt = 1; attempt <= 2 && !blockings[beat.id]; attempt++) {
            const answer = parseShotLines(await ask({...blockingPrompt(planContext, beat, before, beats[i + 1]), label: `${beat.id} · blocking`}))
            const texts = [answer.staging ?? '', ...Object.values(answer.starts), ...Object.values(answer.ends)]
            const {texts: fixed} = await resolveUnknownTokens(texts, cast.characters)
            let next = 0
            const blocking: Blocking = {
                staging: fixed[next++]!,
                starts: Object.fromEntries(Object.keys(answer.starts).map(who => [who, fixed[next++]!])),
                ends: Object.fromEntries(Object.keys(answer.ends).map(who => [who, fixed[next++]!])),
            }
            // a beat without people (a place alone) has nobody to start or end anywhere
            const complete = blocking.staging && (!beat.characterIds.length || Object.keys(blocking.ends).length)
            if (complete) blockings[beat.id] = blocking
            else log.warn(`${beat.id}: the blocking has no ${blocking.staging ? 'ends' : 'staging'}${attempt < 2 ? ' - asking again' : ' - the shot planning writes them itself'}`)
        }
    }
    return blockings
})
const shotMoments = args['legacy-moments'] ? undefined : await project.step('shotMoments', '11b · REFINING MOMENTS PER SHOT', async () => {
    type Beat = (typeof beats)[number]
    const MOMENT_SHOTS_PER_CALL = 4
    // the shots of a beat, MOMENT_SHOTS_PER_CALL at a time: each call sees the staging and the shots written so far.
    // A call without a single shot in its answer is asked once more; the beat is then short of those shots (a missing
    // shot repeats the last one, see readBeatPlan) instead of falling back to its beat moments as a whole.
    // Asked again (`before`: the first answer and what was wrong with it), only the calls whose shots have a problem are
    // made again, each with its own problems; the other calls keep their first answer. A problem of the whole beat (its
    // shot count) asks every call again - the shots of the calls after it would no longer line up.
    type RawBeat = { staging?: string, ends?: Record<string, string>, shots: Record<string, unknown>[] }
    const askBlock = async (block: Beat[], finished: { beat: Beat, plan: BeatShots } | undefined, after: Beat | undefined, before?: { moments: Record<string, RawBeat>, issues: Record<string, Issue[]> }, blocking?: Blocking) => {
        const moments: Record<string, RawBeat> = {}
        for (const beat of block) {
            const total = shotCounts[beat.id] ?? 1
            const raw: RawBeat = {shots: []}
            const previous = before?.moments[beat.id]
            const calls = plannerCalls(total, MOMENT_SHOTS_PER_CALL, previous ? {issues: before!.issues[beat.id] ?? [], previousShots: previous.shots.length} : undefined)
            for (const {from, to, keep, problems: own} of calls) {
                if (keep) {
                    if (from === 0) raw.staging = blocking?.staging ?? previous!.staging
                    raw.shots.push(...previous!.shots.slice(from, to))
                    if (to === total) raw.ends = blocking?.ends ?? previous!.ends
                    continue
                }
                let chunk: ReturnType<typeof parseShotLines> | undefined
                // the beats run at once - the label says which beat and which shots a line of the log is about
                const label = `${beat.id} · shots ${from + 1}-${to} of ${total}`
                for (let attempt = 1; attempt <= 2 && !chunk; attempt++) {
                    log.step('Shots', styles.name(label))
                    const parsed = parseShotLines(await ask({...planPrompt(planContext, [beat], from === 0 ? finished : undefined, after, own, {from, to, total, written: raw.shots, staging: raw.staging, blocking}), label}))
                    if (parsed.shots.length) chunk = parsed
                    else log.warn(`${beat.id}, shots ${from + 1}-${to}: no shot in the answer${attempt < 2 ? ' - asking again' : ' - the beat is short of them'}`)
                }
                if (!chunk) break
                // with a blocking, the staging and the ends are the blocking's
                if (from === 0) raw.staging = blocking?.staging ?? chunk.staging
                raw.shots.push(...chunk.shots.slice(0, to - from))
                if (to === total) raw.ends = blocking?.ends ?? chunk.ends
            }
            // tokens of nobody of the cast ({Aldric} for "Aldric Thorne") are mapped by one short call - cheaper than asking the
            // planner again, and nothing reads the words
            const slots: { get: () => unknown, set: (v: string) => void }[] = [
                {get: () => raw.staging, set: (v: string) => raw.staging = v},
                ...Object.keys(raw.ends ?? {}).map(who => ({get: () => raw.ends![who], set: (v: string) => raw.ends![who] = v})),
                ...raw.shots.flatMap(shot => [
                    ...['action', 'view', 'camera', 'rest'].map(key => ({get: () => shot[key], set: (v: string) => shot[key] = v})),
                    ...Object.values((shot.people ?? {}) as Record<string, Record<string, unknown>>).flatMap(person =>
                        ['state', 'frame', 'motion'].map(key => ({get: () => person[key], set: (v: string) => person[key] = v}))),
                ]),
            ].filter(slot => typeof slot.get() === 'string')
            const {texts: fixed, mapped} = await resolveUnknownTokens(slots.map(slot => slot.get() as string), cast.characters)
            if (Object.keys(mapped).length) {
                log.line(styles.muted(`        · ${beat.id}, names: ${Object.entries(mapped).map(([token, name]) => `{${token}} → ${name ? `{${name}}` : 'nobody of the cast'}`).join(', ')}`))
                slots.forEach((slot, n) => slot.set(fixed[n]!))
            }
            moments[beat.id] = raw
        }
        return {moments}
    }

    const result: Record<string, BeatShots> = {...plannedBefore}
    // the step runs only when the blocking step above ran or was cached
    const blocked = blockings ?? {}

    // The shots of every beat, from its own blocking (step 11a) - the beats do not wait for each other: as many at once as
    // llm.parallel allows
    const planBeat = async (beat: Beat) => {
        const block = [beat]
        const blocking = blocked[beat.id]
        const after = beats[beats.indexOf(beat) + 1]
        // without a blocking the beat goes on from the plan of the beat before, if that one is already there
        const prev = beats[beats.indexOf(beat) - 1]
        const handover = !blocking && prev && result[prev.id] ? {beat: prev, plan: result[prev.id]!} : undefined
        // what can be counted is read by the code; whether a heard player's hand phrase plays at all is read by one short
        // call per beat (lib/playing-check.ts) - its "no" is a problem of that shot like the others
        const read = (answer: Awaited<ReturnType<typeof askBlock>>) => Promise.all(block.map(async beat => {
            const read = readBeatPlan(answer.moments?.[beat.id], beat, cast.characters, shotCounts[beat.id] ?? 1, beatSinging[beat.id], beatProps?.[beat.id])
            const idle = read ? await playingIssues(playingCases(read.plan.shots, beatProps?.[beat.id], cast.characters)).catch((e: unknown) => {
                log.warn(`${beat.id}: the check of the hand phrases failed (${e instanceof Error ? e.message : e}) - they stay unchecked`)
                return []
            }) : []
            if (read) for (const issue of idle) {
                read.issues.push(issue)
                read.problems.push(issue.message)
            }
            return {beat, read}
        }))
        // a long answer now and then cannot be read at all: asked again, twice at most, then the beat falls back to the
        // legacy spread (a warning says so) instead of the run failing after the beats that worked
        let first: Awaited<ReturnType<typeof read>> | undefined
        let firstAnswer: Awaited<ReturnType<typeof askBlock>> | undefined
        for (let attempt = 1; attempt <= 3 && !first; attempt++) {
            try {
                firstAnswer = await askBlock(block, handover, after, undefined, blocking)
                first = await read(firstAnswer)
            } catch (e) {
                log.warn(`the answer for ${beat.id} is unusable (${e instanceof Error ? e.message : e})${attempt < 3 ? ' - asking again' : ' - it keeps its beat moments'}`)
            }
        }
        if (!first) return
        let reads = first
        // what can be counted (a name that is not in the cast, a singing shot without a singer, a shot that names someone it does not show) is asked once more
        const problems = reads.flatMap(r => (r.read?.problems ?? []).map(p => `${r.beat.id}, ${p}`))
        if (problems.length) {
            log.warn(`${problems.length} problem(s) in the staged shots of ${beat.id} - asking once more`)
            for (const p of problems) log.line(styles.muted(`        · ${p}`))
            const issues = Object.fromEntries(reads.map(r => [r.beat.id, (r.read?.issues ?? []).map(i => ({...i, message: `${r.beat.id}, ${i.message}`}))]))
            const again = await askBlock(block, handover, after, {moments: firstAnswer!.moments, issues}, blocking).then(read, (e: unknown) => {
                log.warn(`the second answer is unusable (${e instanceof Error ? e.message : e}) - the first one stays`)
                return reads
            })
            reads = reads.map((r, n) => again[n]!.read && (!r.read || again[n]!.read!.problems.length <= r.read.problems.length) ? again[n]! : r)
            for (const r of reads) for (const p of r.read?.problems ?? []) log.warn(`${r.beat.id}, ${p}`)
        }
        // what the code repaired or only noted costs no further call - a line in the log, nothing else
        for (const r of reads) for (const note of r.read?.notes ?? []) log.line(styles.muted(`        · ${r.beat.id}, ${note}`))
        for (const {beat, read: r} of reads) if (r) result[beat.id] = r.plan // a beat without a plan falls back to the legacy spread
    }
    // the beats with a blocking at once; one without goes on from the plan before it, so those wait for theirs
    await llmMap(beats.filter(b => !result[b.id] && blocked[b.id]), planBeat)
    for (const beat of beats.filter(b => !result[b.id] && !blocked[b.id])) await planBeat(beat)
    // the model keeps writing a blank oval for a photograph's missing face or a "blade-shaped object" for a name, whatever
    // the prompt says - those moments get one rewrite
    // the planner flags them itself ("risky") - no word list decides what counts
    const risky = Object.entries(result).flatMap(([beatId, plan]) => plan.shots.flatMap((shot, j) => shot.risky ? [{beatId, j, moment: shot.action}] : []))
    if (risky.length) {
        log.warn(`${risky.length} shot moment(s) the planner flagged (blank face, stand-in object, readable text) - rewriting them`)
        const rewritten = await askJson<{ moments: string[] }>({
            input: `Rewrite each of these music video shot descriptions so that it follows the rules below. Keep everything else exactly as it is: the same people, place, camera, action, emotions and singing - only remove what breaks a rule, by leaving it out or by showing the real action instead. Every name in braces ({Kara}) stays exactly as it is, in its braces.
${filmableRules}
Answer only with JSON: {"moments": ["rewritten 1", "rewritten 2", ...]} - exactly ${risky.length} entries, in the same order.
---
${JSON.stringify(risky.map(r => r.moment))}`,
            instructions: 'You are a music video director who corrects shot descriptions. Answer only with JSON.',
            schema: {type: 'object', additionalProperties: false, required: ['moments'], properties: {moments: {type: 'array', minItems: risky.length, maxItems: risky.length, items: {type: 'string'}}}},
        })
        if (rewritten.moments?.length === risky.length) risky.forEach((r, k) => {
            const {risky: _flag, ...shot} = result[r.beatId]!.shots[r.j]!
            result[r.beatId]!.shots[r.j] = {...shot, action: String(rewritten.moments[k])}
        })
        else log.warn('the rewrite did not come back with one entry per moment - the moments stay as they are')
    }
    return result
})
if (shotMoments) for (const beat of beats) {
    const plan = shotMoments[beat.id] && asBeatShots(shotMoments[beat.id]!)
    if (!plan) continue
    log.line(`   ${styles.name(beat.id)} ${styles.muted(`${plan.shots.length} shots`)}`)
    if (plan.staging) log.line(styles.muted(`        staging: ${plan.staging}`))
    const nameOf = (id: string) => cast.characters.find(c => c.id === id)?.name ?? id
    for (const shot of plan.shots) log.line(styles.muted(`        · ${shot.characters?.length ? `[${shot.characters.map(nameOf).join(', ')}] ` : ''}${shot.action}`))
}

////////// CHOOSING THE VIEW OF THE PLACE - only with "locationView": "auto"
// The views are the frames the location sheets were composed of: without sequence sheets there are none and the picture is the plain one
const locationView = config.sequenceSheets ? config.locationView : -1
// The place's reference sheet shows it from five sides; a clip gets one of them as its picture. The planner knows where
// the camera of a shot stands, so it chooses - the views change from scene to scene instead of one fixed background.
// a beat without an entry (its answer failed, or it had no plan then) is asked again on the next run, the others stay
const viewsBefore = project.data.shotViews
if (viewsBefore && shotMoments && beats.some(b => shotMoments[b.id] && viewsBefore[b.id]?.length !== asBeatShots(shotMoments[b.id]!).shots.length)) delete project.data.shotViews
const shotViews = shotMoments && locationView === 'auto' ? await project.step('shotViews', '11c · CHOOSING THE VIEW OF THE PLACE PER SHOT', async () => {
    // the beats don't depend on each other here - asked at once, up to llm.parallel
    const answers = await llmMap(beats, async (beat): Promise<number[] | undefined> => {
        const plan = shotMoments[beat.id] && asBeatShots(shotMoments[beat.id]!)
        if (!plan) return undefined
        const kept = viewsBefore?.[beat.id]
        if (kept?.length === plan.shots.length) return kept
        const answer = await askJson<{ views: unknown[] }>({
            input: `A place is shown to the video model as a reference with five views of it. For every shot below choose the view the shot is in: the one that shows the part of the place the camera of the shot looks at, from the side it stands on. Different shots may be in different views; a shot that moves to another side of the place is in the view it starts in.
views (number: what it shows):
${LOCATION_VIEWS.map((v, n) => `${n}: ${v}${locationLayouts[beat.locationId]?.views[n] ? ` - ${locationLayouts[beat.locationId]!.views[n]}` : ''}`).join('\n')}

The place: ${plan.staging ?? beat.summary}
shots:
${JSON.stringify(plan.shots.map((s, n) => ({shot: n, framing: s.framing, camera: s.camera, view: s.view, action: s.action})))}

Answer only with JSON: {"views": [one number from 0 to ${LOCATION_VIEWS.length - 1} per shot, in order]} - exactly ${plan.shots.length} numbers.`,
            instructions: 'You are a music video director who chooses the view of a place for each shot. Answer only with JSON.',
            // a few numbers per beat: 18.6 min of thinking for the 14 beats of tides-of-eternal-flame, 27 s without it, the
            // picks differing only where the camera of a shot sits between two views
            reasoning: 'none',
            schema: {type: 'object', additionalProperties: false, required: ['views'], properties: {views: {type: 'array', minItems: plan.shots.length, maxItems: plan.shots.length, items: {type: 'integer', minimum: 0, maximum: LOCATION_VIEWS.length - 1}}}},
        }).catch((e: unknown) => {
            log.warn(`${beat.id}: the answer for the views is unusable (${e instanceof Error ? e.message : e}) - its shots are in the first view`)
            return undefined
        })
        // not stored: the beat is asked again on the next run instead of keeping the first view for good
        if (!answer) return undefined
        const views = plan.shots.map((_, n) => {
            const v = Number(answer?.views?.[n])
            return Number.isInteger(v) && v >= 0 && v < LOCATION_VIEWS.length ? v : 0
        })
        log.line(`   ${styles.name(beat.id)} ${styles.muted(`views ${views.join(', ')}`)}`)
        return views
    })
    const result: Record<string, number[]> = {}
    beats.forEach((beat, i) => {
        if (answers[i]) result[beat.id] = answers[i]
    })
    return result
}) : undefined

////////// BUILDING THE MINIMAX H3 REQUESTS
// Deterministic from the data above, so it is rebuilt on every run instead of being cached
log.section('12 · BUILDING THE MINIMAX H3 REQUESTS')
const clips = buildClipRequests({
    slots: clipSlots,
    mapping,
    beats,
    characters: cast.characters,
    locations: cast.locations,
    characterDescriptions,
    characterDescriptionVariants,
    locationDescriptions,
    locationAnchors,
    lookBrief,
    music,
    language,
    singing,
    shotMoments,
    propActivity,
    stemsAvailable: Boolean(stems),
    continuity: config.continuity,
    pinStartFrame: config.pinStartFrame || config.contextFrames > 0,
    contextFrames: config.contextFrames,
    locationView,
    shotViews,
})

// more people than reference pictures: whoever did not fit is in the scene without a picture - the video model invents them
for (const clip of clips) {
    if (clip.dropped?.length) log.warn(`${clip.id}: no reference picture left for ${clip.dropped.map(id => cast.characters.find(c => c.id === id)?.name ?? id).join(', ')} - the workflow takes ${MAX_REFERENCE_IMAGES} pictures`)
}

const outputDir = join(project.dir, 'output')
// the output of the run before goes to output/.previous/ - to say below which requests this run changed
startOutput(outputDir)
mkdirSync(join(outputDir, 'clips'), {recursive: true})
mkdirSync(join(outputDir, 'audio'), {recursive: true})

// a track mixed of several instrument stems (lib/compose.ts mixStem) is a stem file of its own, made once per set of stems -
// uploaded and trimmed like any other stem
for (const audio of clips.flatMap(c => c.assets.audio)) {
    if (!audio.mix || !audio.stem || stemFiles[audio.stem]) continue
    const sources = audio.mix.map(stem => stemFiles[stem])
    if (sources.some(f => !f)) continue
    stemFiles[audio.stem] = await mixStems(sources as string[], join(project.dir, 'stems', `${audio.stem}.wav`))
}

for (const clip of clips) {
    await Bun.write(join(outputDir, 'clips', `${clip.id}.json`), JSON.stringify(clip, null, 2))
    // one debug-listenable file per track, cut from its own stem to this clip's span - not what's actually
    // uploaded for rendering any more (lib/render.ts uploads and trims the whole stem itself), just handy to
    // hear exactly what a track covers
    // only with --debug-audio: one ffmpeg process per track and clip, on every run, for files nobody needs to render
    for (const audio of args['debug-audio'] ? clip.assets.audio : []) {
        await cutAudio(stemFiles[audio.stem!]!, secondsAt(frameAt(audio.songStart)), secondsAt(frameAt(audio.songEnd)), join(project.dir, audio.file))
    }
}

// the pictures the requests expect, with the Krea 2 prompt to generate each one - a group character
// (memberCounts[c.id] > 1) gets one job per member instead of one shared job, see groupMemberId
const pictures: PictureJob[] = [
    ...cast.locations.map(l => ({
        kind: 'location' as const, id: l.id, file: pictureAsset('location', l.id), name: l.name,
        prompt: locationLooks[l.id] ?? '', description: locationDescriptions[l.id] ?? '',
    })),
    ...cast.characters.flatMap(c => {
        const count = memberCounts[c.id] ?? 1
        const looks = characterLookVariants[c.id] ?? [characterLooks[c.id] ?? '']
        const descriptions = characterDescriptionVariants[c.id] ?? [characterDescriptions[c.id] ?? '']
        return Array.from({length: count}, (_, i) => {
            const id = count > 1 ? groupMemberId(c.id, i) : c.id
            return {
                kind: 'character' as const, id, file: pictureAsset('character', id), name: c.name,
                prompt: looks[i] ?? looks[0] ?? '', description: descriptions[i] ?? descriptions[0] ?? '',
            }
        })
    }),
]
await Bun.write(join(outputDir, 'assets.json'), JSON.stringify(pictures, null, 2))

await Bun.write(join(outputDir, 'timeline.json'), JSON.stringify({
    song: songFile,
    bpm: music.bpm,
    durationSec: music.durationSec,
    maxClipSec: timeline.maxClipSec,
    barsPerClip: timeline.barsPerSlot,
    beats,
    clips: clips.map(c => ({
        id: c.id,
        start: c.start,
        end: c.end,
        duration: c.duration,
        section: c.section,
        beatId: c.beatId,
        shots: c.shots.length,
        ...(c.vocals ? {vocals: c.vocals} : {}),
        request: `clips/${c.id}.json`,
    })),
}, null, 2))

// the prompts are in output/clips/ and in the log file - the terminal shows them with --show=clips (or -v)
hideDetails(!showsDetails('clips'))
for (const clip of clips) {
    log.box(`${clip.id} · ${formatTime(clip.start)} – ${formatTime(clip.end)} · ${clip.section} · ${clip.beatId}`, clip.prompt)
}
hideDetails(false)
if (!showsDetails('clips')) log.step('Prompts', styles.muted(`${clips.length} - in ${join(project.dir, 'output', 'clips')} (--show=clips prints them here)`))
const changes = requestChanges(outputDir)
if (changes) {
    const {changed, added, gone} = changes
    if (!changed.length && !added.length && !gone.length) log.step('Changes', styles.muted('every request is the same as in the run before'))
    else {
        log.step('Changes', [
            changed.length ? `${changed.length} changed: ${formatSlotRanges(changed)}` : '',
            added.length ? `${added.length} new: ${formatSlotRanges(added)}` : '',
            gone.length ? `${gone.length} gone: ${formatSlotRanges(gone)}` : '',
        ].filter(Boolean).join(' · '))
        if (changed[0]) log.step('Compare', styles.muted(`diff ${join(outputDir, PREVIOUS, 'clips', `${changed[0]}.json`)} ${join(outputDir, 'clips', `${changed[0]}.json`)}`))
    }
}

////////// RENDERING WITH COMFYUI
if (render.has('images') || render.has('videos')) {
    const only = new Set(args.only.split(',').filter(Boolean))
    using renderer = new Renderer(project.id, project.dir, config, settings.comfy)
    renderer.refresh = refreshKinds
    log.section('13 · RENDERING WITH COMFYUI')
    log.step('Config', styles.muted(`seed ${config.seed}, images ${config.imageResolution} (${config.imageWorkflow}), video ${config.videoResolution} (${config.videoWorkflow})${config.sequenceSheets ? `, sequence sheets (${config.sequenceWorkflow})` : ''}`))
    log.step('Servers', `${settings.comfy.map(s => `${styles.name(s.name)} ${styles.muted(s.url)}`).join(', ')} ${from(settings.sources.comfy)}`)

    // everything at once - the renderer runs one job per server and queues the rest
    if (render.has('images')) {
        log.step('Pictures', `${pictures.length}${config.sequenceSheets ? styles.muted(' (multi-angle reference sheets)') : ''}`)
        const todoPictures = pictures.filter(p => !existsSync(join(project.dir, p.file)))
        const pictureWorkflow = config.sequenceSheets ? config.sequenceWorkflow : config.imageWorkflow
        const pictureHash = await workflowHash(pictureWorkflow)
        const pictureJobs: RenderJob[] = todoPictures.map(() => ({
            kind: 'picture', name: pictureWorkflow, workflowHash: pictureHash,
            ...(config.sequenceSheets ? {frames: SEQUENCE_FRAMES} : {pixels: resolutionPixels(config.imageResolution)}),
        }))
        log.step('Estimate', styles.muted(describePrediction(config.sequenceSheets ? 'sheet video' : 'picture', predictJobs(readTimings(), pictureJobs, settings.comfy.map(server => server.name)))))
        await renderAll(pictures, picture => config.sequenceSheets ? renderer.renderSequenceSheet(picture) : renderer.renderPicture(picture))
    }
    // clips need all their pictures, so they start after the pictures - free the image model's VRAM first
    if (render.has('videos')) {
        if (render.has('images')) await renderer.freeMemory()
        const selected = clips.filter(c => only.size === 0 || only.has(c.id))
        log.step('Clips', `${selected.length}${only.size ? styles.muted(` of ${clips.length} (--only)`) : ''}`)
        // on request, and only for the clips named: the old version is put away in old/attempts/, then the clip is rendered again
        if (args.again) {
            const unknown = [...only].filter(id => !clips.some(c => c.id === id))
            if (unknown.length) throw new Error(`--only: no clip ${unknown.join(', ')} - the clips are ${clips.map(c => c.id).join(', ')}`)
            if (config.seed !== -1) log.warn(`"seed" is ${config.seed} in config.json - the same seed gives the same clip again; -1 gives a new one every time`)
            const stamp = versionStamp()
            for (const clip of selected) {
                const keep = archiveFiles(project.dir, `${clip.id}-${stamp}`, [join('videos', `${clip.id}.mp4`), join('videos', `${clip.id}.mp4.json`), boundaryFrameAsset(clip.id, 'ff'), boundaryFrameAsset(clip.id, 'lf')])
                log.step('Again', `${clip.id} ${styles.muted(`- the old one is in ${keep}`)}`)
                recordTiming({kind: 'clip', name: config.videoWorkflow, seconds: 0, outcome: 'again', reason: 'again'})
            }
            // a clip that goes on from the last frame of one of these starts on a picture that is gone
            const later = new Set<string>()
            for (const clip of selected) {
                for (let next = clips.find(c => c.startsFrom === clip.id); next; next = clips.find(c => c.startsFrom === next!.id)) if (!selected.includes(next)) later.add(next.id)
            }
            if (later.size) log.warn(`${[...later].join(', ')} start on the last frame of a clip rendered again and are not - render them again too (--again) if the picture should go on from the new one`)
        }
        const todoClips = selected.filter(c => args.again || !existsSync(join(project.dir, 'videos', `${c.id}.mp4`)))
        const clipHash = await workflowHash(config.videoWorkflow)
        const clipJobs: RenderJob[] = await Promise.all(todoClips.map(async c => ({
            kind: 'clip' as const, name: config.videoWorkflow, workflowHash: clipHash, frames: await renderer.plannedFrames(c.frames), pixels: resolutionPixels(config.videoResolution),
        })))
        log.step('Estimate', styles.muted(describePrediction('clip', predictJobs(readTimings(), clipJobs, settings.comfy.map(server => server.name)))))
        // a clip that starts on the last frame of the one before waits for it: those clips render one after the other,
        // each chain next to the others
        await renderAll(clipChains(selected), async chain => {
            for (const clip of chain) await renderer.renderClip(clip, stemFiles)
        })
    }
}

////////// ASSEMBLING THE FINAL VIDEO
if (render.has('final')) {
    log.section('14 · ASSEMBLING THE FINAL VIDEO')
    log.step('Audio', config.songAudio ? 'original song' : styles.muted('the clips\' own audio ("songAudio": false)'))
    const target = join(project.dir, `${project.id}.mp4`)
    // a clip made from another request than the plan has now is still a clip: said here, an error only with --strict
    const stale = clips.filter(c => freshness(join(project.dir, 'videos', `${c.id}.mp4`), clipFingerprint(c, project.dir, config)) === 'stale').map(c => c.id)
    if (stale.length) {
        const message = `${stale.length} clip(s) were made from another prompt, picture or start frame than the plan has now: ${formatSlotRanges(stale)} - render them again with --render=videos --refresh=clips`
        if (args.strict) throw new Error(message)
        log.warn(message)
    }
    const result = await assembleFinal({clips, projectDir: project.dir, songFile, songAudio: config.songAudio, target})
    log.step('Saved', `${target} ${styles.muted(`${result.width}x${result.height}, ${result.frames} frames, ${result.seconds.toFixed(3)}s`)}`)
    // the light grade and sharpen ("finish"): a copy next to each final video, which itself stays as it is
    const finishing = finishOf(config.finish)
    // where each clip is in the final video - the same seconds at every frame rate
    const spans = clips.map(c => ({id: c.id, start: secondsAt(c.frameStart), end: secondsAt(c.frameStart + c.frames)}))
    const finish = async (video: string) => {
        if (!finishing) return
        const done = await finishVideo(video, finishing, spans)
        log.step('Finished', `${done.file} ${styles.muted(finishing.colorMatch > 0 ? `${finishFilter(finishing)}, ${spans.length} clips matched ${finishing.colorMatch} of the way to ${finishing.colorReference || 'their median'}` : done.filter)}`)
    }
    await finish(target)

    // a second video at another frame rate ("finalFps"): every clip gets more frames on ComfyUI, shot by shot - a job per
    // clip, kept in videos/interpolated/ and made again only when the clip, its cuts or the model change
    if (config.finalFps !== FPS) {
        const multiplier = multiplierFor(config.finalFps)!
        log.step('Frame rate', `${config.finalFps} fps - ${config.interpolationModel}, x${multiplier} per shot`)
        using smoother = new Renderer(project.id, project.dir, config, settings.comfy)
        const files = clips.map(c => join(project.dir, 'videos', 'interpolated', `${c.id}.mp4`))
        await renderAll(clips.map((clip, i) => ({clip, file: files[i]!})), ({clip, file}) => smoother.renderInterpolation(clip, config.interpolationModel, multiplier, file))
        const smooth = join(project.dir, `${project.id}-${config.finalFps}fps.mp4`)
        const more = await assembleFinal({clips, projectDir: project.dir, songFile, songAudio: config.songAudio, target: smooth, interpolated: {files, multiplier, fps: config.finalFps}})
        log.step('Saved', `${smooth} ${styles.muted(`${more.width}x${more.height}, ${more.frames} frames at ${config.finalFps} fps, ${more.seconds.toFixed(3)}s`)}`)
        await finish(smooth)
    }
}

////////// EXPORTING THE TIMELINE FOR A VIDEO EDITOR
if (exportFormats.length) {
    log.section('15 · EXPORTING THE TIMELINE')
    const written = await exportTimelines({formats: exportFormats as ExportFormat[], clips, projectDir: project.dir, projectName: project.id, songFile, songAudio: config.songAudio})
    for (const [format, file] of Object.entries(written)) log.step(format === 'mlt' ? 'Shotcut / Kdenlive' : 'OpenShot', file)
}

log.section('✔ DONE')
log.step('Clips', `${clips.length} H3 requests covering ${formatTime(clips.at(-1)?.end ?? 0)} of ${formatTime(music.durationSec)}`)
log.step('Timeline', join(outputDir, 'timeline.json'))
log.step('Requests', join(outputDir, 'clips'))
log.step('Audio', join(outputDir, 'audio'))
log.step('Pictures needed', `${pictures.length} - see ${join(outputDir, 'assets.json')}`)
// what this run did: the steps it generated, its LLM calls and renders, its warnings
log.step('Generated', project.generated.size ? [...project.generated].map(styles.name).join(', ') : styles.muted('nothing - every step was taken from project.json'))
const measured = runTimings()
const llmCalls = measured.filter(t => t.kind === 'llm')
if (llmCalls.length) {
    const tokens = llmCalls.reduce((sum, t) => sum + (t.completionTokens ?? 0), 0)
    const retried = llmCalls.filter(t => t.outcome).length
    log.step('LLM', `${llmCalls.length} call(s), ${formatDuration(llmCalls.reduce((sum, t) => sum + t.seconds, 0) * 1000)}${tokens ? `, ${tokens} tokens written` : ''}${retried ? styles.muted(` · ${retried} cut off, empty or failed and asked again`) : ''}`)
}
for (const kind of ['picture', 'clip', 'song'] as const) {
    const renders = measured.filter(t => t.kind === kind && !t.outcome)
    if (renders.length) log.step('Rendered', `${renders.length} ${kind}(s), ${formatDuration(renders.reduce((sum, t) => sum + t.seconds, 0) * 1000)}`)
}
// the same warning several times (one per clip, one per beat) is one line with its count
const warned = new Map<string, number>()
for (const message of runWarnings()) warned.set(message, (warned.get(message) ?? 0) + 1)
if (warned.size) {
    log.step('Warnings', `${runWarnings().length}${warned.size > 8 ? styles.muted(` - the first 8 of ${warned.size} different ones, all in the log`) : ''}`)
    for (const [message, count] of [...warned].slice(0, 8)) log.line(styles.warning(`   ${count > 1 ? `${count}× ` : ''}${message.length > 160 ? `${message.slice(0, 157)}…` : message}`))
}
log.step('Log', runLogFile() ?? '')

/**
 * --dry-run: the steps the run would redo (by --redo, by changed inputs and settings, by gone stems, by changed lyrics
 * sections or clip length - along the dependencies) and the steps not generated yet, then what --render would render,
 * with the estimate from the measured timings. The renders are counted from the requests of the last plan run.
 */
async function dryRun() {
    const changed = project.changedInputs(await projectInputs(project.dir, config))
    const lostStems = (['stems', 'instrumentStems'] as const).filter(step => project.data[step] && Object.values(project.data[step]!).some(file => !existsSync(join(project.dir, file))))
    const labels = projectLyricSections(await readInput('lyrics.txt'), project.data.music?.sections.map(s => s.label)).map(s => s.label)
    const sectionsChanged = project.data.music !== undefined && labels.length > 0 && project.data.music.sections.map(s => s.label).join('|') !== labels.join('|')
    const reasons: [string, StepName[]][] = [
        ...(redoSteps.length ? [['--redo', redoSteps] as [string, StepName[]]] : []),
        ...changed.map(c => [`${c.name} changed`, c.steps] as [string, StepName[]]),
        ...lostStems.map(step => [`a file of ${step} is gone`, [step]] as [string, StepName[]]),
        ...(sectionsChanged ? [['the lyrics sections changed', ['music']] as [string, StepName[]]] : []),
        ...(timelineOutdated ? [['the longest clip changed', ['timeline']] as [string, StepName[]]] : []),
    ]
    const redone = project.redoneBy(reasons.flatMap(([, steps]) => steps))
    // whether a step is used is read from the project as it is once the redone steps are gone (the blocking is made when the shots are planned again)
    const after = Object.fromEntries(Object.entries(project.data).filter(([step]) => !(redone as string[]).includes(step)))
    const missing = STEP_NAMES.filter(step => project.data[step] === undefined && !redone.includes(step) && stepUsed(step, project.dir, after, config))

    log.section('DRY RUN - nothing is done')
    for (const [why, steps] of reasons) log.step(why, styles.muted(`redoes ${steps.join(', ')}`))
    log.step('Redone', redone.length ? redone.map(styles.name).join(', ') : styles.muted('nothing - every step is taken from project.json'))
    if (missing.length) log.step('Generated', `${missing.map(styles.name).join(', ')} ${styles.muted('- not generated yet')}`)

    if (!render.has('images') && !render.has('videos') && !render.has('final')) return
    const state = await renderState(project.dir, project.id, config)
    const servers = settings.comfy.map(s => s.name)
    if (redone.length || missing.length) log.warn('the renders below are counted from the requests of the last plan run - the steps redone now can change them')
    if (render.has('images')) {
        const stale = refreshKinds.has('pictures') ? styles.muted(' (stale pictures are not counted - --refresh=pictures renders those too)') : ''
        log.step('Pictures', state.missingPictures.length ? `${await pictureEstimate(state.missingPictures.length, config, servers)}${stale}` : styles.muted('all rendered'))
    }
    if (render.has('videos')) {
        const only = new Set(args.only.split(',').filter(Boolean))
        const selected = state.clips.filter(c => !only.size || only.has(c.id))
        const todo = selected.filter(c => args.again || state.missingClips.includes(c) || (refreshKinds.has('clips') && state.staleClips.includes(c)))
        log.step('Clips', todo.length ? `${await clipEstimate(todo, config, servers)} ${styles.muted(`- ${formatSlotRanges(todo.map(c => c.id))}`)}` : styles.muted('all rendered'))
    }
    if (render.has('final')) log.step('Final video', state.missingClips.length ? styles.warning(`needs every clip - ${state.missingClips.length} missing`) : styles.muted('assembled from the clips'))
}

/**
 * The singers from config.json: names or ids matched loosely against the cast, or ["auto"] - the LLM picks the lead
 * singer(s). With several singers, the LLM also decides who sings which line.
 */
async function chooseSingers(wanted: string[]): Promise<Singing> {
    const characters = cast.characters
    const lines = sungLines(lyricSections)
    const castList = JSON.stringify(characters.map(c => ({id: c.id, name: c.name, role: c.role})))
    const known = (ids: unknown) => (Array.isArray(ids) ? ids : []).filter((id): id is string => characters.some(c => c.id === id))
    let singers: string[]

    if (wanted[0] === 'auto') {
        const picked = await askJson<{ singers: string[] }>({
            input: `Pick the singers of this music video from the cast: the characters who sing the lyrics on screen.
Pick the lead first, and prefer an individual character for it: the one whose story the song tells, or who calls the lines out. A group character (e.g. "Miners") sings as well when the lyrics have group parts ("we", a chorus, a shouted refrain, lines the others answer) - then pick the lead and the group both, so that the verses can be the lead's and the refrains the group's. Pick the group alone only if the whole song is clearly sung by the group as one voice and nobody in it leads. A party made of individual characters (a crew or band of named members) is no group entry: its refrains are sung by the lead together with up to two of its members, the ones with the most to do in the story - the rest of the party stays on screen. Several individual singers only if the lyrics clearly are a dialogue or duet between different characters. Three singers at most. Characters that fight, hunt or threaten the singers do not sing.
${voiceRules(config.singerVoice).pick}Answer only with JSON: {"singers": ["<character id>"]}
---
cast: ${castList}
lyrics:
${lyrics}
---
story summary:
${storySummary}`,
            instructions: 'You are a music video director who casts the singers of a performance video. Answer only with JSON.',
            schema: {type: 'object', additionalProperties: false, required: ['singers'], properties: {singers: {type: 'array', minItems: 1, maxItems: 3, items: {enum: characters.map(c => c.id)}}}},
        })
        singers = known(picked.singers)
        if (!singers.length) throw new Error(`The LLM picked no singer from the cast (${JSON.stringify(picked.singers)}) - run again, or name the singers in config.json`)
    } else {
        // a name the cast does not carry letter for letter (config.json in the song's language, the cast in English: "schamanin" / "Shamaness")
        // is asked once: the LLM knows which character is meant, code does not guess
        const unmatched = wanted.filter(name => !findCharacter(characters, name))
        const resolved = new Map<string, string>()
        if (unmatched.length) {
            const mapped = await askJson<{ singers: { name: string, id: string | null }[] }>({
                input: `config.json names these singers of a music video, but not all of them are spelled like the characters of the cast (another language, a nickname, an epithet). For every name say which character of the cast it means - or null if none does.
Mind the grammatical gender of the name (German "Schamanin" is the woman, "Schamane" the man) and take the character of that gender, even if another character has the more similar spelling.
${voiceRules(config.singerVoice).pick}Answer only with JSON: {"singers": [{"name": "<name as given>", "id": "<character id or null>"}]}
---
names: ${JSON.stringify(unmatched)}
cast: ${castList}
story summary:
${storySummary}`,
                instructions: 'You match names to the characters of a cast. Answer only with JSON.',
                schema: {type: 'object', additionalProperties: false, required: ['singers'], properties: {singers: {type: 'array', items: {
                    type: 'object', additionalProperties: false, required: ['name', 'id'],
                    properties: {name: {enum: unmatched}, id: {enum: [...characters.map(c => c.id), null]}},
                }}}},
            })
            for (const m of mapped.singers ?? []) {
                const [id] = known([m.id])
                if (id) resolved.set(m.name, id)
            }
        }
        singers = [...new Set(wanted.flatMap(name => {
            const character = findCharacter(characters, name)
            const id = character?.id ?? resolved.get(name)
            if (!id) log.warn(`singers: "${name}" is not in the cast - ignored`)
            else if (!character) log.step('Singers', `"${name}" is ${id}`)
            return id ? [id] : []
        }))]

        if (!singers.length) throw new Error(`singers: none of ${wanted.join(', ')} is in the cast. The characters are: ${characters.map(c => `${c.name} (${c.id})`).join(', ')}`)
    }
    if (singers.length === 1) return {singers, lines: lines.map(l => ({line: l.line, text: l.text, singers}))}

    const assigned = await askJson<{ lines: { line: number, singers: string[] }[] }>({
        reasoning: 'medium',
        // thinking at medium easily takes 8k tokens on its own, the long JSON comes on top
        maxTokens: Math.max(16384, lines.length * 100),
        input: `These characters sing the song of a music video: ${JSON.stringify(singers)}.
Decide who sings which line. A line is sung by one singer, or by several together (duet or choir lines, e.g. a chorus).
Follow the lyrics and the story: who would say these words? Keep a verse with one singer unless its lines answer each other. When a group, or companions of the lead, are among the singers, they sing the refrains and the shouted group lines - together with the lead, so name all of them - and the lead alone sings the verses; the group alone sings only a line that is clearly only theirs.
Answer only with JSON: {"lines": [{"line": 0, "singers": ["<character id>"]}, ...]} - one entry for every line number below.
---
cast: ${castList}
lines: ${JSON.stringify(lines.map(l => ({line: l.line, section: l.section, text: l.text})))}
---
story summary:
${storySummary}`,
        instructions: 'You are a music video director who splits a song between its singers. Answer only with JSON.',
        schema: {type: 'object', additionalProperties: false, required: ['lines'], properties: {lines: {type: 'array', items: {
            type: 'object', additionalProperties: false, required: ['line', 'singers'],
            properties: {line: {enum: lines.map(l => l.line)}, singers: {type: 'array', minItems: 1, uniqueItems: true, items: {enum: singers}}},
        }}}},
    })
    // a model that loops repeats a singer in a line ("lyra, kaelen, lyra, ...") - each sings it once
    const byLine = new Map((assigned.lines ?? []).map(l => [l.line, [...new Set(known(l.singers).filter(id => singers.includes(id)))]]))
    const missing = lines.filter(l => !byLine.get(l.line)?.length)
    if (missing.length) log.warn(`${missing.length} line(s) got no singer - sung by ${singers[0]}`)
    return {singers, lines: lines.map(l => ({line: l.line, text: l.text, singers: byLine.get(l.line)?.length ? byLine.get(l.line)! : [singers[0]!]}))}
}

// "Thorin" finds "thorin" and "thorin-oakenshield", "miner" finds "miners"
function findCharacter(characters: Character[], name: string) {
    const slug = toId(name)
    const tokens = (id: string) => id.split('-').map(t => t.replace(/s$/, ''))
    return characters.find(c => c.id === slug || toId(c.name) === slug)
        ?? characters.find(c => tokens(slug).every(t => tokens(c.id).includes(t)))
}

// what the story beats must do so the singers can be lip-synced
function performanceRules({singers, lines}: Singing) {
    const nameOf = (id: string) => cast.characters.find(c => c.id === id)?.name ?? id
    const sectionOf = new Map(sungLines(lyricSections).map(l => [l.line, l.section]))
    const bySection = new Map<string, Set<string>>()
    for (const l of lines) {
        const section = sectionOf.get(l.line) ?? ''
        if (!bySection.has(section)) bySection.set(section, new Set())
        for (const id of l.singers) bySection.get(section)!.add(id)
    }
    return `
This is a performance music video: ${singers.map(nameOf).join(', ')} ${singers.length > 1 ? 'sing' : 'sings'} the lyrics on screen, lip-synced, while acting out the story.
Sections with vocals and who sings them: ${[...bySection].map(([section, ids]) => `${section} (${[...ids].join(', ')})`).join('; ')}.
Sections without vocals have no singing - the story plays freely there.
For every beat that plays while the song has vocals:
- the singer(s) of that section are on screen: their ids are in "characterIds".
- they sing while they act, e.g. "{Thorin} sings while forging the blade", "{Vael} sings through the blow she takes from the orc" - the mouth stays in view (three-quarter or profile is fine, looking at what the story has them look at), no hidden faces, no masks or objects over the mouth.
`
}

// No project id given: the projects, most recently changed first, to pick one with the arrow keys - without a
// terminal (scripts, CI) nobody can pick, so the usage error lists them instead
async function pickProject(): Promise<string> {
    const projects = listProjects()
    if (!projects.length) return log.usageError('No project id given, and there is no project in projects/ yet - create one with: bun run init', usage)
    if (!process.stdin.isTTY || !process.stdout.isTTY) return log.usageError(`No project id given - the projects here are: ${projects.join(', ')}`, usage)
    const picked = await clack.select({message: 'Which project?', options: projects.map(id => ({value: id, label: id}))})
    if (clack.isCancel(picked)) process.exit(0)
    return picked
}

function energyBar(value: number) {
    const filled = Math.round(value * 8)
    return styles.answer('█'.repeat(filled)) + styles.muted('░'.repeat(8 - filled))
}
