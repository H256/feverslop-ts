import slugify from "slugify";
import {existsSync, readdirSync} from "node:fs";
import {parseArgs} from "node:util";
import {log, printBanner, styles} from "./lib/log.ts";
import {ask, askJson, configureLlm} from "./lib/llm.ts";
import {mkdirSync, rmSync} from "node:fs";
import {join} from "node:path";
import {type BeatShots, type Character, type Location, ProjectStore, type PropStem, type Singing, STEP_NAMES, type StepName, type StoryBeat} from "./lib/project.ts";
import {analyzeSong, buildTimeline, cutAudio, mapBeatsToSlots, parseLyricSections, separateInstrumentStems, separateStems, stemActivity, transcribeVocals} from "./lib/music.ts";
import {asBeatShots, readBeatPlan} from "./lib/shot-plan.ts";
import {boundaryFrameAsset, buildClipRequests, type ClipRequest, computeMemberCounts, isContinuous, countShotsPerBeat, groupMemberId, pictureAsset, propActivityPerBeat, singingPerBeat} from "./lib/compose.ts";
import {type PictureJob, Renderer} from "./lib/render.ts";
import {languageName, loadProjectConfig} from "./lib/config.ts";
import {alignLyrics, lowConfidence, sungLines} from "./lib/lyrics.ts";
import {archiveFiles, versionStamp} from "./lib/archive.ts";
import {assembleFinal} from "./lib/assemble.ts";
import {writeGallery} from "./lib/gallery.ts";
import {EXPORT_FORMATS, type ExportFormat, exportTimelines} from "./lib/timeline-export.ts";
import {FPS, formatTime, frameAt, secondsAt} from "./lib/frames.ts";
import {loadSettings} from "./lib/settings.ts";
import {type FilmStyle, pickStyle, shuffledStyles, stylesById} from "./lib/styles.ts";
import {projectExists, validProjectId} from "./lib/project-setup.ts";
import {propMissing} from "./lib/prop-check.ts";
import {
    castPrompt, voiceRules, characterDescriptionPrompt, characterLookPrompt, characterVariantLookPrompt, locationDescriptionPrompt,
    locationLookPrompt, lookBriefPrompt, songLyricsPrompt, songStylePrompt, storyPrompt, styleShortlistPrompt, summaryPrompt,
} from "./lib/prompts.ts";

// any step's rejected promise (everything here is awaited, so a thrown Error from deep in the pipeline surfaces
// as one of these) gets the same tidy red box as a bad --flag, instead of Bun's raw stack-trace dump
process.on('unhandledRejection', e => log.fatal(e instanceof Error ? e.message : String(e)))
process.on('uncaughtException', e => log.fatal(e instanceof Error ? e.message : String(e)))

printBanner()

// hardware limit: the longest clip the video model can generate in one go. Set a little below the real
// limit - the H3 node only renders 5 + 17·k frames, so every clip is rounded up to the next such length at
// render time (up to 16 extra frames / 0.67s, see docs/comfyui.md) - a clip targeted at exactly the real
// limit can still render over it.
const MAX_CLIP_SEC = 10 - 17 / FPS

