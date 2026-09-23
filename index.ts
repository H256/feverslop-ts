import slugify from "slugify";
import {existsSync} from "node:fs";
import {parseArgs} from "node:util";
import {log, styles} from "./lib/log.ts";
import {ask, askJson, configureLlm} from "./lib/llm.ts";
import {mkdirSync, rmSync} from "node:fs";
import {join} from "node:path";
import {type Character, type Location, ProjectStore, type Singing, type StepName, type StoryBeat} from "./lib/project.ts";
import {analyzeSong, buildTimeline, cutAudio, mapBeatsToSlots, parseLyricSections, separateStems, transcribeVocals} from "./lib/music.ts";
import {buildClipRequests, countShotsPerBeat, pictureAsset} from "./lib/compose.ts";
import {type PictureJob, Renderer} from "./lib/render.ts";
import {languageName, loadProjectConfig} from "./lib/config.ts";
import {alignLyrics, lowConfidence, sungLines} from "./lib/lyrics.ts";
import {assembleFinal} from "./lib/assemble.ts";
import {formatTime, secondsAt} from "./lib/frames.ts";
import {loadSettings} from "./lib/settings.ts";
import {
    castPrompt, characterDescriptionPrompt, characterLookPrompt, locationDescriptionPrompt, locationLookPrompt,
    lookBriefPrompt, storyPrompt, summaryPrompt,
} from "./lib/prompts.ts";

// hardware limit: the longest clip the video model can generate in one go
const MAX_CLIP_SEC = 10

// bun index.ts [project-id] [--redo=story,beats] [--render=images,videos,final|all] [--only=slot-001,slot-002]
//              [--llm-url=…] [--llm-key=…] [--llm-model=…] [--comfy=http://a:8188,http://b:8188] [--legacy-moments]  (this run only)
const {values: args, positionals} = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
        redo: {type: 'string', default: ''},
        render: {type: 'string', default: ''},
        only: {type: 'string', default: ''},
        'llm-url': {type: 'string'},
        'llm-key': {type: 'string'},
        'llm-model': {type: 'string'},
        comfy: {type: 'string'},
        // skips step 9b and spreads/reuses beat.moments across shots the old way - a fallback while 9b is new
        'legacy-moments': {type: 'boolean', default: false},
    },
})
// --render=all is images, videos and the final video, in that order
const render = new Set(args.render.split(',').filter(Boolean).flatMap(r => r === 'all' ? ['images', 'videos', 'final'] : [r]))
const unknownRender = [...render].filter(r => !['images', 'videos', 'final'].includes(r))
if (unknownRender.length) throw new Error(`--render: unknown ${unknownRender.join(', ')} - use images, videos, final or all`)
const project = new ProjectStore(positionals[0] ?? 'well-of-youth-gothic-trio-260920')
const maxClipSec = MAX_CLIP_SEC
await project.load()
for (const step of args.redo.split(',').filter(Boolean)) project.invalidate(step as StepName)
if (project.data.timeline && project.data.timeline.maxClipSec !== maxClipSec) project.invalidate('timeline')

const toId = (name: string) => slugify(name, {lower: true, strict: true})
const readInput = async (name: string) => existsSync(project.input(name)) ? (await Bun.file(project.input(name)).text()).trim() : ''

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
const lyrics = await readInput('lyrics.txt')
const storyIdea = await readInput('story-idea.txt')
const style = await readInput('style.txt')
const lyricSections = parseLyricSections(lyrics)
const language = languageName(config.lyricsLanguage)!
log.step('Lyrics', lyrics ? styles.muted(`${lyricSections.length} sections: ${lyricSections.map(s => s.label).join(' · ')}`) : styles.muted('(none)'))
log.step('Story idea', storyIdea || styles.muted('(none)'))
log.step('Style', style || styles.muted('(none - the look is designed from the story)'))
log.step('Max clip length', `${maxClipSec}s`)
log.step('Mode', config.singers.length
    ? `performance - ${config.singers[0] === 'auto' ? 'the LLM picks the singer' : `${config.singers.join(', ')} sing${config.singers.length > 1 ? '' : 's'}`} (${language})`
    : `clip - the song is the soundtrack${config.alignLyrics ? ', lyrics aligned' : ''} ${styles.muted('(set "singers" in config.json to let characters sing)')}`)
if (config.alignLyrics && sungLines(lyricSections).length === 0) throw new Error('Aligning the lyrics needs sung lines in input/lyrics.txt')

