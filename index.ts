import {noProject} from './lib/usage.ts'
import {extraArgument} from './lib/command-schema.ts'
import {cli} from './lib/cli.ts'
import {toSlug} from './lib/slug.ts'
import {existsSync} from 'node:fs'
import {parseArgs} from 'node:util'
import {formatDuration, keepLogIn, log, runLogFile, runWarnings, setOutput, styles} from './lib/log.ts'
import {MUSIC_RENDER, readRunOptions, RUN_OPTIONS} from './lib/run-options.ts'
import {renderAndAssemble} from './lib/pipeline/render-music.ts'
import {dryRun, redoReasons} from './lib/pipeline/dry-run.ts'
import {buildRequests} from './lib/pipeline/requests.ts'
import {hearSong} from './lib/pipeline/song.ts'
import {planBeats} from './lib/pipeline/beats.ts'
import {planLook} from './lib/pipeline/look.ts'
import {planShots} from './lib/pipeline/plan-shots.ts'
import {chooseSingers} from './lib/pipeline/singers-choice.ts'
import {projectStatus} from './lib/status.ts'
import {keepTimingsIn, runTimings} from './lib/timings.ts'
import {ask, askJson, configureLlm} from './lib/llm.ts'
import {mkdirSync, readdirSync} from 'node:fs'
import {join} from 'node:path'
import {type Character, type Location, ProjectStore, type PropStem, STEP_NAMES, type StepName} from './lib/project.ts'
import {renderAll, unknownIds, warnFixedSeed} from './lib/batch.ts'
import {directionNotTaken} from './lib/direction/service.ts'
import {lockProject} from './lib/lock.ts'
import {beginRun} from './lib/run-record-view.ts'
import {separateInstrumentStems, stemActivity} from './lib/music.ts'
import {groupMemberId, pictureAsset} from './lib/compose.ts'
import {hasOwnAnchor, installOwnPicture, takeOwnDescription} from './lib/own-picture.ts'
import {namedPictures, type PictureJob, pinEditedPicture, putAwayPicture, Renderer} from './lib/render.ts'
import {languageName, loadProjectConfig} from './lib/config.ts'
import {sungLines} from './lib/lyrics.ts'
import {projectLyricSections} from './lib/music.ts'
import {archiveFiles, versionStamp} from './lib/archive.ts'
import {clipRequestsDir, clipRequestsIn} from './lib/previous-output.ts'
import {writeGallery} from './lib/gallery.ts'
import {EXPORT_FORMATS} from './lib/timeline-export.ts'
import {formatTime, MAX_CLIP_SEC, maxClipFor} from './lib/frames.ts'
import {loadSettings} from './lib/settings.ts'
import {type FilmStyle, pickStyle, shuffledStyles, stylesById} from './lib/styles.ts'
import {listProjects, projectExists, validProjectId} from './lib/project-setup.ts'
import * as clack from '@clack/prompts'
import {pictureProp, propMissing} from './lib/prop-check.ts'
import {projectInputs, songFileOf, readInputFile} from './lib/inputs.ts'
import {pictureEstimate} from './lib/render-state.ts'
import {reviewed} from './lib/review.ts'
import {stopAfter} from './lib/stages.ts'
import {applyLibraryText, castFromLibrary, copyKey} from './lib/casting.ts'
import {type LibraryAsset, libraryDir} from './lib/library.ts'
import {type AssetKind} from './lib/asset-import.ts'
import {dropBeatPlans} from './lib/project.ts'
import {castPrompt, songLyricsPrompt, songStylePrompt, storyPrompt, styleShortlistPrompt, summaryPrompt} from './lib/prompts.ts'
import {messageOf} from './lib/text.ts'
import {castProps, propPictureJob} from './lib/props.ts'
cli('plan')

// any step's rejected promise (everything here is awaited, so a thrown Error from deep in the pipeline surfaces
// as one of these) gets the same tidy red box as a bad --flag, instead of Bun's raw stack-trace dump