// bun index.ts [project-id] [--redo=story,beats] [--render=song,images,videos,final|all] [--only=slot-001,slot-002]
//              [--llm-url=…] [--llm-key=…] [--llm-model=…] [--comfy=http://a:8188,http://b:8188] [--legacy-moments]  (this run only)
const usage = `bun index.ts [project-id] [--redo=story,beats] [--render=song,images,videos,final|all] [--only=slot-001,slot-002] [--again]
             [--llm-url=…] [--llm-key=…] [--llm-model=…] [--comfy=http://a:8188,http://b:8188] [--legacy-moments]
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
                comfy: {type: 'string'},
                // skips step 11b and spreads/reuses beat.moments across shots the old way - a fallback while 11b is new
                'legacy-moments': {type: 'boolean', default: false},
                gallery: {type: 'boolean', default: false},
                export: {type: 'string', default: ''},
            },
        })
    } catch (e) {
        return log.usageError(e instanceof Error ? e.message : String(e), usage)
    }
})()
// --render=all is images, videos and the final video, in that order - "song" is never part of "all", it has to be asked for
const render = new Set(args.render.split(',').filter(Boolean).flatMap(r => r === 'all' ? ['images', 'videos', 'final'] : [r]))
const unknownRender = [...render].filter(r => !['song', 'images', 'videos', 'final'].includes(r))
if (unknownRender.length) log.usageError(`--render: unknown "${unknownRender.join(', ')}" - use song, images, videos, final or all`, usage)
// --again renders the clips named in --only once more, with a new seed - the old version is put away in old/attempts/, never overwritten
if (args.again && !render.has('videos')) log.usageError('--again goes with --render=videos: it renders the clips named in --only again, with a new seed', usage)
if (args.again && !args.only) log.usageError('--again needs --only=slot-001,... - say which clips are rendered again, every one is GPU time', usage)
const exportFormats = [...new Set(args.export.split(',').filter(Boolean).flatMap(f => f === 'all' ? [...EXPORT_FORMATS] : [f]))]
const unknownFormats = exportFormats.filter(f => !(EXPORT_FORMATS as readonly string[]).includes(f))
if (unknownFormats.length) log.usageError(`--export: unknown "${unknownFormats.join(', ')}" - use ${EXPORT_FORMATS.join(', ')} or all`, usage)
const redoSteps = args.redo.split(',').filter(Boolean) as StepName[]
const unknownRedo = redoSteps.filter(s => !(STEP_NAMES as string[]).includes(s))
if (unknownRedo.length) log.usageError(`--redo: unknown step "${unknownRedo.join(', ')}" - use ${STEP_NAMES.join(', ')}`, usage)
const DEFAULT_PROJECT = 'well-of-youth-gothic-trio-260920' // author's own current project, pass your own project-id otherwise
const projectId = positionals[0] ?? DEFAULT_PROJECT
if (!validProjectId(projectId)) log.usageError(`"${projectId}" is not a project id - lowercase letters, digits and "-" only (it is the folder name in projects/ and part of the ComfyUI client id)`, usage)
if (!projectExists(projectId)) {
    const existing = existsSync('projects') ? readdirSync('projects', {withFileTypes: true}).filter(d => d.isDirectory()).map(d => d.name) : []
    log.usageError(`${positionals[0] ? `No project "${projectId}" in projects/` : `No project id given, and the author's default project "${DEFAULT_PROJECT}" doesn't exist in projects/`} - ${existing.length ? `the projects here are: ${existing.join(', ')}. ` : ''}Create one with: bun run init`, usage)
}
const project = new ProjectStore(projectId)
const maxClipSec = MAX_CLIP_SEC
await project.load()
if (args.gallery) {
    if (!existsSync(project.dir)) throw new Error(`No project "${project.id}" in projects/`)
    const {file, counts} = await writeGallery(project.dir, project.id, project.data)
    log.step('Gallery', `${file} ${styles.muted(Object.entries(counts).map(([tab, n]) => `${tab}: ${n}`).join(' · '))}`)
    process.exit(0)
}
for (const step of redoSteps) project.invalidate(step)
if (project.data.timeline && project.data.timeline.maxClipSec !== maxClipSec) project.invalidate('timeline')

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
    comfy: args.comfy,
})
configureLlm(settings.llm)
// where a setting comes from: (settings), (project), (env), (flag), (default)
const from = (source: string) => styles.muted(`(${source === 'file' ? 'settings' : source})`)
// the model itself is checked on the first LLM call - a fully cached project needs no server
log.step('LLM', settings.llm.url
    ? `${settings.llm.url} ${from(settings.sources.llmUrl)} · ${settings.llm.model ? `${styles.name(settings.llm.model)} ${from(settings.sources.llmModel)}` : styles.muted('the only model on the server')}`
    : styles.muted('none configured - fine while every step is cached, else run: bun run setup llm'))
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
const lyricSections = parseLyricSections(lyrics)
log.step('Lyrics', lyrics ? styles.muted(`${lyricSections.length} sections: ${lyricSections.map(s => s.label).join(' · ')}`) : styles.muted('(none)'))
log.step('Story idea', storyIdea || styles.muted('(none)'))
log.step('Style', style || styles.muted('(none - the look is designed from the story)'))
log.step('Max clip length', `${maxClipSec}s`)
log.step('Mode', config.singers.length
    ? `performance - ${config.singers[0] === 'auto' ? 'the LLM picks the singer' : `${config.singers.join(', ')} sing${config.singers.length > 1 ? '' : 's'}`} (${language})`
    : `clip - the song is the soundtrack${config.alignLyrics ? ', lyrics aligned' : ''} ${styles.muted('(set "singers" in config.json to let characters sing)')}`)
if (config.alignLyrics && sungLines(lyricSections).length === 0) throw new Error('Aligning the lyrics needs sung lines in input/lyrics.txt')
if (!lyrics && !storyIdea) throw new Error('Neither lyrics nor a story idea given - add input/lyrics.txt or input/story-idea.txt')

// an edited input redoes the steps built on it
await project.syncInputs({
    // no "assumed" for these three - unlike the ones below, they never existed before this feature, so there is
    // no old project to treat as unchanged; on a real first run "previous" is simply undefined and nothing redoes
    'idea.txt': {value: idea, steps: ['songStyle']},
    'music-style.txt': {value: musicStyle, steps: ['songStyle']},
    'song.wav': {value: existsSync(songFile) ? await Bun.file(songFile).bytes() : '', steps: ['music', 'stems']},
    'lyrics.txt': {value: lyrics, steps: ['story', 'transcript', 'singing', 'songStyle']},
    'story-idea.txt': {value: storyIdea, steps: ['story']},
    'style.txt': {value: style, steps: ['lookBrief'], assumed: ''},
    singers: {value: JSON.stringify(config.singers), steps: ['singing'], assumed: '[]'},
    singerVoice: {value: config.singerVoice, steps: ['story'], assumed: 'auto'},
    lyricsLanguage: {value: config.lyricsLanguage, steps: ['transcript'], assumed: 'en'},
    // which beats run on without a cut changes what their shots have to tell
    continuity: {value: config.continuity, steps: ['shotMoments'], assumed: 'auto'},
})
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
    console.log(`   ${energyBar(s.energy)} ${styles.muted(`${formatTime(s.start)} – ${formatTime(s.end)}`)} ${styles.name(s.label)}`)
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

const lyricsTiming = transcript ? await project.step('lyricsTiming', '2c · ALIGNING THE LYRICS', async () => alignLyrics(lyricSections, transcript.words, music.sections, transcript.activity)) : undefined
if (lyricsTiming) {
    for (const line of lyricsTiming.lines) {
        const confidence = line.confidence < 0.5 ? styles.warning(line.confidence.toFixed(2)) : styles.muted(line.confidence.toFixed(2))
        console.log(`   ${styles.muted(`${formatTime(line.start, true)} – ${formatTime(line.end, true)}`)} ${confidence} ${styles.name(line.section.padEnd(12))} ${line.text}`)
    }
    const unsure = lowConfidence(lyricsTiming)
    if (unsure.length) log.warn(`${unsure.length} line(s) barely found in the transcript - their times are interpolated. Check them and fix lyricsTiming in ${project.file} by hand if needed, then --redo=timeline`)
}

////////// CRAFT A STORY FOR THE LYRICS
const storyBase = await project.step('story', '3 · CRAFTING THE STORY', () => ask(storyPrompt(lyrics, storyIdea, config.singerVoice)))
log.box('Story', storyBase)
if (storyBase === 'NO STORY') throw new Error('Neither lyrics nor a story idea given')

////////// SUMMARIZE THE STORY
const storySummary = await project.step('summary', '4 · SUMMARIZING THE STORY', () => ask(summaryPrompt(storyBase)))
log.box('Summary', storySummary)

////////// EXTRACT LOCATIONS AND CHARACTERS
const cast = await project.step('cast', '5 · EXTRACTING CHARACTERS & LOCATIONS', async () => {
    const extracted = await askJson<{ characters: (Omit<Character, 'id'> & { propStem?: string })[], locations: Omit<Location, 'id'>[] }>(castPrompt(storyBase, config.singerVoice))
    const stemNames = new Set(['drums', 'bass', 'other', 'guitar', 'piano'])
    return {
        characters: extracted.characters.map(c => ({
            id: toId(c.name), name: c.name, role: c.role,
            ...(c.isGroup === true ? {isGroup: true} : {}),
            ...(c.isGroup === true && c.alike === true ? {alike: true} : {}),
            ...(c.prop ? {prop: c.prop} : {}),
            ...(c.prop && c.propStem && stemNames.has(c.propStem) ? {propStem: c.propStem as PropStem} : {}),
        })),
        locations: extracted.locations.map(l => ({id: toId(l.name), ...l})),
    }
})
log.step('Characters', styles.muted(`(${cast.characters.length})`))
for (const c of cast.characters) console.log(`   ${styles.name(c.id)} ${styles.muted('—')} ${c.role}${c.prop ? styles.muted(` · ${c.prop}${c.propStem ? ` (${c.propStem})` : ''}`) : ''}`)
log.step('Locations', styles.muted(`(${cast.locations.length})`))
for (const l of cast.locations) console.log(`   ${styles.name(l.id)}`)

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
        result[stemName] = await stemActivity(join(project.dir, stemFile))
    }
    return result
}) : undefined
if (propActivity) for (const [stemName, ranges] of Object.entries(propActivity)) log.step('Activity', styles.muted(`${stemName}: ${ranges!.length} range(s) from RMS energy`))
else if (neededStems.length) log.warn(`${neededStems.length} character(s) have an audible instrument prop, but stems weren't separated (set "alignLyrics": true in config.json) - instruments will be shown playing throughout`)

////////// CHOOSING THE SINGERS - performance mode only
const singing = config.singers.length ? await project.step('singing', '5b · CHOOSING THE SINGERS', () => chooseSingers(config.singers)) : undefined
if (singing) {
    const nameOf = (id: string) => cast.characters.find(c => c.id === id)?.name ?? id
    log.step('Singers', singing.singers.map(id => styles.name(nameOf(id))).join(', '))
    if (singing.singers.length > 1) {
        for (const line of singing.lines) console.log(`   ${styles.muted(line.singers.map(nameOf).join(' + ').padEnd(24))} ${line.text}`)
    }
}

