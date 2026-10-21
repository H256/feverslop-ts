import {cli} from '../lib/cli.ts';
import {log} from '../lib/log.ts';
// Creates a new project: asks for the song (an audio file, or one to generate from a song idea or from lyrics of your
// own), who sings it, lyrics and/or a story idea, the look and the render settings - then shows a summary to change any
// answer in, writes projects/<id>/ and prints the command to run it.
// usage: bun run init
import * as p from "@clack/prompts";
import {existsSync, readdirSync} from "node:fs";
import {createInterface} from "node:readline/promises";
import type {Resolution} from "../comfy/helpers.ts";
import {defaults, languageName, type ProjectConfig, type SingerVoice, workflowDir} from "../lib/config.ts";
import {styles} from "../lib/log.ts";
import {projectExists, validProjectId, writeProject} from "../lib/project-setup.ts";
import {STYLES} from "../lib/styles.ts";
cli('init')


if (!process.stdin.isTTY || !process.stdout.isTTY) {
    log.error(`No terminal to ask in - create projects/<id>/input/ by hand instead:
  input/song.wav or song.mp3      a song you already have
  input/idea.txt                  or a song idea, for: bun index.ts <id> --render=song (lyrics.txt alone works too)
  input/lyrics.txt and/or input/story-idea.txt   at least one, unless idea.txt writes the lyrics for you
  input/style.txt                 optional visual style - see docs/style-examples.md (picked from the list if missing)
  config.json                     optional - see docs/comfyui.md`)
    process.exit(1)
}

log.section('feverslop-ts · new project')

// Every question is a step of its own that writes into the answers - so the summary at the end can ask any one of them
// again (clack has no way back to an earlier prompt). The config is built from the answers only when it is written.
type Answers = {
    id: string
    songSource: 'file' | 'idea' | 'lyrics'
    songFile?: string
    idea?: string
    ownLyrics?: string      // lyrics of your own the song is generated from
    musicStyle?: string
    language: string
    singerVoice: SingerVoice
    lyrics?: string         // lyrics to a song you have
    storyIdea?: string
    singerMode: 'none' | 'auto' | 'named'
    singerNames: string[]
    style?: string
    songDuration?: number
    videoAspect: string
    preset: 'defaults' | 'quick' | 'quality' | 'custom'
    imageWorkflow: string
    videoWorkflow: string
    imageResolution: Resolution
    videoResolution: Resolution
    continuity: ProjectConfig['continuity']
}
const a = {
    singerMode: 'none', singerNames: [], language: defaults.lyricsLanguage, singerVoice: defaults.singerVoice, videoAspect: defaults.videoAspect,
    preset: 'defaults', imageWorkflow: defaults.imageWorkflow, videoWorkflow: defaults.videoWorkflow, imageResolution: -1, videoResolution: -1,
    continuity: defaults.continuity,
} as unknown as Answers
const hasSong = () => a.songSource === 'file'
// singers lip-sync to the lyrics timing, which needs sung lines - a story idea alone can't provide them
const canSing = () => Boolean(a.ownLyrics || a.idea || a.lyrics)