// an edited input redoes the steps built on it
const songFile = project.input('song.wav')
await project.syncInputs({
    'song.wav': {value: existsSync(songFile) ? await Bun.file(songFile).bytes() : '', steps: ['music', 'stems']},
    'lyrics.txt': {value: lyrics, steps: ['story', 'transcript', 'singing']},
    'story-idea.txt': {value: storyIdea, steps: ['story']},
    'style.txt': {value: style, steps: ['lookBrief'], assumed: ''},
    singers: {value: JSON.stringify(config.singers), steps: ['singing'], assumed: '[]'},
    lyricsLanguage: {value: config.lyricsLanguage, steps: ['transcript'], assumed: 'en'},
})
// the sections are named after the lyrics tags
if (project.data.music && lyricSections.length && project.data.music.sections.map(s => s.label).join('|') !== lyricSections.map(s => s.label).join('|')) {
    project.invalidate('music')
}
if (project.data.stems && Object.values(project.data.stems).some(file => !existsSync(join(project.dir, file)))) project.invalidate('stems')

////////// ANALYZE THE SONG
if (!existsSync(songFile)) throw new Error(`No song found at ${songFile}`)
const music = await project.step('music', '0 · ANALYZING THE SONG', async () => {
    log.step('Analyzing', styles.muted(`${songFile} - beats, bars and ${lyricSections.length} sections`))
    return analyzeSong(songFile, lyricSections.map(s => s.label))
})
log.step('Tempo', `${music.bpm} BPM, ${music.downbeats.length} bars, ${Math.round(music.durationSec)}s`)
for (const s of music.sections) {
    console.log(`   ${styles.name(s.label.padEnd(12))} ${styles.muted(`${formatTime(s.start)} – ${formatTime(s.end)}`)} ${energyBar(s.energy)}`)
}
log.step('Sections', styles.muted(config.alignLyrics
    ? 'estimated from audio - refined from the lyrics timing when the song is cut into clips'
    : `estimated from audio - fix them by hand in ${project.file} if they are off, then --redo=timeline`))

////////// ALIGNING THE LYRICS - only when someone sings, or with "alignLyrics": true
const stems = config.alignLyrics ? await project.step('stems', '0a · SEPARATING THE STEMS', async () => {
    log.step('Separating', styles.muted(`${songFile} with demucs htdemucs_ft - the first run downloads the model (~320 MB)`))
    return separateStems(songFile, project.dir)
}) : undefined
if (stems) log.step('Stems', styles.muted(Object.values(stems).join(' · ')))

const transcript = stems ? await project.step('transcript', '0b · TRANSCRIBING THE VOCALS', async () => {
    log.step('Transcribing', styles.muted(`${stems.vocals} with Whisper large-v3 (${language}) - the first run downloads the model (~3 GB)`))
    return transcribeVocals(join(project.dir, stems.vocals), config.lyricsLanguage, project.input('lyrics.txt'))
}) : undefined
if (transcript) {
    log.step('Heard', styles.muted(`${transcript.words.length} words: ${transcript.words.slice(0, 12).map(w => w.text).join(' ')} …`))
    if (transcript.activity) log.step('Vocal activity', styles.muted(`${transcript.activity.length} range(s) from RMS energy, independent of whisper`))
}

const lyricsTiming = transcript ? await project.step('lyricsTiming', '0c · ALIGNING THE LYRICS', async () => alignLyrics(lyricSections, transcript.words, music.sections, transcript.activity)) : undefined
if (lyricsTiming) {
    for (const line of lyricsTiming.lines) {
        const confidence = line.confidence < 0.5 ? styles.warning(line.confidence.toFixed(2)) : styles.muted(line.confidence.toFixed(2))
        console.log(`   ${styles.muted(`${formatTime(line.start, true)} – ${formatTime(line.end, true)}`)} ${confidence} ${styles.name(line.section.padEnd(12))} ${line.text}`)
    }
    const unsure = lowConfidence(lyricsTiming)
    if (unsure.length) log.warn(`${unsure.length} line(s) barely found in the transcript - their times are interpolated. Check them and fix lyricsTiming in ${project.file} by hand if needed, then --redo=timeline`)
}

////////// CRAFT A STORY FOR THE LYRICS
const storyBase = await project.step('story', '1 · CRAFTING THE STORY', () => ask(storyPrompt(lyrics, storyIdea)))
log.box('Story', storyBase)
if (storyBase === 'NO STORY') throw new Error('Neither lyrics nor a story idea given')