// bun index.ts [project-id] [--redo=story,beats] [--render=song,images,videos,final|all] [--only=slot-001,slot-002]
//              [--llm-url=…] [--llm-key=…] [--llm-model=…] [--comfy=http://a:8188,http://b:8188] [--legacy-moments] [--debug-audio]  (this run only)
const usage = `bun index.ts [project-id] [--redo=story,beats] [--render=song,images,videos,final|all] [--only=slot-001,slot-002] [--again] [--preview] [--retake=slot-007:3.2-5.0]
             [--llm-url=…] [--llm-key=…] [--llm-model=…] [--llm-parallel=2] [--comfy=http://a:8188,http://b:8188] [--legacy-moments] [--debug-audio]
             [--refresh=pictures,clips] [--beats=beat-05,beat-07] [--strict] [--debug] [--review] [--until=story|cast|look] [--dry-run [--json]] [-v|--verbose] [--show=story,cast,clips]   (--debug: the stack trace of a failure · --review: stop after story, cast, look and beats to accept, edit or redo them · --until: plan up to this stage and stop, the next run goes on from it · --dry-run: what the run would redo and render, nothing is done · -v: every detail as before · --show: the details of these cached steps, clips = the prompts · --refresh: render stale ones again, the old ones are kept · --strict: the final video needs every clip to be current)
bun index.ts [project-id] --export=mlt,openshot|all   (writes timeline.mlt for Shotcut/Kdenlive and/or timeline.osp for OpenShot: the rendered clips on one track, the song under them)
bun index.ts [project-id] --gallery   (writes <project>/gallery.html, an overview of the assets generated so far - runs nothing else)`
const {values: args, positionals} = (() => {
    try {
        return parseArgs({
            args: Bun.argv.slice(2),
            allowPositionals: true,
            options: {
                ...RUN_OPTIONS,
                redo: {type: 'string', default: ''},
                beats: {type: 'string', default: ''},
                'llm-url': {type: 'string'},
                'llm-key': {type: 'string'},
                'llm-model': {type: 'string'},
                'llm-parallel': {type: 'string'},
                comfy: {type: 'string'},
                // skips step 11b and spreads/reuses beat.moments across shots the old way - a fallback while 11b is new
                'legacy-moments': {type: 'boolean', default: false},
                'debug-audio': {type: 'boolean', default: false},
                // read by failRun (lib/log.ts) from the raw arguments - declared here so parseArgs accepts it
                debug: {type: 'boolean', default: false},
                gallery: {type: 'boolean', default: false},
                export: {type: 'string', default: ''},
                // the terminal shows a cached step as one line; -v everything, --show=story,clips the details of those
                verbose: {type: 'boolean', short: 'v', default: false},
                show: {type: 'string', default: ''},
            },
        })
    } catch (e) {
        return log.usageError(e instanceof Error ? e.message : String(e), usage)
    }
})()
// a word more than it takes is said before any work (#938)
const extra = extraArgument(positionals, ['a project id'])
if (extra) log.usageError(extra, usage)
setOutput({verbose: undefined, show: args.show.split(',').filter(Boolean)})
// the options of a run both pipelines take (lib/run-options.ts) - "song" is never part of --render=all, it has to be asked for
const {
    render,
    refresh: refreshKinds,
    retake,
    until,
} = (() => {
    try {
        return readRunOptions(args, MUSIC_RENDER, !!(process.stdin.isTTY && process.stdout.isTTY), positionals[0])
    } catch (e) {
        return log.usageError((e as Error).message, usage)
    }
})()
if (until && ([...render].some(r => r !== 'images') || args.retake || args.gallery || args.export || args['dry-run']))
    log.usageError(
        '--until plans up to a stage and stops - it goes with no --render (but --render=images with --until=look), --retake, --gallery, --export or --dry-run',
        usage,
    )
// the pictures of the cast and the places are there once the look is: rendered before the shots are planned (#540)
if (until && render.has('images') && until !== 'look')
    log.usageError('--until with --render=images is --until=look: the pictures are made from the look', usage)
const exportFormats = [
    ...new Set(
        args.export
            .split(',')
            .filter(Boolean)
            .flatMap(f => (f === 'all' ? [...EXPORT_FORMATS] : [f])),
    ),
]
const unknownFormats = exportFormats.filter(f => !(EXPORT_FORMATS as readonly string[]).includes(f))
if (unknownFormats.length) log.usageError(`--export: unknown "${unknownFormats.join(', ')}" - use ${EXPORT_FORMATS.join(', ')} or all`, usage)
const redoSteps = args.redo.split(',').filter(Boolean) as StepName[]
const unknownRedo = redoSteps.filter(s => !(STEP_NAMES as string[]).includes(s))
if (unknownRedo.length) log.usageError(`--redo: unknown step "${unknownRedo.join(', ')}" - use ${STEP_NAMES.join(', ')}`, usage)
// --beats=beat-05,beat-07 with --redo=shotMoments: only these beats are planned again, on the floor plans they have; the
// shots of the others (and the clips rendered from them) stay (#762)
const replanBeats = [...new Set(args.beats.split(',').filter(Boolean))]
if (replanBeats.length && !redoSteps.includes('shotMoments'))
    log.usageError('--beats goes with --redo=shotMoments: it names the beats whose shots are planned again', usage)
// without an id: the projects to pick from in a terminal, else the list of them in the usage error
const projectId = positionals[0] ?? (await pickProject())
if (!validProjectId(projectId))
    log.usageError(
        `"${projectId}" is not a project id - lowercase letters, digits and "-" only (it is the folder name in projects/ and part of the ComfyUI client id)`,
        usage,
    )