/////////// DESIGNING THE LOOK - invented from the story, or extending the director's style.txt
const lookBrief = await project.step('lookBrief', '6 · DESIGNING THE FILM LOOK', () => ask(lookBriefPrompt(style, storySummary)))
log.box('Look brief', lookBrief)

////////// CRAFTING CHARACTER LOOKS
const characterLooks = await project.step('characterLooks', '7 · CRAFTING CHARACTER LOOKS', async () => {
    const looks: Record<string, string> = {}
    for (const [i, char] of cast.characters.entries()) {
        log.step(`Character ${i + 1}/${cast.characters.length}`, styles.name(char.id))
        const otherLooks = cast.characters.filter(c => c.id !== char.id && looks[c.id]).map(c => ({name: c.name, look: looks[c.id]!}))
        looks[char.id] = await ask(characterLookPrompt(lookBrief, char, otherLooks))
    }
    return looks
})
for (const [id, look] of Object.entries(characterLooks)) log.box(id, look)
// a prop the look does not name is not in the reference picture - the clips would show the model's own idea of it
for (const c of cast.characters) {
    if (c.prop && characterLooks[c.id] && propMissing(characterLooks[c.id]!, c.prop)) log.warn(`${c.id}: the look does not show its prop "${c.prop}" - redo characterLooks, or edit the look in ${project.file} by hand`)
}

////////// DESCRIBING THE CHARACTERS - the look prompt without the reference sheet (pose, grey background, studio light)
const characterDescriptions = await project.step('characterDescriptions', '7b · DESCRIBING THE CHARACTERS FOR THE CLIPS', async () => {
    const descriptions: Record<string, string> = {}
    for (const [i, char] of cast.characters.entries()) {
        log.step(`Character ${i + 1}/${cast.characters.length}`, styles.name(char.id))
        descriptions[char.id] = await ask(characterDescriptionPrompt(characterLooks[char.id] ?? ''))
    }
    return descriptions
})
for (const [id, description] of Object.entries(characterDescriptions)) log.box(id, description)

////////// CRAFTING LOCATION LOOKS
const locationLooks = await project.step('locationLooks', '8 · CRAFTING LOCATION LOOKS', async () => {
    const looks: Record<string, string> = {}
    for (const [i, location] of cast.locations.entries()) {
        log.step(`Location ${i + 1}/${cast.locations.length}`, styles.name(location.id))
        looks[location.id] = await ask(locationLookPrompt(lookBrief, storySummary, location.name))
    }
    return looks
})
for (const [id, look] of Object.entries(locationLooks)) log.box(id, look)

////////// DESCRIBING THE LOCATIONS - the look prompt without the establishing shot (camera, "empty", medium)
const locationDescriptions = await project.step('locationDescriptions', '8b · DESCRIBING THE LOCATIONS FOR THE CLIPS', async () => {
    const descriptions: Record<string, string> = {}
    for (const [i, location] of cast.locations.entries()) {
        log.step(`Location ${i + 1}/${cast.locations.length}`, styles.name(location.id))
        descriptions[location.id] = await ask(locationDescriptionPrompt(locationLooks[location.id] ?? ''))
    }
    return descriptions
})
for (const [id, description] of Object.entries(locationDescriptions)) log.box(id, description)

// What the video model draws wrongly when a story or lyric text is taken at its word - shared by the beats and the shot-moments prompts
const filmableRules = `Keep to what a camera can really see, with ordinary physics:
  - Figurative language is never filmed as a thing: a name, a word, a voice, a memory, a feeling, a silence or a sound is not an object, not letters or writing, not glowing or visible matter, and nobody holds, carries, throws or hands one over. Show what a person really does or shows instead - the face, the eyes, the breath, the hands on real things in the room.
  - A character's face is always an ordinary human face, their own: never described as blank, pale, smudged, empty, covered or replaced by a shape. If a photograph or a mirror shows no face, that stays on the photograph or the mirror and is not written as a face missing on the character.
  - Something with no visible cause - a tap, a knock, a heartbeat, a pulse, a whisper - is never shown as an effect on a body or in the air. Show the person reacting, or a visible cause (a hand touching them, someone knocking on a door in the room).
  - A mirror or a window shows the plain, true reflection of the room and of whoever stands in front of it, moving exactly as they do: no reflection that acts, looks or stands differently, and nothing happening on the glass itself.
  - An object that stands in for a name, a feeling or a memory (a "blade-shaped object", a key, a stone that "is" the name) is the same metaphor: never invent one for a character to hold, turn or look at - the video model draws a different one in every cut. A character holds only the real prop listed for them.
  - Never write blank, featureless, faceless, smooth, smudged, erased, "pale oval" or "no face" about a face, or about a photograph near a face: a photograph is simply old and burnt at the edges, and its people are not described as missing.
  - Nothing in the picture is readable text: the video model scrambles every letter. A carved or written name, word or sign is "worn carved marks" or "a faded mark", never letters, and a name is never spelled out.
  - Things change once and stay changed: a door that opens stays open until a beat shows it closing, a mirror that cracks stays cracked, someone who is swallowed or gone does not come back. Never open, close and open the same thing again, and never show an event that already happened in an earlier beat once more.`

// moments that still break the two rules the model keeps breaking (stand-in objects, blank faces) - checked after the shot-moments step
const riskyMoment = /\b((featureless|blank|pale|smooth|smudged|erased|empty)(, (featureless|blank|pale|smooth))* (oval|face)|faceless|no face|blade-shaped|name-object|name object|letters?|carved name|KASPAR)\b/i