////////// SUMMARIZE THE STORY
const storySummary = await project.step('summary', '2 · SUMMARIZING THE STORY', () => ask(summaryPrompt(storyBase)))
log.box('Summary', storySummary)

////////// EXTRACT LOCATIONS AND CHARACTERS
const cast = await project.step('cast', '3 · EXTRACTING CHARACTERS & LOCATIONS', async () => {
    const extracted = await askJson<{ characters: Omit<Character, 'id'>[], locations: Omit<Location, 'id'>[] }>(castPrompt(storyBase))
    return {
        characters: extracted.characters.map(c => ({id: toId(c.name), ...c})),
        locations: extracted.locations.map(l => ({id: toId(l.name), ...l})),
    }
})
log.step('Characters', styles.muted(`(${cast.characters.length})`))
for (const c of cast.characters) console.log(`   ${styles.name(c.id)} ${styles.muted('—')} ${c.role}`)
log.step('Locations', styles.muted(`(${cast.locations.length})`))
for (const l of cast.locations) console.log(`   ${styles.name(l.id)}`)

////////// CHOOSING THE SINGERS - performance mode only
const singing = config.singers.length ? await project.step('singing', '3b · CHOOSING THE SINGERS', () => chooseSingers(config.singers)) : undefined
if (singing) {
    const nameOf = (id: string) => cast.characters.find(c => c.id === id)?.name ?? id
    log.step('Singers', singing.singers.map(id => styles.name(nameOf(id))).join(', '))
    if (singing.singers.length > 1) {
        for (const line of singing.lines) console.log(`   ${styles.muted(line.singers.map(nameOf).join(' + ').padEnd(24))} ${line.text}`)
    }
}

/////////// DESIGNING THE LOOK - invented from the story, or extending the director's style.txt
const lookBrief = await project.step('lookBrief', '4 · DESIGNING THE FILM LOOK', () => ask(lookBriefPrompt(style, storySummary)))
log.box('Look brief', lookBrief)

////////// CRAFTING CHARACTER LOOKS
const characterLooks = await project.step('characterLooks', '5 · CRAFTING CHARACTER LOOKS', async () => {
    const looks: Record<string, string> = {}
    for (const [i, char] of cast.characters.entries()) {
        log.step(`Character ${i + 1}/${cast.characters.length}`, styles.name(char.id))
        looks[char.id] = await ask(characterLookPrompt(lookBrief, char))
    }
    return looks
})
for (const [id, look] of Object.entries(characterLooks)) log.box(id, look)

////////// DESCRIBING THE CHARACTERS - the look prompt without the reference sheet (pose, grey background, studio light)
const characterDescriptions = await project.step('characterDescriptions', '5b · DESCRIBING THE CHARACTERS FOR THE CLIPS', async () => {
    const descriptions: Record<string, string> = {}
    for (const [i, char] of cast.characters.entries()) {
        log.step(`Character ${i + 1}/${cast.characters.length}`, styles.name(char.id))
        descriptions[char.id] = await ask(characterDescriptionPrompt(characterLooks[char.id] ?? ''))
    }
    return descriptions
})
for (const [id, description] of Object.entries(characterDescriptions)) log.box(id, description)

////////// CRAFTING LOCATION LOOKS
const locationLooks = await project.step('locationLooks', '6 · CRAFTING LOCATION LOOKS', async () => {
    const looks: Record<string, string> = {}
    for (const [i, location] of cast.locations.entries()) {
        log.step(`Location ${i + 1}/${cast.locations.length}`, styles.name(location.id))
        looks[location.id] = await ask(locationLookPrompt(lookBrief, storySummary, location.name))
    }
    return looks
})
for (const [id, look] of Object.entries(locationLooks)) log.box(id, look)

////////// DESCRIBING THE LOCATIONS - the look prompt without the establishing shot (camera, "empty", medium)
const locationDescriptions = await project.step('locationDescriptions', '6b · DESCRIBING THE LOCATIONS FOR THE CLIPS', async () => {
    const descriptions: Record<string, string> = {}
    for (const [i, location] of cast.locations.entries()) {
        log.step(`Location ${i + 1}/${cast.locations.length}`, styles.name(location.id))
        descriptions[location.id] = await ask(locationDescriptionPrompt(locationLooks[location.id] ?? ''))
    }
    return descriptions
})
for (const [id, description] of Object.entries(locationDescriptions)) log.box(id, description)