if (!projectExists(projectId)) {
    const existing = listProjects()
    log.usageError(noProject('project', projectId, existing), usage)
}
const project = new ProjectStore(projectId)
// before the load: a run that writes works from the state it read, so no other run may save in between
// --dry-run only reads: no lock, nothing saved
// a clip or picture that is not there is said now - before the run is begun, so a typo is no failed run - not after every cached step was replayed (#818). A run that plans again
// (--redo) can make other clips: the render checks them then
if (!redoSteps.length && (args.only || retake)) {
    const wrong = await unknownIds(project.dir, join(project.dir, 'output', 'assets.json'), {
        only: args.only.split(',').filter(Boolean),
        retake: retake?.clip,
        pictures: render.has('images'),
        clips: render.has('videos') || render.has('final'),
    })
    if (wrong) log.usageError(wrong, usage)
}
if (!args.gallery && !args['dry-run']) lockProject(project.dir, `project ${project.id}`)
await project.load()
if (!args['dry-run']) keepTimingsIn(project.dir)
// everything this run prints, also into the project (the terminal may show less of it) - not for a run that only reads
if (!args.gallery && !args['dry-run']) {
    keepLogIn(join(project.dir, 'logs', `${versionStamp()}.log`))
    beginRun(project.dir, 'index.ts')
}
if (args.gallery) {
    if (!existsSync(project.dir)) throw new Error(`No project "${project.id}" in projects/`)
    const {file, counts} = await writeGallery(project.dir, project.id, project.data)
    log.step(
        'Gallery',
        `${file} ${styles.muted(
            Object.entries(counts)
                .map(([tab, n]) => `${tab}: ${n}`)
                .join(' · '),
        )}`,
    )
    process.exit(0)
}
// a dry run only says what would be redone (see dryRun below)
if (replanBeats.length) {
    const known = new Set((project.data.beats ?? []).map(b => b.id))
    const unknown = replanBeats.filter(id => !known.has(id))
    if (unknown.length)
        log.usageError(
            known.size
                ? `--beats: no beat "${unknown.join(', ')}" - the beats are ${[...known].join(', ')}`
                : '--beats: the project has no beats yet - plan it first',
            usage,
        )
}
// the steps named, but with --beats not shotMoments as a whole: just the shot plans of those beats go
const redoWhole = replanBeats.length ? redoSteps.filter(step => step !== 'shotMoments') : redoSteps

const toId = toSlug
const readInput = (name: string) => readInputFile(project.input(name))
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
// a continuing clip with context frames is rendered longer at its head - the clips are planned that much shorter (maxClipFor)
const maxClipSec = maxClipFor(MAX_CLIP_SEC, config.contextFrames, config.continuity)
const timelineOutdated = project.data.timeline !== undefined && project.data.timeline.maxClipSec !== maxClipSec
// --beats keeps the other beats' shots: a run that plans every shot again anyway (a changed setting or input, --redo of a step
// before the shots) is stopped before it changes anything, with the reason - it would not do what was asked (#762)
if (replanBeats.length && project.data.shotMoments) {
    const reasons = await redoReasons({project, config, readInput, redoWhole, timelineOutdated})
    const sweeping = reasons.filter(([, steps]) => project.redoneBy(steps).includes('shotMoments')).map(([why]) => why)
    if (sweeping.length)
        log.usageError(
            `--beats cannot keep the other beats: ${sweeping.join(', ')} - that plans the shots of every beat again. ` +
                'Undo that change (e.g. set "continuity" in config.json back to what the project was planned with), or plan every beat again without --beats.',
            usage,
        )
}
if (!args['dry-run']) {
    for (const step of redoWhole) project.invalidate(step)
    if (timelineOutdated) project.invalidate('timeline')
    if (replanBeats.length && project.data.shotMoments) {
        dropBeatPlans(project.data, replanBeats)
        log.step('Redo', `${styles.name('shotMoments')} ${styles.muted(`of ${replanBeats.join(', ')}`)}`)
    }
}
const settings = await loadSettings({
    projectModel: config.llm.model,
    llmUrl: args['llm-url'],
    llmApiKey: args['llm-key'],
    llmModel: args['llm-model'],
    llmParallel: args['llm-parallel'],
    comfy: args.comfy,
})
configureLlm(settings.llm)
// your own picture as the anchor: its description first - the clips and its sheet are planned from it (lib/own-picture.ts)
if (args['picture-anchor'] && !args['dry-run']) {
    if (!existsSync(args['picture-anchor'])) log.usageError(`--picture-anchor: no file ${args['picture-anchor']}`, usage)
    await takeOwnDescription(project.data, () => project.save(), args.only, {
        text: args['picture-description'] ? await Bun.file(args['picture-description']).text() : undefined,
        describeFrom: args['describe-picture'] ? args['picture-anchor'] : undefined,
    })
}
// where a setting comes from: (settings), (project), (env), (flag), (default)
const from = (source: string) => styles.muted(`(${source === 'file' ? 'settings' : source})`)
// the model itself is checked on the first LLM call - a fully cached project needs no server
log.step(
    'LLM',
    settings.llm.url
        ? `${settings.llm.url} ${from(settings.sources.llmUrl)} · ${settings.llm.model ? `${styles.name(settings.llm.model)} ${from(settings.sources.llmModel)}` : styles.muted('the only model on the server')}`
        : styles.muted('none configured - fine while every step is cached, else run: bun run setup llm'),
)
if (args['dry-run']) {
    await dryRun({project, config, readInput, redoWhole, timelineOutdated, settings, args, render, refreshKinds, replanBeats})
    process.exit(0)
}
const language = languageName(config.lyricsLanguage)!
// --render=song always writes wav (see Renderer.renderSong); a hand-supplied song can be wav, mp3 or flac
const generatedSongFile = project.input('song.wav')