////////// BREAKING THE STORY INTO BEATS
// one beat per ~15 s of the song, so that no beat has to be stretched over far more clips than it has story for
const beatCount = Math.max(6, Math.round(music.durationSec / 15))
// where the last sung word ends - the singer is on screen until then
const vocalsEnd = Math.max(0, ...(lyricsTiming?.lines.flatMap(l => l.words.map(w => w.end)) ?? []))
const beats = await project.step('beats', '9 · BREAKING THE STORY INTO BEATS', async () => {
    const extracted = await askJson<{ beats: Omit<StoryBeat, 'id' | 'order'>[] }>({
        reasoning: 'medium',
        // thinking at medium easily takes 8k tokens on its own, the long JSON comes on top
        maxTokens: Math.max(16384, beatCount * 1100),
        input: `Break the story into story beats for a music video. A beat is one continuous piece of action at ONE location.
The beats have no timing yet - they are stretched onto the song later, so describe what happens, not how long it takes.

The song is ${Math.round(music.durationSec)} seconds long. The story is spread evenly over that time, in order from the first second to the last - the song sections do not matter for the beats, a beat does not belong to a verse or a chorus.
Aim for about ${beatCount} beats that follow the story from start to end, each one with new action - a beat never repeats what an earlier beat already showed.

For every beat give:
- "summary": what visibly happens, 1-3 sentences, present tense.
- "moments": 2-6 short sentences, in order, each one visible action that a camera can film. Name characters by their name, exactly as spelled and capitalized in the character list below (including a collective/group character like "Orcs" acting as one individual member of the group - still call them "Orcs", never a generic singular like "the orc"): that exact string is what later binds the sentence to that character's reference picture, so a paraphrase leaves the action unanchored and the wrong figure on screen ends up doing it. These are spread over the video clips of the beat, so together they must tell the whole beat. Describe the mechanics of any contact between two things, not just the outcome - the direction and path of the movement, what it meets and how, and the immediate physical reaction: not "Thorin raises his hammer and strikes the sealed gate." but "Thorin swings his hammer in a wide overhead arc, the head crashing into the gate's iron sigil, which cracks and showers sparks across the steps."
  This applies just as much to a gentle or supernatural contact as to a blow - never write a bare "touches" or "reaches for": say exactly which hand or body part makes contact with which part of the other, whether the grip closes and holds or just brushes past, and what the touched character does in direct response to THAT contact (recoils while still held, wrenches free, goes rigid, the touch passes through them) - not a generic, unrelated reaction like being shoved or knocked back unless something actually pushed them.
  A character's "prop" (if any is listed for them below) is the one weapon/tool/instrument they carry for the whole story - always call it by the same name and kind (a sword stays a sword, never a hammer or axe in a later beat) unless "stateAfter" explicitly says they traded, lost, dropped or picked up a different one.
  Say where people are in relation to one another in plain, exact words: beside, behind, in front of, at someone's left, an arm's length from. A person is never on, over or in another person ("stand on her shoulders" is one body standing on another and is drawn that way) unless the story says one carries, lifts or rides the other - for "next to the shoulder" write "beside her, at her shoulder".
  Bodies don't default to facing the camera: name which way a character is turned or moving relative to whoever or whatever they're reacting to (turns to face it, spins away, presses their back to the wall, ducks behind another character) whenever that's part of the action, especially the instant something touches, strikes at, or startles them.
  Eyes and attention follow the scene, not the lens: say what a character or creature is looking at (the person it's reaching for, the weapon coming at it, the ground as it falls) - never leave it staring into the camera, and never describe a "look" or "stare" without naming its target, since an untargeted one defaults to a straight-into-camera stare that breaks the scene.
  Faces react too: name the visible facial reaction the moment produces (jaw clenching, eyes widening, a grin, brows drawing together, a grimace) whenever the action calls for one - a beat with no facial reaction described tends to render with a flat, unchanging expression throughout.
  ${filmableRules}
- "locationId": exactly one of the location ids below.
- "characterIds": ids of the characters on screen, only from the list below.
- "intensity": 0.0 (calm, quiet) to 1.0 (climax), used to match the loudness of the music.
- "weight": 1-5, how much screen time the beat deserves.
- "kind": "establish" (introduces a place or character), "build" (tension rises), "hit" (a big moment for a musical accent), or "release" (tension falls).
- "continuous": true only if the beat is ONE unbroken take that runs through all its video clips without a cut - the camera and the action simply go on from clip to clip (a long walk through a room, a slow reveal, one action that takes many seconds). Use it sparingly: false (also when omitted) for a beat that is better cut together from several shots and angles.
- "stateAfter": short facts about real, physical things that are true after this beat and must stay visible later (never a figurative one like "the name is dull", and never what a mirror or reflection shows), e.g. "the hammer is broken", "the party carries a torch". Empty array if nothing changes.
- "groupSize": only for a group character below marked "isGroup" that is in this beat's "characterIds" - {"<that character's id>": <count>}, roughly how many distinct individuals of that group are visible together on screen during this beat (1 if only one of them is ever shown at a time here, more for a crowd/pack/band moment). Omit entirely if no group character is in this beat.
Whenever a beat brings the characters face to face with an antagonist, monster, spirit or other hostile presence, make it a real dramatic encounter, not a tableau: show fear (flinching, recoiling, shielding one another), active defense or combat (striking, blocking, being struck), or flight (breaking away, running, dragging a companion clear). Characters should not simply stand and stare at the threat. In combat, name the actual weapon each side is using in every strike (matching their "prop" where they have one) - don't let a sword turn into a hammer or an axe from one moment to the next.
${singing ? performanceRules(singing) : ''}
${singing && vocalsEnd ? `The singer${singing.singers.length > 1 ? 's sing' : ' sings'} on screen until ${formatTime(vocalsEnd)} of the ${formatTime(music.durationSec)} song and ${singing.singers.length > 1 ? 'are' : 'is'} visible, with the face to the camera, in every shot while singing. So nobody who sings leaves, vanishes, dies or is swallowed before ${formatTime(vocalsEnd)}: such an ending happens gradually while they keep singing, or only after the last vocal - the beats after that show the place without them.
` : ''}Answer only with JSON: {"beats": [...]}
---
characters: ${JSON.stringify(cast.characters.map(c => ({id: c.id, role: c.role, ...(c.prop ? {prop: c.prop} : {}), ...(c.isGroup ? {isGroup: true} : {})})))}
locations: ${JSON.stringify(cast.locations.map(l => l.id))}
lyrics:
${lyrics}
---
story:
${storyBase}`,
        instructions: 'You are a music video director who breaks stories into visual story beats. Answer only with JSON.',
    })

    const characterIds = new Set(cast.characters.map(c => c.id))
    const groupIds = new Set(cast.characters.filter(c => c.isGroup).map(c => c.id))
    const locationIds = cast.locations.map(l => l.id)
    return extracted.beats.map((beat, i) => {
        if (!locationIds.includes(beat.locationId)) {
            log.warn(`beat ${i + 1} uses unknown location "${beat.locationId}" - using ${locationIds[0]}`)
        }
        const beatCharacterIds = beat.characterIds.filter(id => characterIds.has(id))
        const groupSize = Object.fromEntries(
            Object.entries(beat.groupSize ?? {})
                .filter(([id]) => groupIds.has(id) && beatCharacterIds.includes(id))
                .map(([id, count]) => [id, Math.min(20, Math.max(1, Math.round(Number(count)) || 1))]),
        )
        return {
            ...beat,
            id: `beat-${String(i + 1).padStart(2, '0')}`,
            order: i + 1,
            locationId: locationIds.includes(beat.locationId) ? beat.locationId : locationIds[0]!,
            characterIds: beatCharacterIds,
            moments: beat.moments?.length ? beat.moments : [beat.summary],
            intensity: Math.min(1, Math.max(0, Number(beat.intensity) || 0.5)),
            weight: Math.max(1, Number(beat.weight) || 1),
            continuous: beat.continuous === true,
            stateAfter: beat.stateAfter ?? [],
            ...(Object.keys(groupSize).length ? {groupSize} : {}),
        }
    })
})
for (const beat of beats) {
    console.log(`   ${styles.name(beat.id)} ${styles.muted(`${beat.kind.padEnd(9)} ${energyBar(beat.intensity)} @${beat.locationId}${beat.lyricAnchor ? ` ♪${beat.lyricAnchor}` : ''}`)}`)
    console.log(`      ${beat.summary}`)
    for (const moment of beat.moments) console.log(styles.muted(`        · ${moment}`))
}

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
            looks.push(await ask(characterVariantLookPrompt(lookBrief, char, looks)))
        }
        variants[char.id] = looks
        if (char.prop) looks.forEach((look, i) => { if (propMissing(look, char.prop!)) log.warn(`${char.id} member ${i + 1}: the look does not show the prop "${char.prop}"`) })
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
            ...await Promise.all(looks.slice(1).map(look => ask(characterDescriptionPrompt(look)))),
        ]
    }
    return descriptions
})