////////// BREAKING THE STORY INTO BEATS
const beats = await project.step('beats', '7 · BREAKING THE STORY INTO BEATS', async () => {
    const extracted = await askJson<{ beats: Omit<StoryBeat, 'id' | 'order'>[] }>({
        reasoning: 'medium',
        // thinking at medium easily takes 8k tokens on its own, the long JSON comes on top
        maxTokens: 16384,
        input: `Break the story into story beats for a music video. A beat is one continuous piece of action at ONE location.
The beats have no timing yet - they are stretched onto the song later, so describe what happens, not how long it takes.

The song has these sections, in order: ${lyricSections.map(s => s.label).join(', ')}.
Aim for about ${Math.max(6, Math.round(lyricSections.length * 1.5))} beats that follow the story from start to end.

For every beat give:
- "summary": what visibly happens, 1-3 sentences, present tense.
- "moments": 2-6 short sentences, in order, each one visible action that a camera can film (e.g. "Thorin raises his hammer and strikes the sealed gate."). Name characters by their name. These are spread over the video clips of the beat, so together they must tell the whole beat.
- "locationId": exactly one of the location ids below.
- "characterIds": ids of the characters on screen, only from the list below.
- "intensity": 0.0 (calm, quiet) to 1.0 (climax), used to match the loudness of the music.
- "weight": 1-5, how much screen time the beat deserves.
- "kind": "establish" (introduces a place or character), "build" (tension rises), "hit" (a big moment for a musical accent), or "release" (tension falls).
- "lyricAnchor": the song section label this beat belongs under if the lyrics describe it (e.g. "Chorus"), otherwise omit it.
- "stateAfter": short facts that are true after this beat and must stay visible later, e.g. "the hammer is broken", "the party carries a torch". Empty array if nothing changes.
Whenever a beat brings the characters face to face with an antagonist, monster, spirit or other hostile presence, make it a real dramatic encounter, not a tableau: show fear (flinching, recoiling, shielding one another), active defense or combat (striking, blocking, being struck), or flight (breaking away, running, dragging a companion clear). Characters should not simply stand and stare at the threat.
${singing ? performanceRules(singing) : ''}
Answer only with JSON: {"beats": [...]}
---
characters: ${JSON.stringify(cast.characters.map(c => ({id: c.id, role: c.role})))}
locations: ${JSON.stringify(cast.locations.map(l => l.id))}
lyrics:
${lyrics}
---
story:
${storyBase}`,
        instructions: 'You are a music video director who breaks stories into visual story beats. Answer only with JSON.',
    })

    const characterIds = new Set(cast.characters.map(c => c.id))
    const locationIds = cast.locations.map(l => l.id)
    return extracted.beats.map((beat, i) => {
        if (!locationIds.includes(beat.locationId)) {
            log.warn(`beat ${i + 1} uses unknown location "${beat.locationId}" - using ${locationIds[0]}`)
        }
        return {
            ...beat,
            id: `beat-${String(i + 1).padStart(2, '0')}`,
            order: i + 1,
            locationId: locationIds.includes(beat.locationId) ? beat.locationId : locationIds[0]!,
            characterIds: beat.characterIds.filter(id => characterIds.has(id)),
            moments: beat.moments?.length ? beat.moments : [beat.summary],
            intensity: Math.min(1, Math.max(0, Number(beat.intensity) || 0.5)),
            weight: Math.max(1, Number(beat.weight) || 1),
            stateAfter: beat.stateAfter ?? [],
        }
    })
})
for (const beat of beats) {
    console.log(`   ${styles.name(beat.id)} ${styles.muted(`${beat.kind.padEnd(9)} ${energyBar(beat.intensity)} @${beat.locationId}${beat.lyricAnchor ? ` ♪${beat.lyricAnchor}` : ''}`)}`)
    console.log(`      ${beat.summary}`)
    for (const moment of beat.moments) console.log(styles.muted(`        · ${moment}`))
}