////////// WRITING & GENERATING THE SONG - only with --render=song
const idea = await readInput('idea.txt')
const musicStyleInput = await readInput('music-style.txt')
const lyricsBeforeSong = await readInput('lyrics.txt')
if (render.has('song')) {
    // lyrics of your own are set to music as they are - an idea is only needed to have the LLM write them
    if (!idea && !lyricsBeforeSong) throw new Error('--render=song needs a song idea in input/idea.txt or lyrics of your own in input/lyrics.txt')

    // A hand-edit (or a deletion) of idea.txt/music-style.txt/lyrics.txt or a new singerVoice since the last run needs a
    // new style this run already - read-only, so the fingerprints it compares against are only recorded once, by the main
    // syncInputs() call further down, once this run's final lyrics.txt content is known.
    if (
        inputChangedSinceLastRun('idea.txt', idea) ||
        inputChangedSinceLastRun('music-style.txt', musicStyleInput) ||
        inputChangedSinceLastRun('lyrics.txt', lyricsBeforeSong) ||
        inputChangedSinceLastRun('singerVoice', config.singerVoice)
    ) {
        project.invalidate('songStyle')
    }

    // LYRICS - generated once from idea.txt; once lyrics.txt exists it's a plain input like story-idea.txt, never
    // auto-rewritten - delete it (or hand-correct it) to get it touched again.
    const lyricsExisted = existsSync(project.input('lyrics.txt'))
    if (!lyricsExisted) {
        log.section('1 · WRITING THE LYRICS')
        const generatedLyrics = await ask(songLyricsPrompt(idea, language, config.songDuration === -1 ? undefined : config.songDuration, config.singerVoice))
        log.box('Lyrics', generatedLyrics)
        await Bun.write(project.input('lyrics.txt'), generatedLyrics)
        project.invalidate('songStyle') // fresh lyrics need a style written to match them
    }
    const songLyrics = await readInput('lyrics.txt')

    // STYLE - redone whenever the lyrics or music-style.txt changed since the style currently cached was written
    const styleWasCached = project.data.songStyle !== undefined
    const songStyle = await project.step('songStyle', '1a · WRITING THE MUSICAL STYLE', () =>
        ask(songStylePrompt(songLyrics, musicStyleInput, language, config.singerVoice)),
    )
    log.box('Style', songStyle)
    if (!existsSync(project.input('music-style.txt'))) await Bun.write(project.input('music-style.txt'), songStyle)

    // AUDIO - only rendered again if the lyrics or the style actually changed this run, or there is none yet
    if (lyricsExisted && styleWasCached && existsSync(generatedSongFile)) {
        log.step('Song', styles.muted('input/song.wav is up to date - delete lyrics.txt, edit music-style.txt, or --redo=songStyle, to generate a new one'))
    } else {
        log.section('1b · GENERATING THE SONG AUDIO')
        if (existsSync(generatedSongFile)) {
            archiveFiles(project.dir, `song-${versionStamp()}`, ['input/song.wav'])
            log.step('Redo', styles.muted('song.wav - the lyrics or style changed'))
        }
        using songRenderer = new Renderer(project.id, project.dir, config, settings.comfy)
        await songRenderer.renderSong({style: songStyle, lyrics: songLyrics}, generatedSongFile)
    }
}

// the song a user supplies by hand can be song.wav, song.mp3 or song.flac in input/ - a generated one (above) is always wav
const songFile = songFileOf(project.dir)

// re-read: the song block above may have just written lyrics.txt/music-style.txt for the first time
const lyrics = await readInput('lyrics.txt')
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
            const shortlist = await askJson<{styles: string[]}>(styleShortlistPrompt(storyText, shuffledStyles(), 5))
            candidates = stylesById(shortlist.styles)
        } catch (e) {
            log.step('Style', styles.muted(`no shortlist from the LLM (${messageOf(e)}) - picking from the whole list`))
        }
    }
    const picked = pickStyle(candidates.length ? candidates : undefined)
    style = picked.text
    await Bun.write(project.input('style.txt'), style)
    log.step(
        'Picked style',
        `${styles.name(picked.name)} ${styles.muted(`${candidates.length ? `- one of: ${candidates.map(c => c.name).join(', ')} ` : ''}- written to input/style.txt, edit or replace it to change the look`)}`,
    )
}
const lyricSections = projectLyricSections(
    lyrics,
    project.data.music?.sections.map(s => s.label),
)
log.step('Lyrics', lyrics ? styles.muted(`${lyricSections.length} sections: ${lyricSections.map(s => s.label).join(' · ')}`) : styles.muted('(none)'))
log.step('Story idea', storyIdea || styles.muted('(none)'))
log.step('Style', style || styles.muted('(none - the look is designed from the story)'))
log.step('Max clip length', `${maxClipSec}s`)
log.step(
    'Mode',
    config.singers.length
        ? `performance - ${config.singers[0] === 'auto' ? 'the LLM picks the singer' : `${config.singers.join(', ')} sing${config.singers.length > 1 ? '' : 's'}`} (${language})`
        : `clip - the song is the soundtrack${config.alignLyrics ? ', lyrics aligned' : ''} ${styles.muted('(set "singers" in config.json to let characters sing)')}`,
)
if (config.alignLyrics && sungLines(lyricSections).length === 0)
    throw new Error('Aligning the lyrics needs sung lines in input/lyrics.txt - without lyrics, remove "singers" from config.json (clip mode)')