////////// CUTTING THE SONG INTO CLIPS
// switched alignLyrics on or off since the timeline was built
if (project.data.timeline && (project.data.timeline.aligned ?? false) !== Boolean(lyricsTiming)) project.invalidate('timeline')
const timeline = await project.step('timeline', '10 · CUTTING THE SONG INTO CLIPS', async () => buildTimeline(music, lyricSections, maxClipSec, lyricsTiming))
log.step('Clips', `${timeline.slots.length} clips of ${timeline.barsPerSlot} bars (${(timeline.barsPerSlot * 240 / music.bpm).toFixed(1)}s) - max ${timeline.maxClipSec}s`)
if (timeline.aligned) {
    log.step('Sections', styles.muted('from the lyrics timing (estimate from the audio in brackets)'))
    timeline.sections.forEach((s, i) => {
        const estimate = music.sections[i]
        console.log(`   ${styles.name(s.label.padEnd(12))} ${formatTime(s.start, true)} – ${formatTime(s.end, true)} ${styles.muted(estimate ? `(${formatTime(estimate.start, true)} – ${formatTime(estimate.end, true)})` : '')}`)
    })
    log.step('Sung in clips', `${timeline.slots.filter(s => s.vocals?.length).length} of ${timeline.slots.length}`)
}

////////// MATCHING THE STORY TO THE MUSIC
const mapping = await project.step('mapping', '11 · MATCHING THE STORY TO THE MUSIC', async () => mapBeatsToSlots(beats, timeline.slots))
const beatById = new Map(beats.map(b => [b.id, b]))
for (const slot of timeline.slots) {
    const beat = beatById.get(mapping[slot.index]!.beatId)!
    console.log(`   ${styles.muted(`${formatTime(slot.start)}`)} ${slot.section.padEnd(12)} ${energyBar(slot.energy)} ${styles.name(beat.id)} ${styles.muted(energyBar(beat.intensity))}`)
}