////////// CUTTING THE SONG INTO CLIPS
// switched alignLyrics on or off since the timeline was built
if (project.data.timeline && (project.data.timeline.aligned ?? false) !== Boolean(lyricsTiming)) project.invalidate('timeline')
const timeline = await project.step('timeline', '8 · CUTTING THE SONG INTO CLIPS', async () => buildTimeline(music, lyricSections, maxClipSec, lyricsTiming))
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
const mapping = await project.step('mapping', '9 · MATCHING THE STORY TO THE MUSIC', async () => mapBeatsToSlots(beats, timeline.slots))
const beatById = new Map(beats.map(b => [b.id, b]))
for (const slot of timeline.slots) {
    const beat = beatById.get(mapping[slot.index]!.beatId)!
    console.log(`   ${styles.muted(`${formatTime(slot.start)}`)} ${slot.section.padEnd(12)} ${energyBar(slot.energy)} ${styles.name(beat.id)} ${styles.muted(energyBar(beat.intensity))}`)
}

////////// REFINING THE MOMENTS TO ONE PER SHOT
// beat.moments (2-6 sentences) is written before the beat's shot count is known, so a beat can end up covering far
// more shots than it has moments for - the old code just reused/repeated moments across shots (--legacy-moments
// still does). This step asks for exactly one distinct, progressing action per shot instead.
const shotMoments = args['legacy-moments'] ? undefined : await project.step('shotMoments', '9b · REFINING MOMENTS PER SHOT', async () => {
    const shotCounts = countShotsPerBeat({slots: timeline.slots, mapping, beats})
    const extracted = await askJson<{ moments: Record<string, string[]> }>({
        reasoning: 'medium',
        maxTokens: 16384,
        input: `For every story beat below, expand it into a shot list for a music video: exactly "shotsNeeded" short sentences, in order, one concrete visible action per shot.

Rules:
- Each shot must show real physical progression from the one before it - never repeat, restate or merely rephrase the previous shot's action, and never describe the camera or a held/static moment.
- Whenever a beat brings the characters face to face with an antagonist, monster, spirit or other hostile presence, the shots must show a real dramatic encounter across the sequence: fear (flinching, recoiling, shielding one another), active defense or combat (striking, blocking, being struck), or flight (breaking away, running, dragging a companion clear) - not characters standing and staring.
- Use the beat's "summary" and "moments" as the story to tell, but you are free to invent the intermediate physical action needed to fill every shot.
- Name characters by their name (not pronouns), so every shot reads on its own.

Answer only with JSON: {"moments": {"<beatId>": ["shot 1 action", "shot 2 action", ...]}}
---
beats:
${JSON.stringify(beats.map(b => ({id: b.id, summary: b.summary, moments: b.moments, kind: b.kind, characterIds: b.characterIds, locationId: b.locationId, shotsNeeded: shotCounts[b.id] ?? 1})))}`,
        instructions: 'You are a music video director turning story beats into a shot list. Answer only with JSON.',
    })

    const result: Record<string, string[]> = {}
    for (const beat of beats) {
        const needed = shotCounts[beat.id] ?? 1
        const list = extracted.moments[beat.id]
        if (!list?.length) continue // falls back to the legacy spread for this beat
        result[beat.id] = Array.from({length: needed}, (_, j) => list[Math.min(j, list.length - 1)]!)
    }
    return result
})
if (shotMoments) for (const beat of beats) {
    const list = shotMoments[beat.id]
    if (!list) continue
    console.log(`   ${styles.name(beat.id)} ${styles.muted(`${list.length} shots`)}`)
    for (const line of list) console.log(styles.muted(`        · ${line}`))
}

////////// BUILDING THE MINIMAX H3 REQUESTS
// Deterministic from the data above, so it is rebuilt on every run instead of being cached
log.section('10 · BUILDING THE MINIMAX H3 REQUESTS')
const clips = buildClipRequests({
    slots: timeline.slots,
    mapping,
    beats,
    characters: cast.characters,
    locations: cast.locations,
    characterDescriptions,
    locationDescriptions,
    lookBrief,
    music,
    language,
    singing,
    shotMoments,
})

const outputDir = join(project.dir, 'output')
rmSync(outputDir, {recursive: true, force: true})
mkdirSync(join(outputDir, 'clips'), {recursive: true})
mkdirSync(join(outputDir, 'audio'), {recursive: true})

for (const clip of clips) {
    await Bun.write(join(outputDir, 'clips', `${clip.id}.json`), JSON.stringify(clip, null, 2))
    // on the frame grid, like the rendered clips - <Audio 1> from the song, <Audio 2> (singers) from the vocals stem
    for (const audio of clip.assets.audio) {
        const source = audio.stem ? join(project.dir, stems![audio.stem]) : songFile
        await cutAudio(source, secondsAt(clip.frameStart), secondsAt(clip.frameStart + clip.frames), join(project.dir, audio.file))
    }
}