if (!lyrics && !storyIdea) throw new Error('Neither lyrics nor a story idea given - add input/lyrics.txt or input/story-idea.txt')
// a run that renders clips stops for direction not taken yet - at the start, not after the planning (#801): the clips would be
// rendered without it. A run that only plans builds the prompts without it and says so
if (render.has('videos') && project.data.shotMoments) {
    const open = directionNotTaken({id: project.id, dir: project.dir, kind: 'music'}, project.data)
    if (open.length)
        throw new Error(
            `Direction needs review before clips are rendered: preview and take ${open.length === 1 ? 'this instruction' : `these ${open.length} instructions`} on the Direction page (bun run direction ${project.id} --preview, then --take), or remove ${open.length === 1 ? 'it' : 'them'}:\n${open.map(line => `  - ${line}`).join('\n')}`,
        )
}

// an edited input redoes the steps built on it - the inputs and the steps they redo are listed in lib/inputs.ts
await project.syncInputs(await projectInputs(project.dir, config))
// the sections are named after the lyrics tags
if (project.data.music && lyricSections.length && project.data.music.sections.map(s => s.label).join('|') !== lyricSections.map(s => s.label).join('|')) {
    project.invalidate('music')
}
if (project.data.stems && Object.values(project.data.stems).some(file => !existsSync(join(project.dir, file)))) project.invalidate('stems')
if (project.data.instrumentStems && Object.values(project.data.instrumentStems).some(file => !existsSync(join(project.dir, file))))
    project.invalidate('instrumentStems')

// the song heard: its sections and energy, the stems, the lyrics aligned to the vocals (lib/pipeline/song.ts)
const {music, stems, lyricsTiming} = await hearSong({project, projectId, config, songFile, lyrics, lyricSections, language, idea})

////////// CRAFT A STORY FOR THE LYRICS
const storyBase = await reviewed(
    project,
    args.review,
    'story',
    () => project.step('story', '3 · CRAFTING THE STORY', () => ask(storyPrompt(lyrics, storyIdea, config.singerVoice))),
    story => log.box('Story', story),
)
if (storyBase === 'NO STORY') throw new Error('Neither lyrics nor a story idea given')

////////// SUMMARIZE THE STORY
const storySummary = await project.step('summary', '4 · SUMMARIZING THE STORY', () => ask(summaryPrompt(storyBase)))
log.box('Summary', storySummary)
stopAfter(until, 'story', project.file, `bun index.ts ${projectId}`)

////////// EXTRACT LOCATIONS AND CHARACTERS
const cast = await reviewed(
    project,
    args.review,
    'cast',
    () =>
        project.step('cast', '5 · EXTRACTING CHARACTERS & LOCATIONS', async () => {
            const extracted = await askJson<{
                characters: (Omit<Character, 'id' | 'propCarried'> & {propStem?: string; propCarried?: boolean})[]
                locations: Omit<Location, 'id'>[]
            }>(castPrompt(storyBase, config.singerVoice))
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
            const placeOf = (name: string | undefined) =>
                locations.find(l => l.name === name || l.id === toId(name ?? ''))?.id ?? (locations.length === 1 ? locations[0]!.id : undefined)
            return {
                // "A B" and "A-B" give the same slug: a second one gets its own id instead of overwriting the first one's look
                characters: extracted.characters.map(c => ({
                    id: uniqueId(toId(c.name), takenCharacters),
                    name: c.name,
                    role: c.role,
                    ...(c.isGroup === true ? {isGroup: true} : {}),
                    ...(c.isGroup === true && c.alike === true ? {alike: true} : {}),
                    // only when it is not hands - a project planned before keeps hands for everybody
                    ...(c.hands?.trim() && c.hands.trim().toLowerCase() !== 'hands' ? {hands: c.hands.trim()} : {}),
                    ...(c.prop ? {prop: c.prop} : {}),
                    ...(c.prop && c.propStem && stemNames.has(c.propStem) ? {propStem: c.propStem as PropStem} : {}),
                    ...(c.prop && c.propCarried === false
                        ? {
                              propCarried: false as const,
                              ...(c.propInHand ? {propInHand: c.propInHand} : {}),
                              ...(placeOf(c.propPlace) ? {propPlace: placeOf(c.propPlace)} : {}),
                          }
                        : {}),
                })),
                locations,
            }
        }),
    cast => {
        log.step('Characters', styles.muted(`(${cast.characters.length})`))
        for (const c of cast.characters)
            log.line(
                `   ${styles.name(c.id)} ${styles.muted('—')} ${c.role}${c.prop ? styles.muted(` · ${c.prop}${c.propStem ? ` (${c.propStem})` : ''}${c.propCarried === false ? ` - stands in ${c.propPlace ?? '?'}${c.propInHand ? `, in hand: ${c.propInHand}` : ''}` : ''}`) : ''}`,
            )
        log.step('Locations', styles.muted(`(${cast.locations.length})`))
        for (const l of cast.locations) log.line(`   ${styles.name(l.id)}`)
    },
)