////////// REFINING THE MOMENTS TO ONE PER SHOT
// beat.moments (2-6 sentences) is written before the beat's shot count is known, so a beat can end up covering far
// more shots than it has moments for - the old code just reused/repeated moments across shots (--legacy-moments
// still does). This step asks for exactly one distinct, progressing action per shot instead.
const beatProps = propActivity ? propActivityPerBeat({slots: timeline.slots, mapping, beats, characters: cast.characters}, propActivity) : undefined
const beatSinging = singingPerBeat({slots: timeline.slots, mapping, beats, singing})
// All beats in one call don't fit on a long song: thinking and ~100 shot sentences share max_output_tokens (see #91). So
// the beats are asked in blocks, one after the other. The cut is only ever between two beats - all clips of a scene
// belong to one beat, so everything that has to stay continuous is in one call - and a block sees the finished shots of
// the beat before it and the summary of the beat after it, so a scene change on a block boundary still connects.
const MOMENT_BLOCK_BEATS = 1
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
}
const shotMoments = args['legacy-moments'] ? undefined : await project.step('shotMoments', '11b · REFINING MOMENTS PER SHOT', async () => {
    const shotCounts = countShotsPerBeat({slots: timeline.slots, mapping, beats})
    type Beat = (typeof beats)[number]
    const askBlock = (block: Beat[], finished: { beat: Beat, plan: BeatShots } | undefined, after: Beat | undefined, problems: string[] = []) => askJson<{ moments: Record<string, unknown> }>({
        reasoning: 'medium',
        // thinking at medium easily takes 12k+ tokens on its own, the staged shots come on top
        maxTokens: 32768,
        input: `${problems.length ? `Your last answer had these problems - fix them:\n${problems.map(p => `- ${p}`).join('\n')}\n\n` : ''}For every story beat below, stage a shot list for a music video: exactly "shotsNeeded" shots, in order, each with one concrete visible action and the people in the picture, where they stand and how they move.

Rules:
- Each shot must show real physical progression from the one before it - never repeat, restate or merely rephrase the previous shot's action, and never describe the camera or a held/static moment.
- Whenever a beat brings the characters face to face with an antagonist, monster, spirit or other hostile presence, the shots must show a real dramatic encounter across the sequence: fear (flinching, recoiling, shielding one another), active defense or combat (striking, blocking, being struck), or flight (breaking away, running, dragging a companion clear) - not characters standing and staring.
- A shot naming only the outcome of contact between two things ("hits the dragon with a sword", "grabs the ledge") reads as flat and unconvincing on screen - describe the mechanics instead: the direction and path of the movement (a low arc from the left, an overhead swing, a lunge), what it meets and how (deflects off armored scales, cuts into flesh, is caught on a raised shield), and the immediate physical reaction (staggers back, sends sparks flying, the blade skids off and rebounds). Do this for every strike, grab, fall or collision a shot describes, not only in combat.
  Weak: "Kara hits the dragon with her sword."
  Strong: "Kara swings her sword in a low arc from the right, the blade skidding off the dragon's armored foreleg scales in a shower of sparks."
  Weak: "Tom grabs the ledge as he falls."
  Strong: "Tom's fingers close around the crumbling ledge, his body swinging hard into the cliff face as his grip catches him."
- The same applies to any gentler or non-physical contact (a hand on a shoulder, a ghost or spirit reaching for someone): never write a bare "touches" or "reaches for" - name the exact hand/body part and where it lands, whether the contact holds and grips or only brushes, and let the reaction follow logically from THAT contact (goes rigid under the grip, twists to break free, the hand passes through them like mist) rather than defaulting to an unrelated generic reaction such as being shoved or knocked back - only describe a push or shove when something in the shot actually pushes.
- "castProps" below lists each character's one fixed prop (weapon, tool or instrument), if they have one. That is the exact object they carry for the entire song - always call it by that same name and kind in every shot it appears in (a character's sword must stay a sword and never become a hammer, axe or spear in a later shot, and vice versa), unless the beat's "summary" or "moments" explicitly says they picked up, dropped, lost or swapped it.
- Characters don't default to facing the camera. When a shot is a reaction - to a threat, a touch, a strike, a sound - say which way the character's body and gaze turn relative to whatever they're reacting to (spins toward it, recoils with their back to the wall, turns away and shields their face, ducks behind another character) instead of leaving them front-on.
- Whoever or whatever a shot is about must be looking at something in the scene, never at the lens: name the target of every look or stare (the person they're threatening, the blade coming at them, the ground below) - an eye-line with no named target defaults to a dead-on stare into the camera, especially on a push-in, which reads as breaking the scene rather than being part of it.
- Name the visible facial reaction the shot's action produces (jaw clenching, eyes widening, a grin, brows drawing together, a grimace, a flicker of relief) whenever the moment calls for one - a shot with no facial reaction described tends to render with the same flat expression as every other shot of that character.
- Every shot is its own short, separately rendered clip - a shot never gets to finish an action in a later shot, even later shots of the same beat. So an action that travels somewhere (a weapon swing, a lunge, a breath or thrown object) must also land and resolve within THAT SAME shot's sentence - never end a shot on a motion that's still only underway ("swings his hammer, the head descending toward X" with no impact described) and leave the impact for the next shot to show, or it renders as the motion stalling and reversing instead of completing. Combine the wind-up and the result in one sentence when they belong together, the way the strong examples above already do.
- Any effect that crosses space to hit someone - a breath of fire, a thrown weapon, a spray of debris, a spell - must say which way it travels and that it lands on the character's front, and that character must be described as facing (or turning to face) where it came from. Never leave the relative facing of attacker and target unstated for this kind of hazard: unspecified, it can render as hitting the target's back or from an impossible angle.
- A beat with "continuous": true is one unbroken take: its shots follow each other without a cut, and a clip starts exactly on the last frame of the clip before. Every shot goes on from the exact state the one before ends in - same place, same people in the same positions, same camera subject - never a new angle, a new setting or a restart of the action.
- ${filmableRules} If the beat's "moments" or "summary" do that, replace it by the real action.
- Use the beat's "summary" and "moments" as the story to tell, but you are free to invent the intermediate physical action needed to fill every shot.
- Write only what a camera sees, in plain measures: "a step", "an arm's length", "close" - no inches or seconds, and no anatomy below the skin (muscles, throat, diaphragm, bones).
- Be compact, and write every fact once. "action" is what happens in the shot, between the people and with things, in at most two sentences - the mechanics and what it does to the other. "state" is only how a person stands, sits or holds things at the START, "frame" is only the picture - where in the frame, at what depth, sharp or soft, which way the body and the face are turned - and "motion" is only what that person's own body does that "action" has not already said (leave it "" if there is nothing), each a short phrase of at most about 12 words. Nothing in "state", "frame" or "motion" repeats "action", and "state" and "frame" agree on which way a person faces. Every named person has their own entry; only a crowd that the cast lists as one entry ("group": true) is one entry. "staging" 2-4 sentences.
- Stage before you shoot. Per beat, "staging" is the fixed floor plan of the place for this beat, 2-4 sentences: which features are on which side or wall, where the entrances are and where people come from, where each person or group stands when the beat starts and how far apart they are. It stays the same for every shot of the beat, and a beat in the same place as the one before keeps the layout of the one before. Nothing in it moves. Include nobody and nothing the story does not put there.
- A shot is about a few people. At most 4 people get an entry in "people" per shot - the ones the shot is about: who acts, who is struck, who is looked at, who answers. Everyone else of the beat who is visible is listed in "characters" without an entry (the rest of the line, the others behind) or is left out; only a wide or establishing shot lists more than 4 people in "characters". A march or a crowd of seven is staged through the few it is about, in the order of the file: who leads, who falls behind, who looks back.
- A fight of several against several is a melee, a scuffle in the whole place - not a duel with onlookers. Everybody of the beat who is in the picture is in it: whoever has no entry in "people" is named in "characters" and "rest" says in one or two sentences what all of them do at the same time, each against their own opponent and in their own way (one parries high and answers with the haft, one is shoved back and comes in again, one goes down on a knee and is helped up). Nobody of a fight stands, waits or watches unless the story says so; the same holds for a march, a ritual or any event the whole party takes part in - "rest" is what the others do in it.
- Every shot says who is in the picture ("characters", exactly as spelled in "cast") and, for each of them in "people": "state" - where they are and what they do, hold and wear at the START of the shot, as a phrase with a verb; "frame" - how they are in the picture: sharp or soft, where in the frame, which way the body and the gaze turn, in which part of the place ("sharp, left of centre, three-quarter view, looking at X"); "motion" - what moves during the shot, with its direction relative to the others, or that they stay where they are. The video model lets people walk and turn on its own, so for someone who talks, sings, plays or acts in place say that they stay; but where the story has people arrive, enter, follow, search or retreat, they move with it - "stays" and "follows" never describe the same person in one shot, "state" and "motion" agree. People are spread through the place and the frame at different depths and angles, each in their own relation to the others and to the place - never everybody in a row facing the lens. Everyone is somewhere definite, and a person is somewhere only once: nobody is in two places in one shot.
- Whatever the relation between two people is - hostile, tender, searching, arguing, comforting, ignoring - a shot says how far apart they are at the start and at the end, who looks at whom, who starts the move and what the other does in the same moment (steps back, leans in, turns away, answers with the eyes). Touch names the hand and where it lands; a search names what is searched and where; a feeling is shown by the body and the face, never by a word for it. Nobody just stands and faces the lens while the relation happens.
- Everything that happens between people, or between a person and a thing, is staged as choreography, whatever it is - a fight, a dance, a band playing together, a chase, a ritual, a meeting: each shot is one or two beats of it. Say who moves first, with what and how fast, where it lands, what the other does in the same moment, and what it does to the one it touches (the one who is hit gives way, falls, staggers or holds, according to how they were hit). The people move through the place - they close in, give ground, come from where the staging says - and do not stand still while the action happens off to the side.
- People are individuals, not a chorus line. Two people in one picture never do the same thing at the same moment: each has their own action, direction, height, target and timing - one starts, the next answers after the first one's move, another reacts to what was done (flinches, gives ground, takes the blow, hangs back, helps someone up), one is a step slower or faster. Never "they all raise", "they swing together", "in unison" or "in a staggered line" for people of a fight, a march or a search; unison is only for something the story itself does together (a chant, a drill) - and even then each has their own face, gesture or small difference. Different weapons and different builds move differently: use what each one carries and is.
- A cast entry with "group": true is a crowd in one entry, and the beat says how many of it are there ("groupSize"). Its entry says how it breaks up - at least three different things when it is four or more: who goes first, who hangs back, who is struck and how, who falls or turns, who goes where - so the crowd is never one body doing one thing, and it moves through the place from where the staging says.
- A fight is an exchange over its shots, not one blow: a blow lands and the shot goes on with what it does (the one hit gives way, the other answers, the first parries, someone comes in from the side) up to the next blow. No "hold at the peak" or "hold the pose" for a fight, and "hold": true is never a fight shot. After a clash the two sides do not stand side by side: one gives ground, falls, flees or is driven back, according to the story.
- A listener, a bystander or a band member who does not sing stays in the picture whenever the staging has them near the shot, doing something of their own (watching, playing, reacting) - and does not sing.
- When a singer sings in a shot ("singingPerShot" true), the singer is in "characters", the face and the mouth are clear in the frame (the face turned to the camera or in a three-quarter view, not hidden, not too small), and the camera is held or only breathes - no push-in toward the face. Whoever plays an instrument that is audible in the shot ("activePerShot" true) is in it with the instrument in their hands.
- "framing" is the shot size and angle ("wide shot", "medium close-up", "low-angle medium shot") - what can show everyone "characters" lists - and "camera" is one sentence with the movement and its speed (no times or durations in it - how long a shot is, is not yours to say). Every shot is a new camera position: no two in a row with the same movement, and "view" says where the camera stands and what it looks toward, in terms of the staging, on the same side of the action within one beat unless the story crosses it. "hold" is true for a shot in which nobody moves from where they are and the camera stays: the clip then keeps the framing from the first frame to the last.
- Name characters by their "name" from "cast" below (not pronouns, and never the "id" that "characterIds"/"castProps" use - it only says who is meant), so every shot reads on its own. Use the name exactly as spelled and capitalized in "cast" - this exact string is what binds the sentence to that character's reference picture later, so a paraphrase ("the orc", "an old woman", "a ghost") leaves the action unanchored to anyone and the wrong on-screen figure ends up performing it. This applies even to a collective/group character (e.g. a cast entry named "Orcs" fighting as several individuals) - still call them "Orcs" in the sentence, never a generic singular like "the orc" or "an orc warrior".
- A beat may list "props": for each entry, "activePerShot" gives one true/false flag per shot of that beat, in order, for whether that character's instrument is actually audible in the song at that point. On a shot where the flag is true, show that character actively using the prop - pick whatever action fits the instrument and the moment (playing, strumming, striking, etc.), your choice of words. On a shot where the flag is false, do not show them actively using it - they hold it still, rest it, set it down, or do something else with their hands instead. Characters with no "props" entry are unaffected by this rule.
- A beat may list "singing": "singerIds" are the characters whose voice is the song's vocals, and "singingPerShot" gives one true/false flag per shot of that beat for whether a lyric is actually sung at that point. A singer only sings on shots flagged true. On a shot flagged false they make no sound at all - no singing, crying out, calling, humming or "a voice that joins" - even if the beat's "summary" or "moments" say so (the music there is purely instrumental); show them doing something silent instead (listening, breathing, watching, reacting, standing ready). Characters with no "singing" entry are unaffected.

Answer only with JSON: {"moments": {"<beatId>": {"staging": "", "ends": {"<name>": "where they are and what they do and hold when the beat is over, a phrase with a verb"}, "shots": [{"action": "", "framing": "", "camera": "", "view": "", "hold": false, "characters": [""], "people": {"<name>": {"state": "", "frame": "", "motion": ""}}, "rest": ""}]}}}
- "ends": for every character of the beat. The next beat starts from it.
---
castProps: ${JSON.stringify(Object.fromEntries(cast.characters.filter(c => c.prop).map(c => [c.id, c.prop])))}
cast: ${JSON.stringify(cast.characters.map(c => ({id: c.id, name: c.name, ...(c.isGroup ? {group: true} : {})})))}
${finished ? `Already written - the staging and the end of the beat "${finished.beat.id}", which comes right before the first beat below (do not write it again): ${JSON.stringify({staging: finished.plan.staging, ends: finished.plan.ends, lastShot: finished.plan.shots.at(-1)})}
The first beat below follows directly after it: start from where it ends - where everyone stands, what they hold - unless it opens a new scene.
` : ''}${after ? `For orientation only - the beat after the last beat below ("${after.id}"): ${after.summary}
Let the last shot of the last beat below lead toward it, and write nothing for it.
` : ''}beats (write shots only for these):
${JSON.stringify(block.map(b => ({
            id: b.id, summary: b.summary, moments: b.moments, kind: b.kind, characterIds: b.characterIds, locationId: b.locationId,
            ...(isContinuous(b, config.continuity) ? {continuous: true} : {}),
            ...(b.groupSize && Object.keys(b.groupSize).length ? {groupSize: b.groupSize} : {}),
            shotsNeeded: shotCounts[b.id] ?? 1,
            ...(beatProps?.[b.id]?.length ? {props: beatProps[b.id]} : {}),
            ...(beatSinging[b.id] ? {singing: beatSinging[b.id]} : {}),
        })))}`,
        instructions: 'You are a music video director turning story beats into a shot list. Answer only with JSON.',
    })

    const blockCount = Math.ceil(beats.length / MOMENT_BLOCK_BEATS)
    const blockSize = Math.ceil(beats.length / blockCount) // evenly sized - never a last block with a single beat
    const result: Record<string, BeatShots> = {...plannedBefore}
    for (let from = 0; from < beats.length; from += blockSize) {
        const block = beats.slice(from, from + blockSize)
        if (block.every(b => result[b.id])) continue
        const before = beats[from - 1]
        const after = beats[from + blockSize]
        if (blockCount > 1) log.step(`Beats ${from / blockSize + 1}/${blockCount}`, styles.muted(`${block[0]!.id} - ${block.at(-1)!.id}`))
        const handover = before && result[before.id] ? {beat: before, plan: result[before.id]!} : undefined
        const read = (answer: Awaited<ReturnType<typeof askBlock>>) => block.map(beat => ({beat, read: readBeatPlan(answer.moments?.[beat.id], beat, cast.characters, shotCounts[beat.id] ?? 1, beatSinging[beat.id])}))
        // a long nested answer now and then has a bracket wrong that cannot be repaired: asked again, twice at most, then the beats of
        // the block fall back to the legacy spread (a warning says so) instead of the run failing after the blocks that worked
        let first: ReturnType<typeof read> | undefined
        for (let attempt = 1; attempt <= 3 && !first; attempt++) {
            try {
                first = read(await askBlock(block, handover, after))
            } catch (e) {
                log.warn(`the answer for ${block[0]!.id} - ${block.at(-1)!.id} is unusable (${e instanceof Error ? e.message : e})${attempt < 3 ? ' - asking again' : ' - these beats keep their beat moments'}`)
            }
        }
        if (!first) continue
        let reads = first
        // what can be counted (a name that is not in the cast, a singing shot without a singer, a shot that names someone it does not show) is asked once more
        const problems = reads.flatMap(r => (r.read?.problems ?? []).map(p => `${r.beat.id}, ${p}`))
        if (problems.length) {
            log.warn(`${problems.length} problem(s) in the staged shots - asking once more`)
            for (const p of problems) console.log(styles.muted(`        · ${p}`))
            const again = await askBlock(block, handover, after, problems).then(read, (e: unknown) => {
                log.warn(`the second answer is unusable (${e instanceof Error ? e.message : e}) - the first one stays`)
                return reads
            })
            reads = reads.map((r, n) => again[n]!.read && (!r.read || again[n]!.read!.problems.length <= r.read.problems.length) ? again[n]! : r)
            for (const r of reads) for (const p of r.read?.problems ?? []) log.warn(`${r.beat.id}, ${p}`)
        }
        // what the code repaired or only noted costs no further call - a line in the log, nothing else
        for (const r of reads) for (const note of r.read?.notes ?? []) console.log(styles.muted(`        · ${r.beat.id}, ${note}`))
        for (const {beat, read: r} of reads) if (r) result[beat.id] = r.plan // a beat without a plan falls back to the legacy spread
    }
    // the model keeps writing a blank oval for a photograph's missing face or a "blade-shaped object" for a name, whatever
    // the prompt says - those moments get one rewrite
    const risky = Object.entries(result).flatMap(([beatId, plan]) => plan.shots.flatMap((shot, j) => riskyMoment.test(shot.action) ? [{beatId, j, moment: shot.action}] : []))
    if (risky.length) {
        log.warn(`${risky.length} shot moment(s) with a blank face or a stand-in object - rewriting them`)
        const rewritten = await askJson<{ moments: string[] }>({
            input: `Rewrite each of these music video shot descriptions so that it follows the rules below. Keep everything else exactly as it is: the same people, place, camera, action, emotions and singing - only remove what breaks a rule, by leaving it out or by showing the real action instead.
${filmableRules}
Answer only with JSON: {"moments": ["rewritten 1", "rewritten 2", ...]} - exactly ${risky.length} entries, in the same order.
---
${JSON.stringify(risky.map(r => r.moment))}`,
            instructions: 'You are a music video director who corrects shot descriptions. Answer only with JSON.',
        })
        if (rewritten.moments?.length === risky.length) risky.forEach((r, k) => { result[r.beatId]!.shots[r.j] = {...result[r.beatId]!.shots[r.j]!, action: String(rewritten.moments[k])} })
        else log.warn('the rewrite did not come back with one entry per moment - the moments stay as they are')
    }
    return result
})
if (shotMoments) for (const beat of beats) {
    const plan = shotMoments[beat.id] && asBeatShots(shotMoments[beat.id]!)
    if (!plan) continue
    console.log(`   ${styles.name(beat.id)} ${styles.muted(`${plan.shots.length} shots`)}`)
    if (plan.staging) console.log(styles.muted(`        staging: ${plan.staging}`))
    const nameOf = (id: string) => cast.characters.find(c => c.id === id)?.name ?? id
    for (const shot of plan.shots) console.log(styles.muted(`        · ${shot.characters?.length ? `[${shot.characters.map(nameOf).join(', ')}] ` : ''}${shot.action}`))
}