// the pictures the requests expect, with the Krea 2 prompt to generate each one
const pictures: PictureJob[] = [
    ...cast.locations.map(l => ({kind: 'location' as const, id: l.id, file: pictureAsset('location', l.id), name: l.name, prompt: locationLooks[l.id] ?? ''})),
    ...cast.characters.map(c => ({kind: 'character' as const, id: c.id, file: pictureAsset('character', c.id), name: c.name, prompt: characterLooks[c.id] ?? ''})),
]
// next to each image prompt the description the clip prompts use for that picture
await Bun.write(join(outputDir, 'assets.json'), JSON.stringify(pictures.map(p => ({
    ...p,
    description: (p.kind === 'location' ? locationDescriptions : characterDescriptions)[p.id] ?? '',
})), null, 2))

await Bun.write(join(outputDir, 'timeline.json'), JSON.stringify({
    song: project.input('song.wav'),
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
    log.section('11 · RENDERING WITH COMFYUI')
    log.step('Config', styles.muted(`seed ${config.seed}, images ${config.imageResolution} (${config.imageWorkflow}), video ${config.videoResolution} (${config.videoWorkflow})`))
    log.step('Servers', `${settings.comfy.map(s => `${styles.name(s.name)} ${styles.muted(s.url)}`).join(', ')} ${from(settings.sources.comfy)}`)

    // everything at once - the renderer runs one job per server and queues the rest
    if (render.has('images')) {
        log.step('Pictures', `${pictures.length}`)
        await renderAll(pictures, picture => renderer.renderPicture(picture))
    }
    // clips need all their pictures, so they start after the pictures
    if (render.has('videos')) {
        const selected = clips.filter(c => only.size === 0 || only.has(c.id))
        log.step('Clips', `${selected.length}${only.size ? styles.muted(` of ${clips.length} (--only)`) : ''}`)
        await renderAll(selected, clip => renderer.renderClip(clip, songFile, stems && join(project.dir, stems.vocals)))
    }
}

////////// ASSEMBLING THE FINAL VIDEO
if (render.has('final')) {
    log.section('12 · ASSEMBLING THE FINAL VIDEO')
    log.step('Audio', config.songAudio ? 'original song' : styles.muted('the clips\' own audio ("songAudio": false)'))
    const target = join(project.dir, 'final.mp4')
    const result = await assembleFinal({clips, projectDir: project.dir, songFile, songAudio: config.songAudio, target})
    log.step('Saved', `${target} ${styles.muted(`${result.width}x${result.height}, ${result.frames} frames, ${result.seconds.toFixed(3)}s`)}`)
}

log.section('✔ DONE')
log.step('Clips', `${clips.length} H3 requests covering ${formatTime(clips.at(-1)?.end ?? 0)} of ${formatTime(music.durationSec)}`)
log.step('Timeline', join(outputDir, 'timeline.json'))
log.step('Requests', join(outputDir, 'clips'))
log.step('Audio', join(outputDir, 'audio'))
log.step('Pictures needed', `${pictures.length} - see ${join(outputDir, 'assets.json')}`)

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
            input: `Pick the lead singer of this music video from the cast: the character who sings the lyrics on screen.
Pick exactly one - two or three only if the lyrics clearly are a dialogue or duet between different characters. A group character (e.g. "Miners") can be the singer if the lyrics are sung by a group ("we").
Answer only with JSON: {"singers": ["<character id>"]}
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
        maxTokens: 16384,
        input: `These characters sing the song of a music video: ${JSON.stringify(singers)}.
Decide who sings which line. A line is sung by one singer, or by several together (duet or choir lines, e.g. a chorus).
Follow the lyrics and the story: who would say these words? Keep a verse with one singer unless its lines answer each other.
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
For every beat under a section with vocals (its "lyricAnchor" is that section):
- the singer(s) of that section are on screen: their ids are in "characterIds".
- their moments keep the face visible to the camera while they sing, e.g. "Thorin sings while forging the blade" - no turned-away or hidden faces, no masks or objects over the mouth.
`
}

function energyBar(value: number) {
    const filled = Math.round(value * 8)
    return styles.answer('█'.repeat(filled)) + styles.muted('░'.repeat(8 - filled))
}