////////// CASTING - who plays each role and which picture each place has: the project's own or a library asset
// (casting.json, written once here and then only read - lib/casting.ts). A library asset is copied into the project, so
// the project stays complete without the library; its texts stand in for the look and description steps below.
const casting = await castFromLibrary({
    dir: project.dir,
    cast,
    library: await libraryDir(),
    copies: project.data.castingCopies,
    again: kind =>
        `its look and description were the library's: bun index.ts ${projectId} --redo=${kind === 'character' ? 'characterLooks' : 'locationLooks'} makes them anew`,
})
const castLibrary = casting.assets
const casted = (kind: AssetKind, id: string) => castLibrary.get(copyKey(kind, id))
{
    if (Object.keys(casting.copies).length) project.data.castingCopies = casting.copies
    else delete project.data.castingCopies
    if (casting.changed) await project.save()
    // the picture fits the role? the prop the role has is named in the asset's description
    for (const entry of casting.entries.filter(e => e.kind === 'character')) {
        const role = cast.characters.find(c => c.id === entry.id)!
        const shown = config.propPictures ? undefined : pictureProp(role)
        if (shown && propMissing(casted('character', entry.id)!.description, shown))
            log.warn(`${entry.id}: library:${entry.libraryId} does not name the role's prop "${shown}" - the clips may show the picture's prop, or none`)
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
        if (applyLibraryText(values, id, value)) castChanged.add(step)
    }
}

////////// THE PROPS AS THINGS OF THEIR OWN - config.propPictures: each character's prop gets a picture, laid into the clips its owner
// is in (#944). Built by code from the cast's prop words, no question to the language model
const props =
    config.propPictures && cast.characters.some(c => c.prop) ? await project.step('props', '5d · NAMING THE PROPS', async () => castProps(cast.characters)) : {}
for (const [owner, prop] of Object.entries(props))
    log.step(prop.id, styles.muted(`${prop.description} - of ${cast.characters.find(c => c.id === owner)?.name ?? owner}`))

////////// DETECTING INSTRUMENT ACTIVITY - band scenes only: needs stems and at least one character with a propStem
const neededStems = [...new Set(cast.characters.map(c => c.propStem).filter((s): s is PropStem => Boolean(s)))]
const neededInstrumentStems = neededStems.filter((s): s is 'guitar' | 'piano' => s === 'guitar' || s === 'piano')

// guitar/piano come with the stems since every song is separated into six - a project separated before has only the four
// htdemucs_ft ones, and a second, narrower htdemucs_6s pass gets just those two, on top of (never overwriting) the others
const instrumentStems =
    stems && neededInstrumentStems.length && neededInstrumentStems.some(name => !stems[name])
        ? await project.step('instrumentStems', '5a · SEPARATING GUITAR/PIANO', async () => {
              log.step('Separating', styles.muted(`${songFile} with demucs htdemucs_6s (${neededInstrumentStems.join(', ')} only)`))
              return separateInstrumentStems(songFile, project.dir, neededInstrumentStems)
          })
        : undefined
if (instrumentStems) log.step('Stems', styles.muted(Object.values(instrumentStems).join(' · ')))

const allStems = {...stems, ...instrumentStems}
// every stem's absolute path, plus a "song" fallback (the whole, unseparated song) for the clip-mode anchor
// track lib/compose.ts falls back to when stemsAvailable is false (see buildClipRequests below)
const stemFiles: Record<string, string> = {
    ...Object.fromEntries(Object.entries(allStems).map(([stem, file]) => [stem, join(project.dir, file)])),
    song: songFile,
}
const propActivity =
    stems && neededStems.length
        ? await project.step('propActivity', '5c · DETECTING INSTRUMENT ACTIVITY', async () => {
              const result: NonNullable<typeof project.data.propActivity> = {}
              for (const stemName of neededStems) {
                  const stemFile = allStems[stemName]
                  if (!stemFile) continue
                  log.step('Analyzing', styles.muted(stemFile))
                  result[stemName] = await stemActivity(join(project.dir, stemFile), music.bpm)
              }
              return result
          })
        : undefined
if (propActivity)
    for (const [stemName, ranges] of Object.entries(propActivity))
        log.step(
            'Activity',
            styles.muted(`${stemName}: ${ranges!.length} range(s), ${ranges!.reduce((sum, r) => sum + r.end - r.start, 0).toFixed(0)} s active`),
        )
else if (neededStems.length)
    log.warn(
        `${neededStems.length} character(s) have an audible instrument prop, but stems weren't separated (set "alignLyrics": true in config.json) - instruments will be shown playing throughout`,
    )

////////// CHOOSING THE SINGERS - performance mode only
const singing = config.singers.length
    ? await project.step('singing', '5b · CHOOSING THE SINGERS', () => chooseSingers(config.singers, {cast, config, lyricSections, lyrics, storySummary}))
    : undefined
if (singing) {
    const nameOf = (id: string) => cast.characters.find(c => c.id === id)?.name ?? id
    log.step('Singers', singing.singers.map(id => styles.name(nameOf(id))).join(', '))
    if (singing.singers.length > 1) {
        for (const line of singing.lines)
            log.line(
                `   ${styles.muted(
                    line.singers
                        .map(nameOf)
                        .join(line.parts ? ' / ' : ' + ')
                        .padEnd(24),
                )} ${line.text}`,
            )
    }
}

stopAfter(until, 'cast', project.file, `bun index.ts ${projectId}`)