// then: the steps asked again after this one changed in the summary - their answers may no longer fit
type Step = { label: () => string, ask: () => Promise<void>, summary: () => string, shown?: () => boolean, then?: string[] }
const steps: Record<string, Step> = {
    id: {
        label: () => 'Project id',
        summary: () => a.id,
        ask: async () => {
            a.id = answer(await p.text({
                message: 'Project id (used as the directory name)',
                placeholder: 'well-of-youth-gothic-trio',
                initialValue: a.id,
                validate: value => {
                    if (!value) return 'required'
                    if (!validProjectId(value)) return 'lowercase letters, digits and "-" only'
                    if (projectExists(value)) return `projects/${value} already exists`
                },
            }))
        },
    },
    song: {
        label: () => 'Song',
        summary: () => a.songSource === 'file' ? a.songFile!
            : `${a.songSource === 'idea' ? `from the idea "${short(a.idea)}"` : `from your lyrics "${short(a.ownLyrics)}"`}${a.musicStyle ? `, style hint "${short(a.musicStyle)}"` : ''}`,
        then: ['texts', 'singers', 'length'],
        ask: async () => {
            a.songSource = answer(await p.select({
                message: 'The song',
                initialValue: a.songSource,
                options: [
                    {value: 'file' as const, label: 'I have it as an audio file', hint: 'wav or mp3'},
                    {value: 'idea' as const, label: 'Generate it from a song idea', hint: 'the LLM writes the lyrics'},
                    {value: 'lyrics' as const, label: 'Generate it from my own lyrics', hint: 'set to music as they are'},
                ],
            }))
            a.songFile = a.idea = a.ownLyrics = a.musicStyle = undefined
            if (hasSong()) {
                a.songFile = answer(await p.text({
                    message: 'Path to the audio file (wav or mp3)',
                    validate: value => {
                        if (!value) return 'required'
                        if (!existsSync(value)) return 'file not found'
                        if (!/\.(wav|mp3)$/i.test(value)) return 'must be .wav or .mp3'
                    },
                }))
                return
            }
            log.info(`No song yet - it will be generated with the ${defaults.songWorkflow} workflow`)
            if (a.songSource === 'idea') a.idea = await askText('Song idea', {required: true})
            else {
                log.info(styles.muted('Section tags on their own line - [Verse], [Chorus], [Bridge], ... - and a blank line between sections'))
                a.ownLyrics = await askText('Lyrics', {required: true})
            }
            a.musicStyle = await askText('Musical style hint (genre, mood, instruments - optional, the LLM invents one otherwise)')
        },
    },
    // the language a generated song's lyrics are written and sung in - and for every song the one the lyrics are aligned in
    language: {
        label: () => 'Language',
        summary: () => `${a.language} (${languageName(a.language)})`,
        ask: async () => {
            a.language = answer(await p.text({
                message: a.songSource === 'idea' ? 'Language to write the lyrics in (ISO 639-1 code: en, de, ja, ...)' : 'Language of the lyrics (ISO 639-1 code: en, de, ja, ...)',
                initialValue: a.language,
                validate: value => languageName(value ?? '') ? undefined : `unknown language code "${value}"`,
            }))
            log.info(styles.muted(languageName(a.language)!))
        },
    },
    // who sings: a generated song is sung in that voice (the YuE2 tags), and the story casts its singers to match it
    voice: {
        label: () => 'Voice',
        summary: () => ({auto: 'left open', female: 'a woman', male: 'a man', mixed: 'a duet - a woman and a man'})[a.singerVoice],
        then: ['singers'],
        ask: async () => {
            a.singerVoice = answer(await p.select<SingerVoice>({
                message: hasSong() ? 'Who sings in the song?' : 'Who should sing the song?',
                initialValue: a.singerVoice,
                options: [
                    {value: 'auto', label: hasSong() ? 'Leave it open' : 'Leave it to the LLM', hint: hasSong() ? 'the story decides - also for an instrumental' : 'the LLM picks the voice'},
                    {value: 'female', label: 'A woman', hint: 'female vocals'},
                    {value: 'male', label: 'A man', hint: 'male vocals'},
                    {value: 'mixed', label: 'A duet - a woman and a man'},
                ],
            }))
        },
    },
    // lyrics/story: required when there's already a song (index.ts throws otherwise) - when generating one, the lyrics
    // are there (given, or written by index.ts from the idea), but a story idea on top still helps the story stay close
    // to what you want
    texts: {
        label: () => hasSong() ? 'Lyrics / story' : 'Story idea',
        summary: () => [a.lyrics && `lyrics "${short(a.lyrics)}"`, a.storyIdea && `story idea "${short(a.storyIdea)}"`].filter(Boolean).join(', ') || 'none',
        then: ['singers'],
        ask: async () => {
            const choice = answer(await p.select({
                message: hasSong() ? 'Lyrics and/or a story idea (at least one)' : `A story idea on top of the ${a.idea ? 'generated ' : ''}lyrics? (optional)`,
                options: hasSong() ? [
                    {value: 'lyrics', label: 'Lyrics'},
                    {value: 'story', label: 'Story idea'},
                    {value: 'both', label: 'Both'},
                ] : [
                    {value: 'story', label: 'Yes, add a story idea'},
                    {value: 'none', label: 'No - let the lyrics carry the story'},
                ],
            }))
            a.lyrics = choice === 'lyrics' || choice === 'both' ? await askText('Lyrics', {required: true}) : undefined
            a.storyIdea = choice === 'story' || choice === 'both' ? await askText('Story idea', {required: true}) : undefined
        },
    },
    // singers, right after the voice and the lyrics they follow. A voice given makes "the LLM picks" the default: in clip
    // mode the voice only shapes the story, nobody is seen singing.
    singers: {
        label: () => 'Seen singing',
        summary: () => !canSing() ? 'nobody - no lyrics (clip mode)' : a.singerMode === 'none' ? 'nobody (clip mode)' : a.singerMode === 'auto' ? 'the LLM picks' : a.singerNames.join(', '),
        ask: async () => {
            if (!canSing()) {
                a.singerMode = 'none'
                log.info('No lyrics, so nobody can sing - the song just plays (clip mode). Add input/lyrics.txt and "singers" in config.json later to change that.')
                return
            }
            const voice = a.singerVoice
            a.singerMode = answer(await p.select({
                message: 'Who is seen singing?',
                initialValue: voice === 'auto' ? 'none' as const : 'auto' as const,
                options: [
                    {value: 'none' as const, label: 'Nobody - the song just plays (clip mode)', hint: voice === 'auto' ? 'default' : 'the voice only shapes the story'},
                    {value: 'auto' as const, label: 'Let the LLM pick the singers', hint: voice === 'mixed' ? 'one woman and one man' : voice === 'auto' ? undefined : `${voice} characters`},
                    {value: 'named' as const, label: 'Name the singer(s)'},
                ],
            }))
            if (a.singerMode !== 'named') return
            const names = answer(await p.text({
                message: voice === 'mixed' ? 'The two singers, comma-separated - a woman and a man the story creates' : 'Singer name(s), comma-separated - must match characters the story creates',
                initialValue: a.singerNames.join(', '),
                validate: value => {
                    const count = splitNames(value ?? '').length
                    if (!count) return 'required'
                    if (voice === 'mixed' && count !== 2) return 'a duet: exactly two names'
                },
            }))
            a.singerNames = splitNames(names)
        },
    },
    style: {
        label: () => 'Visual style',
        summary: () => a.style ? short(a.style) : 'picked by the first run',
        ask: async () => { a.style = await askStyle() },
    },
    length: {
        label: () => 'Song length',
        shown: () => !hasSong(),
        summary: () => a.songDuration ? `${a.songDuration} s` : a.preset === 'quick' ? '60 s (quick test)' : 'the workflow default',
        ask: async () => {
            a.songDuration = Number(answer(await p.text({
                message: 'Target song length in seconds (the workflow\'s own default otherwise)',
                placeholder: 'default',
                initialValue: a.songDuration ? String(a.songDuration) : '',
                validate: value => !value || (Number.isFinite(Number(value)) && Number(value) > 0) ? undefined : 'a positive number, or empty',
            }))) || undefined
        },
    },
    // the clips' aspect ratio - characters stay portrait and places landscape, only the clips change
    aspect: {
        label: () => 'Aspect ratio',
        summary: () => a.videoAspect,
        ask: async () => {
            const known = ['16:9', '9:16', '2:1', '2:3']
            const aspect = answer(await p.select({
                message: 'Aspect ratio of the video',
                initialValue: known.includes(a.videoAspect) ? a.videoAspect : 'other',
                options: [
                    {value: '16:9', label: '16:9 landscape', hint: 'default'},
                    {value: '9:16', label: '9:16 portrait', hint: 'social media'},
                    {value: '2:1', label: '2:1 wide'},
                    {value: '2:3', label: '2:3 portrait, less tall'},
                    {value: 'other', label: 'Another ratio'},
                ],
            }))
            a.videoAspect = aspect !== 'other' ? aspect : answer(await p.text({
                message: 'Aspect ratio (WIDTH:HEIGHT)',
                placeholder: '4:3',
                validate: v => v && /^[1-9]\d*:[1-9]\d*$/.test(v) ? undefined : 'e.g. 4:3',
            }))
        },
    },
    // render settings: a preset, or every one of them asked
    render: {
        label: () => 'Render settings',
        summary: () => a.preset === 'custom'
            ? `${a.imageWorkflow} (${resolutionText(a.imageResolution)}), ${a.videoWorkflow} (${resolutionText(a.videoResolution)})${a.continuity === 'never' ? '' : `, continuity ${a.continuity}`}`
            : ({defaults: 'defaults', quick: 'quick test', quality: 'quality - two-pass at 2 MP'})[a.preset],
        ask: async () => {
            a.preset = answer(await p.select({
                message: 'Render settings',
                initialValue: a.preset,
                options: [
                    {value: 'defaults' as const, label: 'Defaults', hint: `${defaults.imageWorkflow}, ${defaults.videoWorkflow}, the workflows' own resolution`},
                    {value: 'quick' as const, label: 'Quick test', hint: `flat pictures instead of reference sheets, 0.5 MP clips${hasSong() ? '' : ', a 60 s song unless a length was given'}`},
                    {value: 'quality' as const, label: 'Quality', hint: 'two-pass clips at 2 MP - slower'},
                    {value: 'custom' as const, label: 'Custom', hint: 'image/video workflow, resolution and continuity, one by one'},
                ],
            }))
            if (a.preset !== 'custom') return
            a.imageWorkflow = await askWorkflow('Image workflow', 'image')
            a.videoWorkflow = await askWorkflow('Video workflow', 'video')
            a.imageResolution = await askResolution('Image resolution')
            // the two-pass workflow takes videoResolution as its final size, pass 1 renders a quarter of it
            a.videoResolution = await askResolution(a.videoWorkflow.endsWith('-2pass') ? 'Video resolution (the final size - pass 1 renders a quarter of it)' : 'Video resolution')
            // clips that run on without a cut: a continuing clip starts on the last frame of the one before, so a take
            // can be longer than one clip - and whatever that clip drifted to is where the next one starts (README
            // "Continuous scenes"), hence off by default
            a.continuity = answer(await p.select({
                message: 'Clips that run on without a cut (continuity)',
                initialValue: a.continuity,
                options: [
                    {value: 'never' as const, label: 'Never - every clip is its own cut', hint: 'default'},
                    {value: 'auto' as const, label: 'Where the story marks one unbroken take', hint: 'a long walk, a slow reveal'},
                    {value: 'always' as const, label: 'Always - every clip but a beat\'s first goes on from the one before'},
                ],
            }))
            if (a.continuity !== 'never') log.info(styles.muted('A continuing clip starts on the last frame of the clip before - a drift in it (a double, a sliding wall patch) carries on. Suits shots with real movement, not a held pose.'))
        },
    },
}
const shown = (key: string) => steps[key]!.shown?.() ?? true

