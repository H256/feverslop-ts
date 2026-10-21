// Creates a new project: asks for the song (an audio file, or one to generate from a song idea or from lyrics of your
// own), who sings it, lyrics and/or a story idea, and whether to customize the project settings - then writes
// projects/<id>/ and prints the command to run it.
// usage: bun run init
import * as p from "@clack/prompts";
import {existsSync, readdirSync} from "node:fs";
import {createInterface} from "node:readline/promises";
import type {Resolution} from "../comfy/helpers.ts";
import {defaults, languageName, type ProjectConfig, type SingerVoice, workflowDir} from "../lib/config.ts";
import {printBanner, styles} from "../lib/log.ts";
import {projectExists, validProjectId, writeProject} from "../lib/project-setup.ts";
import {STYLES} from "../lib/styles.ts";

if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log(`No terminal to ask in - create projects/<id>/input/ by hand instead:
  input/song.wav or song.mp3      a song you already have
  input/idea.txt                  or a song idea, for: bun index.ts <id> --render=song (lyrics.txt alone works too)
  input/lyrics.txt and/or input/story-idea.txt   at least one, unless idea.txt writes the lyrics for you
  input/style.txt                 optional visual style - see docs/style-examples.md (picked from the list if missing)
  config.json                     optional - see docs/comfyui.md`)
    process.exit(1)
}

printBanner()
p.intro('feverslop-ts · new project')

const id = answer(await p.text({
    message: 'Project id (used as the directory name)',
    placeholder: 'well-of-youth-gothic-trio',
    validate: value => {
        if (!value) return 'required'
        if (!validProjectId(value)) return 'lowercase letters, digits and "-" only'
        if (projectExists(value)) return `projects/${value} already exists`
    },
}))

const songSource = answer(await p.select({
    message: 'The song',
    options: [
        {value: 'file', label: 'I have it as an audio file', hint: 'wav or mp3'},
        {value: 'idea', label: 'Generate it from a song idea', hint: 'the LLM writes the lyrics'},
        {value: 'lyrics', label: 'Generate it from my own lyrics', hint: 'set to music as they are'},
    ],
}))
const hasSong = songSource === 'file'

let songFile: string | undefined
let idea: string | undefined
let musicStyle: string | undefined
let lyrics: string | undefined
if (hasSong) {
    songFile = answer(await p.text({
        message: 'Path to the audio file (wav or mp3)',
        validate: value => {
            if (!value) return 'required'
            if (!existsSync(value)) return 'file not found'
            if (!/\.(wav|mp3)$/i.test(value)) return 'must be .wav or .mp3'
        },
    }))
} else {
    p.log.step(`No song yet - it will be generated with the ${defaults.songWorkflow} workflow`)
    if (songSource === 'idea') idea = await askText('Song idea', {required: true})
    else {
        p.log.info(styles.muted('Section tags on their own line - [Verse], [Chorus], [Bridge], ... - and a blank line between sections'))
        lyrics = await askText('Lyrics', {required: true})
    }
    musicStyle = await askText('Musical style hint (genre, mood, instruments - optional, the LLM invents one otherwise)')
}

// the language a generated song's lyrics are written and sung in - and for every song the one the lyrics are aligned in
const config: Partial<ProjectConfig> = {}
const language = answer(await p.text({
    message: songSource === 'idea' ? 'Language to write the lyrics in (ISO 639-1 code: en, de, ja, ...)' : 'Language of the lyrics (ISO 639-1 code: en, de, ja, ...)',
    initialValue: defaults.lyricsLanguage,
    validate: value => languageName(value ?? '') ? undefined : `unknown language code "${value}"`,
}))
if (language !== defaults.lyricsLanguage) config.lyricsLanguage = language
p.log.info(styles.muted(languageName(language)!))

// who sings: a generated song is sung in that voice (the YuE2 tags), and the story casts its singers to match it
const singerVoice = answer(await p.select<SingerVoice>({
    message: hasSong ? 'Who sings in the song?' : 'Who should sing the song?',
    options: [
        {value: 'auto', label: hasSong ? 'Leave it open' : 'Leave it to the LLM', hint: hasSong ? 'the story decides - also for an instrumental' : 'the LLM picks the voice'},
        {value: 'female', label: 'A woman', hint: 'female vocals'},
        {value: 'male', label: 'A man', hint: 'male vocals'},
        {value: 'mixed', label: 'A duet - a woman and a man'},
    ],
}))
if (singerVoice !== defaults.singerVoice) config.singerVoice = singerVoice