// the look of the whole, of the cast and of the places (lib/pipeline/look.ts)
const {lookBrief, characterLooks, characterDescriptions, locationLooks, locationDescriptions, locationAnchors, locationLayouts} = await planLook({
    project,
    projectId,
    args,
    style,
    storySummary,
    cast,
    casted,
    castChanged,
    castTexts,
    propPictures: config.propPictures,
})

/**
 * The pictures the requests expect, with the Krea 2 prompt to generate each one - a group character (memberCounts[c.id] > 1)
 * gets one job per member instead of one shared job, see groupMemberId. Before the beats nobody counts as a group of several.
 */
function pictureJobs(
    memberCounts: Record<string, number>,
    lookVariants: Record<string, string[]>,
    descriptionVariants: Record<string, string[]>,
): PictureJob[] {
    return [
        ...cast.locations.map(l => ({
            kind: 'location' as const,
            id: l.id,
            file: pictureAsset('location', l.id),
            name: l.name,
            prompt: locationLooks[l.id] ?? '',
            description: locationDescriptions[l.id] ?? '',
        })),
        ...cast.characters.flatMap(c => {
            const count = memberCounts[c.id] ?? 1
            const looks = lookVariants[c.id] ?? [characterLooks[c.id] ?? '']
            const descriptions = descriptionVariants[c.id] ?? [characterDescriptions[c.id] ?? '']
            return Array.from({length: count}, (_, i) => {
                const id = count > 1 ? groupMemberId(c.id, i) : c.id
                return {
                    kind: 'character' as const,
                    id,
                    file: pictureAsset('character', id),
                    name: c.name,
                    prompt: looks[i] ?? looks[0] ?? '',
                    description: descriptions[i] ?? descriptions[0] ?? '',
                }
            })
        }),
        // config.propPictures: one plain picture per prop, no sheet (#944)
        ...Object.values(props).map(propPictureJob),
    ]
}

/** --render=images: the pictures named in --only (all without it), again with --again, from an edited prompt with --picture-prompt. */
async function renderPictures(renderer: Renderer, pictures: PictureJob[]) {
    const only = new Set(args.only.split(',').filter(Boolean))
    log.step('Pictures', `${pictures.length}${config.sequenceSheets ? styles.muted(' (multi-angle reference sheets)') : ''}`)
    const named = namedPictures(pictures, only, args.again && !render.has('videos'))
    // an edited prompt: this one picture, from these words, kept as it is from then on
    const edited = args['picture-prompt'] ? await Bun.file(args['picture-prompt']).text() : undefined
    if (edited !== undefined && named.length !== 1) throw new Error('--picture-prompt goes with one picture in --only')
    const chosen = edited === undefined ? named : named.map(p => ({...p, prompt: edited}))
    if (args.again && (only.size === 0 || pictures.some(p => only.has(p.id)))) {
        warnFixedSeed(config.seed)
        // a new anchor for an edited prompt - but the user's own anchor stays, its prompt is a note (lib/own-picture.ts)
        const newAnchor = (picture: PictureJob) =>
            args['new-anchor'] || !!args['picture-anchor'] || (edited !== undefined && !hasOwnAnchor(picture, project.dir, config.sequenceSheets))
        for (const picture of chosen)
            log.step('Again', `${picture.id} ${styles.muted(`- the old one is in ${putAwayPicture(picture, project.dir, config, newAnchor(picture))}`)}`)
    }
    if (args['picture-anchor'])
        log.step(
            'Own',
            `${chosen[0]!.id} ${styles.muted(`- your picture is ${await installOwnPicture(chosen[0]!, project.dir, config.sequenceSheets, args['picture-anchor'])}`)}`,
        )
    const todoPictures = chosen.filter(p => !existsSync(join(project.dir, p.file)))
    log.step(
        'Estimate',
        styles.muted(
            await pictureEstimate(
                todoPictures.length,
                config,
                settings.comfy.map(server => server.name),
            ),
        ),
    )
    await renderAll(chosen, picture =>
        config.sequenceSheets && picture.kind !== 'prop' ? renderer.renderSequenceSheet(picture) : renderer.renderPicture(picture),
    )
    if (edited !== undefined) pinEditedPicture(chosen[0]!, project.dir, edited)
}

if (until === 'look') {
    // the casting photos: every character and place as the look describes them, before the beats - a group's members come out
    // of the beats (how many are seen at once), so a group has its pictures with the shot plan
    const lookPictures = pictureJobs({}, {}, {}).filter(p => p.kind !== 'character' || !cast.characters.find(c => c.id === p.id)?.isGroup)
    const groups = cast.characters.filter(c => c.isGroup)
    // a plan with clips has its own list, with the group members: it stays until the shots are planned again
    if (!existsSync(clipRequestsDir(project.dir)) || !readdirSync(clipRequestsDir(project.dir)).some(f => f.endsWith('.json'))) {
        mkdirSync(join(project.dir, 'output'), {recursive: true})
        await Bun.write(join(project.dir, 'output', 'assets.json'), JSON.stringify(lookPictures, null, 2))
    }
    if (groups.length) log.step('Groups', styles.muted(`${groups.map(g => g.name).join(', ')}: the pictures of their members come with the shot plan`))
    if (render.has('images')) {
        using renderer = new Renderer(project.id, project.dir, config, settings.comfy)
        renderer.refresh = refreshKinds
        log.section('8e · RENDERING THE CAST AND THE PLACES')
        log.step('Servers', `${settings.comfy.map(s => `${styles.name(s.name)} ${styles.muted(s.url)}`).join(', ')} ${from(settings.sources.comfy)}`)
        if (args.again || refreshKinds.size || retake || args['picture-anchor']) await renderer.serversFirst()
        await renderPictures(renderer, lookPictures)
    } else
        log.step('Pictures', `${lookPictures.length} ${styles.muted(`- render them before the shots: bun index.ts ${projectId} --until=look --render=images`)}`)
}
stopAfter(until, 'look', project.file, `bun index.ts ${projectId}`)