for (const key of Object.keys(steps)) if (shown(key)) await steps[key]!.ask()

// the summary: write, change one answer (and what follows from it), or cancel
while (true) {
    const keys = Object.keys(steps).filter(shown)
    p.note(keys.map(k => `${styles.muted(steps[k]!.label().padEnd(16))}${steps[k]!.summary()}`).join('\n'), 'The new project')
    const next = answer(await p.select({
        message: 'Write it?',
        maxItems: 14,
        options: [
            {value: 'write', label: `Write projects/${a.id}/`},
            ...keys.map(k => ({value: k, label: `Change: ${steps[k]!.label()}`})),
            {value: 'cancel', label: 'Cancel - write nothing'},
        ],
    }))
    if (next === 'write') break
    if (next === 'cancel') {
        log.cancel('Cancelled - nothing written')
        process.exit(1)
    }
    await steps[next]!.ask()
    for (const key of steps[next]!.then ?? []) if (shown(key)) await steps[key]!.ask()
}

const config: Partial<ProjectConfig> = {}
if (a.language !== defaults.lyricsLanguage) config.lyricsLanguage = a.language
if (a.singerVoice !== defaults.singerVoice) config.singerVoice = a.singerVoice
if (canSing() && a.singerMode === 'auto') config.singers = ['auto']
if (canSing() && a.singerMode === 'named') config.singers = a.singerNames
if (!hasSong() && a.songDuration) config.songDuration = a.songDuration
if (a.videoAspect !== defaults.videoAspect) config.videoAspect = a.videoAspect as `${number}:${number}`
if (a.preset === 'quick') {
    config.sequenceSheets = false
    config.videoResolution = 0.5
    if (!hasSong() && !a.songDuration) config.songDuration = 60
}
if (a.preset === 'quality') config.videoWorkflow = 'h3-ref2video-2pass'
if (a.preset === 'custom') {
    if (a.imageWorkflow !== defaults.imageWorkflow) config.imageWorkflow = a.imageWorkflow
    if (a.videoWorkflow !== defaults.videoWorkflow) config.videoWorkflow = a.videoWorkflow
    // the default resolution of the workflow is not stored - a later change of workflow keeps its own default
    if (a.imageResolution !== -1) config.imageResolution = a.imageResolution
    if (a.videoResolution !== -1) config.videoResolution = a.videoResolution
    if (a.continuity !== defaults.continuity) config.continuity = a.continuity
}