// lyrics/story: required when there's already a song (index.ts throws otherwise) - when generating one, the lyrics are
// there (given, or written by index.ts from the idea), but a story idea on top still helps the story stay close to
// what you want
const lyricsChoice = answer(await p.select({
    message: hasSong ? 'Lyrics and/or a story idea (at least one)' : `A story idea on top of the ${idea ? 'generated ' : ''}lyrics? (optional)`,
    options: hasSong ? [
        {value: 'lyrics', label: 'Lyrics'},
        {value: 'story', label: 'Story idea'},
        {value: 'both', label: 'Both'},
    ] : [
        {value: 'story', label: 'Yes, add a story idea'},
        {value: 'none', label: 'No - let the lyrics carry the story'},
    ],
}))
if (lyricsChoice === 'lyrics' || lyricsChoice === 'both') lyrics = await askText('Lyrics', {required: true})
const storyIdea = lyricsChoice === 'story' || lyricsChoice === 'both' ? await askText('Story idea', {required: true}) : undefined

// singers, right after the voice and the lyrics they follow: they lip-sync to the lyrics timing, which needs sung
// lines - a story idea alone can't provide them. A voice given makes "the LLM picks" the default: in clip mode the voice
// only shapes the story, nobody is seen singing.
const canSing = Boolean(lyrics || idea)
if (!canSing) p.log.info('No lyrics, so nobody can sing - the song just plays (clip mode). Add input/lyrics.txt and "singers" in config.json later to change that.')
const singerMode = !canSing ? 'none' : answer(await p.select({
    message: 'Who is seen singing?',
    initialValue: singerVoice === 'auto' ? 'none' : 'auto',
    options: [
        {value: 'none', label: 'Nobody - the song just plays (clip mode)', hint: singerVoice === 'auto' ? 'default' : 'the voice only shapes the story'},
        {value: 'auto', label: 'Let the LLM pick the singers', hint: singerVoice === 'mixed' ? 'one woman and one man' : singerVoice === 'auto' ? undefined : `${singerVoice} characters`},
        {value: 'named', label: 'Name the singer(s)'},
    ],
}))
if (singerMode === 'auto') config.singers = ['auto']
if (singerMode === 'named') {
    const names = answer(await p.text({
        message: singerVoice === 'mixed' ? 'The two singers, comma-separated - a woman and a man the story creates' : 'Singer name(s), comma-separated - must match characters the story creates',
        validate: value => {
            const count = (value ?? '').split(',').map(n => n.trim()).filter(Boolean).length
            if (!count) return 'required'
            if (singerVoice === 'mixed' && count !== 2) return 'a duet: exactly two names'
        },
    }))
    config.singers = names.split(',').map(n => n.trim()).filter(Boolean)
}

const style = await askStyle()

// project settings
if (!hasSong) config.songDuration = Number(answer(await p.text({
    message: 'Target song length in seconds (the workflow\'s own default otherwise)',
    placeholder: 'default',
    initialValue: '',
    validate: value => !value || (Number.isFinite(Number(value)) && Number(value) > 0) ? undefined : 'a positive number, or empty',
}))) || undefined

// the clips' aspect ratio - characters stay portrait and places landscape, only the clips change
const aspect = answer(await p.select({
    message: 'Aspect ratio of the video',
    options: [
        {value: '16:9', label: '16:9 landscape', hint: 'default'},
        {value: '9:16', label: '9:16 portrait', hint: 'social media'},
        {value: '2:1', label: '2:1 wide'},
        {value: '2:3', label: '2:3 portrait, less tall'},
        {value: 'other', label: 'Another ratio'},
    ],
}))
const videoAspect = aspect !== 'other' ? aspect : answer(await p.text({
    message: 'Aspect ratio (WIDTH:HEIGHT)',
    placeholder: '4:3',
    validate: v => v && /^[1-9]\d*:[1-9]\d*$/.test(v) ? undefined : 'e.g. 4:3',
}))
if (videoAspect !== defaults.videoAspect) config.videoAspect = videoAspect as `${number}:${number}`