////////// BUILDING THE MINIMAX H3 REQUESTS
// Deterministic from the data above, so it is rebuilt on every run instead of being cached
log.section('12 · BUILDING THE MINIMAX H3 REQUESTS')
const clips = buildClipRequests({
    slots: timeline.slots,
    mapping,
    beats,
    characters: cast.characters,
    locations: cast.locations,
    characterDescriptions,
    characterDescriptionVariants,
    locationDescriptions,
    lookBrief,
    music,
    language,
    singing,
    shotMoments,
    propActivity,
    stemsAvailable: Boolean(stems),
    continuity: config.continuity,
})

const outputDir = join(project.dir, 'output')
rmSync(outputDir, {recursive: true, force: true})
mkdirSync(join(outputDir, 'clips'), {recursive: true})
mkdirSync(join(outputDir, 'audio'), {recursive: true})

for (const clip of clips) {
    await Bun.write(join(outputDir, 'clips', `${clip.id}.json`), JSON.stringify(clip, null, 2))
    // one debug-listenable file per track, cut from its own stem to this clip's span - not what's actually
    // uploaded for rendering any more (lib/render.ts uploads and trims the whole stem itself), just handy to
    // hear exactly what a track covers
    for (const audio of clip.assets.audio) {
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

for (const clip of clips) {
    log.box(`${clip.id} · ${formatTime(clip.start)} – ${formatTime(clip.end)} · ${clip.section} · ${clip.beatId}`, clip.prompt)
}

////////// RENDERING WITH COMFYUI
if (render.has('images') || render.has('videos')) {
    const only = new Set(args.only.split(',').filter(Boolean))
    using renderer = new Renderer(project.id, project.dir, config, settings.comfy)
    log.section('13 · RENDERING WITH COMFYUI')
    log.step('Config', styles.muted(`seed ${config.seed}, images ${config.imageResolution} (${config.imageWorkflow}), video ${config.videoResolution} (${config.videoWorkflow})${config.sequenceSheets ? `, sequence sheets (${config.sequenceWorkflow})` : ''}`))
    log.step('Servers', `${settings.comfy.map(s => `${styles.name(s.name)} ${styles.muted(s.url)}`).join(', ')} ${from(settings.sources.comfy)}`)

    // everything at once - the renderer runs one job per server and queues the rest
    if (render.has('images')) {
        log.step('Pictures', `${pictures.length}${config.sequenceSheets ? styles.muted(' (multi-angle reference sheets)') : ''}`)
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
            }
            // a clip that goes on from the last frame of one of these starts on a picture that is gone
            const later = new Set<string>()
            for (const clip of selected) {
                for (let next = clips.find(c => c.startsFrom === clip.id); next; next = clips.find(c => c.startsFrom === next!.id)) if (!selected.includes(next)) later.add(next.id)
            }
            if (later.size) log.warn(`${[...later].join(', ')} start on the last frame of a clip rendered again and are not - render them again too (--again) if the picture should go on from the new one`)
        }
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
    const result = await assembleFinal({clips, projectDir: project.dir, songFile, songAudio: config.songAudio, target})
    log.step('Saved', `${target} ${styles.muted(`${result.width}x${result.height}, ${result.frames} frames, ${result.seconds.toFixed(3)}s`)}`)
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

// Runs of clips where each one starts on the last frame of the one before (ClipRequest.startsFrom), in song order
function clipChains(clips: ClipRequest[]): ClipRequest[][] {
    const chains: ClipRequest[][] = []
    for (const clip of clips) {
        const chain = clip.startsFrom ? chains.find(c => c.at(-1)!.id === clip.startsFrom) : undefined
        if (chain) chain.push(clip)
        else chains.push([clip])
    }
    return chains
}

/**
 * Runs all renders and lets the others finish when one fails - their jobs are on the servers already.
 * Throws afterwards if any failed.
 */
async function renderAll<T>(items: T[], renderOne: (item: T) => Promise<unknown>) {
    const results = await Promise.allSettled(items.map(renderOne))
    const errors = results.flatMap(r => r.status === 'rejected' ? [r.reason instanceof Error ? r.reason.message : String(r.reason)] : [])
    if (!errors.length) return
    // e.g. "no server reachable" arrives once per render
    const unique = [...new Set(errors)]
    if (unique.length === 1) throw new Error(errors.length > 1 ? `${unique[0]} (${errors.length} renders)` : unique[0])
    for (const error of unique) log.warn(error)
    throw new Error(`${errors.length} of ${items.length} renders failed - see the warnings above`)
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
        })
        singers = known(picked.singers)
        if (!singers.length) throw new Error(`The LLM picked no singer from the cast (${JSON.stringify(picked.singers)}) - run again, or name the singers in config.json`)
    } else {
        singers = [...new Set(wanted.flatMap(name => {
            const character = findCharacter(characters, name)
            if (!character) log.warn(`singers: "${name}" is not in the cast - ignored`)
            return character ? [character.id] : []
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
    })
    const byLine = new Map((assigned.lines ?? []).map(l => [l.line, known(l.singers).filter(id => singers.includes(id))]))
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
- their moments keep the face visible to the camera while they sing, e.g. "Thorin sings while forging the blade" - no turned-away or hidden faces, no masks or objects over the mouth.
`
}

function energyBar(value: number) {
    const filled = Math.round(value * 8)
    return styles.answer('█'.repeat(filled)) + styles.muted('░'.repeat(8 - filled))
}