// the beats of the story along the song, the members of a group, the clips of the song (lib/pipeline/beats.ts)
const {beats, memberCounts, characterLookVariants, characterDescriptionVariants, timeline} = await planBeats({
    project,
    config,
    args,
    maxClipSec,
    music,
    lyrics,
    lyricSections,
    lyricsTiming,
    propActivity,
    singing,
    storyBase,
    cast,
    lookBrief,
    characterLooks,
    characterDescriptions,
})

// the shots: the story matched to the clips, blocked and planned beat by beat, the direction kept (lib/pipeline/plan-shots.ts)
const {clipSlots, mapping, locationView, directedPlan, shotViews} = await planShots({
    project,
    config,
    args,
    render,
    music,
    timeline,
    lyricsTiming,
    propActivity,
    singing,
    beats,
    cast,
    characterDescriptions,
    locationDescriptions,
    locationLayouts,
    lookBrief,
})

// the requests: one per clip, built from the plan on every run, written to output/ (lib/pipeline/requests.ts)
const {clips, outputDir, pictures} = await buildRequests({
    project,
    config,
    args,
    language,
    songFile,
    music,
    stems,
    stemFiles,
    lyricsTiming,
    propActivity,
    singing,
    cast,
    lookBrief,
    characterDescriptions,
    locationDescriptions,
    locationAnchors,
    locationLayouts,
    beats,
    memberCounts,
    characterLookVariants,
    characterDescriptionVariants,
    timeline,
    clipSlots,
    mapping,
    locationView,
    directedPlan,
    shotViews,
    pictureJobs,
})

// the pictures and clips asked for, the final video, the timeline for an editor (lib/pipeline/render-music.ts)
await renderAndAssemble({
    project,
    config,
    settings,
    args,
    render,
    refreshKinds,
    retake,
    clips,
    pictures,
    stemFiles,
    songFile,
    exportFormats,
    from,
    renderPictures,
})

log.section('✔ DONE')
log.step('Clips', `${clips.length} H3 requests covering ${formatTime(clips.at(-1)?.end ?? 0)} of ${formatTime(music.durationSec)}`)
log.step('Timeline', join(outputDir, 'timeline.json'))
log.step('Requests', clipRequestsIn(outputDir))
log.step('Audio', join(outputDir, 'audio'))
log.step('Pictures needed', `${pictures.length} - see ${join(outputDir, 'assets.json')}`)
// what this run did: the steps it generated, its LLM calls and renders, its warnings
log.step(
    'Generated',
    project.generated.size ? [...project.generated].map(styles.name).join(', ') : styles.muted('nothing - every step was taken from project.json'),
)
const measured = runTimings()
const llmCalls = measured.filter(t => t.kind === 'llm')
if (llmCalls.length) {
    const tokens = llmCalls.reduce((sum, t) => sum + (t.completionTokens ?? 0), 0)
    const retried = llmCalls.filter(t => t.outcome).length
    log.step(
        'LLM',
        `${llmCalls.length} call(s), ${formatDuration(llmCalls.reduce((sum, t) => sum + t.seconds, 0) * 1000)}${tokens ? `, ${tokens} tokens written` : ''}${retried ? styles.muted(` · ${retried} cut off, empty or failed and asked again`) : ''}`,
    )
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
    for (const [message, count] of [...warned].slice(0, 8))
        log.line(styles.warning(`   ${count > 1 ? `${count}× ` : ''}${message.length > 160 ? `${message.slice(0, 157)}…` : message}`))
}
log.step('Log', runLogFile() ?? '')
// the next step, as bun run status says it - so that following only the "Next" lines leads to a video (#828)
{
    const {next} = await projectStatus(project.id).catch(() => ({next: undefined}))
    if (next?.command) log.next(next.command)
}

// No project id given: the projects, most recently changed first, to pick one with the arrow keys - without a
// terminal (scripts, CI) nobody can pick, so the usage error lists them instead
async function pickProject(): Promise<string> {
    const projects = listProjects()
    if (!projects.length) return log.usageError(noProject('project', undefined, []), usage)
    if (!process.stdin.isTTY || !process.stdout.isTTY) return log.usageError(noProject('project', undefined, projects), usage)
    const picked = await clack.select({message: 'Which project?', options: projects.map(id => ({value: id, label: id}))})
    if (clack.isCancel(picked)) {
        log.cancel('No project selected')
        process.exit(0)
    }
    return picked
}