// render settings: a preset, or every one of them asked
const preset = answer(await p.select({
    message: 'Render settings',
    options: [
        {value: 'defaults', label: 'Defaults', hint: `${defaults.imageWorkflow}, ${defaults.videoWorkflow}, the workflows' own resolution`},
        {value: 'quick', label: 'Quick test', hint: `flat pictures instead of reference sheets, 0.5 MP clips${hasSong ? '' : ', a 60 s song unless a length was given'}`},
        {value: 'quality', label: 'Quality', hint: 'two-pass clips at 2 MP - slower'},
        {value: 'custom', label: 'Custom', hint: 'image/video workflow and resolution, one by one'},
    ],
}))
if (preset === 'quick') {
    config.sequenceSheets = false
    config.videoResolution = 0.5
    if (!hasSong && !config.songDuration) config.songDuration = 60
}
if (preset === 'quality') config.videoWorkflow = 'h3-ref2video-2pass'
if (preset === 'custom') {
    const imageWorkflow = await askWorkflow('Image workflow', 'image')
    if (imageWorkflow !== defaults.imageWorkflow) config.imageWorkflow = imageWorkflow
    const videoWorkflow = await askWorkflow('Video workflow', 'video')
    if (videoWorkflow !== defaults.videoWorkflow) config.videoWorkflow = videoWorkflow

    config.imageResolution = await askResolution('Image resolution')
    // the two-pass workflow takes videoResolution as its final size, pass 1 renders a quarter of it
    config.videoResolution = await askResolution(videoWorkflow.endsWith('-2pass') ? 'Video resolution (the final size - pass 1 renders a quarter of it)' : 'Video resolution')
}

// the default resolution of the workflow is not stored - a later change of workflow keeps its own default
if (config.imageResolution === -1) delete config.imageResolution
if (config.videoResolution === -1) delete config.videoResolution

p.log.step(`Writing ${styles.muted(`projects/${id}/`)}`)
await writeProject(id, {songFile, idea, lyrics, storyIdea, style, musicStyle, config})

const render = hasSong ? 'images,videos,final' : 'song,images,videos,final'
p.outro(`Created - run it with:\n\n  bun index.ts ${id} --render=${render}\n`)

// cancelled with Ctrl+C / Esc
function answer<T>(value: T): Exclude<T, symbol> {
    if (p.isCancel(value)) {
        p.cancel('Cancelled - nothing written')
        process.exit(1)
    }
    return value as Exclude<T, symbol>
}

/** Text from a file path or typed on the spot (clack's text prompt is single-line, unsuited to lyrics/a story). */
async function askText(label: string, options: { required?: boolean } = {}): Promise<string | undefined> {
    const mode = answer(await p.select({
        message: label,
        options: [
            {value: 'type', label: 'Type it now'},
            {value: 'file', label: 'Read from a file'},
            ...(options.required ? [] : [{value: 'skip', label: 'Skip'}]),
        ],
    }))
    if (mode === 'skip') return undefined
    if (mode === 'file') {
        const path = answer(await p.text({message: 'File path', validate: v => v && existsSync(v) ? undefined : 'file not found'}))
        return (await Bun.file(path).text()).trim()
    }
    return multiline(label)
}

/**
 * The film style for input/style.txt: typed, read from a file, taken from the built-in list - or left to the first run.
 * The list goes kind of style -> style, and "← back" on each level returns to the one above.
 */