const id = a.id
log.info(`Writing ${styles.muted(`projects/${id}/`)}`)
await writeProject(id, {songFile: a.songFile, idea: a.idea, lyrics: a.ownLyrics ?? a.lyrics, storyIdea: a.storyIdea, style: a.style, musicStyle: a.musicStyle, config})
log.output(`projects/${id}/`)

// start it right away - the whole run, or only the song to listen to first (a generated song is the cheap step to judge
// before hours of rendering); the command is printed either way, for later
const render = hasSong() ? 'images,videos,final' : 'song,images,videos,final'
const start = answer(await p.select({
    message: 'Start it now?',
    initialValue: hasSong() ? 'no' : 'song',
    options: [
        ...(hasSong() ? [] : [{value: 'song', label: 'Only generate the song now', hint: 'listen to it first'}]),
        {value: 'all', label: 'Start the whole run now', hint: `--render=${render}`},
        {value: 'no', label: 'Not now'},
    ],
}))
if (start === 'no') {
    log.next(`bun index.ts ${id} --render=${render}`)
    process.exit(0)
}
const run = start === 'song' ? 'song' : render
log.success(`Created - running bun index.ts ${id} --render=${run}`)
const result = Bun.spawnSync(['bun', 'index.ts', id, `--render=${run}`], {stdio: ['inherit', 'inherit', 'inherit']})
if (result.exitCode === 0 && start === 'song') log.info(`\nSong ready - listen to projects/${id}/input/song.wav, then continue with:\n\n  bun index.ts ${id} --render=images,videos,final\n`)
if (result.exitCode !== 0) log.info(`\nThe run stopped - start it again with:\n\n  bun index.ts ${id} --render=${run}\n`)
process.exit(result.exitCode ?? 1)

/** The first line of a text, cut to a few words - for the summary. */
function short(text: string | undefined) {
    const first = (text ?? '').split('\n').find(l => l.trim())?.trim() ?? ''
    return first.length > 40 ? `${first.slice(0, 40)}…` : first
}

function splitNames(value: string) {
    return value.split(',').map(n => n.trim()).filter(Boolean)
}

function resolutionText(r: Resolution) {
    return r === -1 ? 'workflow default' : typeof r === 'number' ? `${r} MP` : r
}

// cancelled with Ctrl+C / Esc
function answer<T>(value: T): Exclude<T, symbol> {
    if (p.isCancel(value)) {
        log.cancel('Cancelled - nothing written')
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
    log.prompt(styles.muted(`  ${label} - end with two empty lines (press Enter twice when done):`))
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
