// Creates a new project: asks for the song (or a song idea to generate one), lyrics and/or a story idea, and
// whether to customize the project settings - then writes projects/<id>/ and prints the command to run it.
// usage: bun run init
import * as p from "@clack/prompts";
import {existsSync} from "node:fs";
import {createInterface} from "node:readline/promises";
import type {Resolution} from "../comfy/helpers.ts";
import {defaults, languageName, type ProjectConfig} from "../lib/config.ts";
import {printBanner, styles} from "../lib/log.ts";
import {projectExists, validProjectId, writeProject} from "../lib/project-setup.ts";

if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log(`No terminal to ask in - create projects/<id>/input/ by hand instead:
  input/song.wav or song.mp3      a song you already have
  input/idea.txt                  or a song idea, for: bun index.ts <id> --render=song
  input/lyrics.txt and/or input/story-idea.txt   at least one, unless idea.txt writes the lyrics for you
  input/style.txt                 optional visual style
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

const hasSong = answer(await p.confirm({message: 'Do you already have the song (an audio file)?', initialValue: true}))

let songFile: string | undefined
let idea: string | undefined
let musicStyle: string | undefined
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
    p.log.step('No song yet - it will be generated with the yue2-song workflow from a song idea')
    idea = await askText('Song idea', {required: true})
    musicStyle = await askText('Musical style hint (genre, mood, instruments - optional, the LLM invents one otherwise)')
}

// lyrics/story: required when there's already a song (index.ts throws otherwise) - when generating one from an
// idea, index.ts writes lyrics.txt itself, but a story idea on top still helps the story stay close to what you want
const lyricsChoice = answer(await p.select({
    message: hasSong ? 'Lyrics and/or a story idea (at least one)' : 'A story idea on top of the generated lyrics? (optional)',
    options: hasSong ? [
        {value: 'lyrics', label: 'Lyrics'},
        {value: 'story', label: 'Story idea'},
        {value: 'both', label: 'Both'},
    ] : [
        {value: 'story', label: 'Yes, add a story idea'},
        {value: 'none', label: 'No - let the lyrics carry the story'},
    ],
}))
const lyrics = lyricsChoice === 'lyrics' || lyricsChoice === 'both' ? await askText('Lyrics', {required: true}) : undefined
const storyIdea = lyricsChoice === 'story' || lyricsChoice === 'both' ? await askText('Story idea', {required: true}) : undefined
const style = await askText('Visual style hint (optional - the look is designed from the story otherwise)')

// project settings
const config: Partial<ProjectConfig> = {}
if (!hasSong) config.songDuration = Number(answer(await p.text({
    message: 'Target song length in seconds (the workflow\'s own default otherwise)',
    placeholder: 'default',
    initialValue: '',
    validate: value => !value || (Number.isFinite(Number(value)) && Number(value) > 0) ? undefined : 'a positive number, or empty',
}))) || undefined

const customize = answer(await p.confirm({message: 'Customize the project settings (singers, resolution, ...)?', initialValue: false}))
if (customize) {
    const singerMode = answer(await p.select({
        message: 'Singers',
        options: [
            {value: 'none', label: 'None - the song just plays (clip mode)', hint: 'default'},
            {value: 'auto', label: 'Let the LLM pick who sings'},
            {value: 'named', label: 'Name the singer(s)'},
        ],
    }))
    if (singerMode === 'auto') config.singers = ['auto']
    if (singerMode === 'named') {
        const names = answer(await p.text({
            message: 'Singer name(s), comma-separated - must match characters the story creates',
            validate: value => value?.trim() ? undefined : 'required',
        }))
        config.singers = names.split(',').map(n => n.trim()).filter(Boolean)
    }

    const language = answer(await p.text({
        message: 'Lyrics language (ISO 639-1 code)',
        initialValue: defaults.lyricsLanguage,
        validate: value => languageName(value ?? '') ? undefined : `unknown language code "${value}"`,
    }))
    if (language !== defaults.lyricsLanguage) config.lyricsLanguage = language

    config.imageResolution = await askResolution('Image resolution')
    config.videoResolution = await askResolution('Video resolution')
}

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

/** Clack has no multiline prompt - reads plain lines until an empty one, after the current clack prompt closed. */
async function multiline(label: string): Promise<string> {
    console.log(styles.muted(`  ${label} - end with an empty line:`))
    const rl = createInterface({input: process.stdin})
    const lines: string[] = []
    for await (const line of rl) {
        if (line === '' && lines.length) break
        lines.push(line)
    }
    rl.close()
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