async function askStyle(): Promise<string | undefined> {
    const BACK = '\0back'
    const back = {value: BACK, label: '← back'}
    while (true) {
        const mode = answer(await p.select({
            message: 'Visual style',
            options: [
                {value: 'skip', label: 'Skip', hint: 'the first run picks one from the built-in list that fits the story'},
                {value: 'list', label: 'Choose from the built-in list', hint: `${STYLES.length} styles`},
                {value: 'type', label: 'Type it now'},
                {value: 'file', label: 'Read from a file'},
            ],
        }))
        if (mode === 'skip') return undefined
        if (mode === 'file') {
            const path = answer(await p.text({message: 'File path', validate: v => v && existsSync(v) ? undefined : 'file not found'}))
            return (await Bun.file(path).text()).trim()
        }
        if (mode === 'type') return multiline('Visual style')

        const groups = [...new Set(STYLES.map(s => s.group))]
        while (true) {
            const group = answer(await p.select({
                message: 'Kind of style',
                options: [...groups.map(g => ({value: g, label: g, hint: `${STYLES.filter(s => s.group === g).length}`})), back],
            }))
            if (group === BACK) break
            // a picked style is shown in full before it is taken - the hint in the list is only its first words
            let last: string | undefined
            while (true) {
                const picked = answer(await p.select({
                    message: group,
                    maxItems: 12,
                    initialValue: last,
                    options: [...STYLES.filter(s => s.group === group).map(s => ({value: s.id, label: s.name, hint: s.text.slice(0, 60)})), back],
                }))
                if (picked === BACK) break
                const style = STYLES.find(s => s.id === picked)!
                p.note(style.text, style.name)
                const take = answer(await p.confirm({message: `Take ${style.name}?`, active: 'Take it', inactive: 'Another one', initialValue: true}))
                if (take) return style.text
                last = picked
            }
        }
    }
}

// what the workflows in comfy/workflows/ are for - one that isn't listed here is still offered, without a hint
const WORKFLOW_HINTS: Record<string, string> = {
    'kroma-image': 'Kroma turbo, half size + 2x refine',
    'krea2-image': 'Krea 2, one pass',
    'h3-ref2video': 'MiniMax H3, one pass with the turbo LoRA - fastest',
    'h3-ref2video-full': 'MiniMax H3 base model, 20 steps - ~2.5x slower, more detail and motion',
    'h3-ref2video-2pass': 'MiniMax H3 in two passes - quarter size, latent x2, short refine',
    'h3-ref2video-cpu-clip': 'one pass, text encoder on the CPU - for less VRAM',
}

/** An image or video workflow from comfy/workflows/ - the film pipeline's own and the helper ones are not offered. */
async function askWorkflow(label: string, kind: 'image' | 'video'): Promise<string> {
    const fallback = kind === 'image' ? defaults.imageWorkflow : defaults.videoWorkflow
    const names = readdirSync(workflowDir).filter(f => f.endsWith('.ts')).map(f => f.slice(0, -3))
        .filter(n => kind === 'image' ? n.endsWith('-image') : n.includes('ref2video') && !n.includes('-film'))
        .sort((a, b) => Number(b === fallback) - Number(a === fallback) || a.localeCompare(b))
    return answer(await p.select({
        message: label,
        initialValue: fallback,
        options: names.map(n => ({value: n, label: n, hint: [WORKFLOW_HINTS[n], n === fallback ? 'default' : ''].filter(Boolean).join(' · ') || undefined})),
    }))
}

/**
 * Clack has no multiline prompt - reads plain lines until two in a row are empty, after the current clack prompt
 * closed. A single empty line doesn't end it: lyrics and stories routinely have blank lines between sections.
 */
async function multiline(label: string): Promise<string> {
    console.log(styles.muted(`  ${label} - end with two empty lines (press Enter twice when done):`))
    const rl = createInterface({input: process.stdin})
    const lines: string[] = []
    let blankStreak = 0
    for await (const line of rl) {
        if (line === '') {
            blankStreak++
            if (blankStreak >= 2 && lines.length) break
        } else {
            blankStreak = 0
        }
        lines.push(line)
    }
    rl.close()
    while (lines.length && lines.at(-1) === '') lines.pop()
    return lines.join('\n').trim()
}

async function askResolution(label: string): Promise<Resolution> {
    const mode = answer(await p.select({
        message: label,
        options: [
            {value: 'default', label: 'Workflow default', hint: 'default'},
            {value: 'megapixels', label: 'Megapixels (e.g. 1.1)'},
            {value: 'fixed', label: 'Fixed size (WIDTHxHEIGHT)'},
        ],
    }))
    if (mode === 'default') return -1
    if (mode === 'megapixels') return Number(answer(await p.text({message: 'Megapixels', placeholder: '1.1', validate: v => Number(v) > 0 ? undefined : 'a positive number'})))
    return answer(await p.text({message: 'Size', placeholder: '1920x1088', validate: v => v && /^\d+x\d+$/.test(v) ? undefined : 'e.g. 1920x1088'})) as `${number}x${number}`
}
