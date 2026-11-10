import {existsSync, readdirSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import type {Timing} from '../timings.ts'
import type {DescriptionSettings} from './config.ts'
import type {CreditFacts} from './credits.ts'
import {finalParts, type FinalParts} from './video.ts'

// The text for publishing a finished video on YouTube (#805, docs/postwork.md): written next to the video the user chose,
// to be pasted into YouTube Studio by hand - nothing is uploaded. What it was made with and how long that took is
// collected by code from the measurements (the same facts as the credits); only the teaser of the story is written by the
// language model, and it is left out when that fails. A fact that is not known is left out, nothing is guessed.

/** YouTube's limits: the title, the description, all tags together. */
export const YOUTUBE_LIMITS = {title: 100, description: 5000, tags: 500}

/** The paragraph on the program and that the video is AI-generated, when the settings have none of their own. */
// one line per paragraph: YouTube wraps the text itself, a break inside a sentence would show as one
export const DEFAULT_ABOUT = [
    [
        'Made with FeverSlop TS, a home-grown pipeline that turns a song or a story idea into a film: a local language model',
        'writes the story, the cast and every shot, ComfyUI renders the pictures and the clips, and ffmpeg cuts it all to the',
        'music. Nobody stood behind a camera.',
    ].join(' '),
    [
        'FeverSlop is short for fever-dream AI slop, and we know what this is: an experiment in how far machines can dream a',
        'video on their own - odd hands, melting backgrounds and all. Any resemblance to real persons is unintended.',
    ].join(' '),
].join('\n\n')

/** The videos of a project that can be published: every final one by its name, the low-resolution preview left out. */
export function publishableVideos(dir: string, id: string): {name: string; parts: FinalParts}[] {
    if (!existsSync(dir)) return []
    return readdirSync(dir)
        .flatMap(name => {
            const parts = finalParts(id, name)
            return parts && !parts.preview ? [{name, parts}] : []
        })
        .sort((a, b) => a.name.localeCompare(b.name))
}

/** One phase of the work and the time measured for it. */
export type PhaseTime = {what: string; seconds: number; jobs: number; failedSeconds: number; failed: number}

const PHASES: {what: string; kind: Timing['kind']}[] = [
    {what: 'Planning (language model)', kind: 'llm'},
    {what: 'Pictures and reference sheets', kind: 'picture'},
    {what: 'Song', kind: 'song'},
    {what: 'Clips', kind: 'clip'},
    {what: 'Frame interpolation', kind: 'interpolation'},
]

/**
 * The measured time per phase of a project: the sum of the recorded durations - every job, re-renders of a clip included,
 * failed and retried attempts apart. Resumed jobs only have their wait and are left out. It is job time, not the time
 * that passed: jobs on several servers overlap.
 */
export function phaseTimes(timings: Timing[], project: string): PhaseTime[] {
    const mine = timings.filter(t => t.project === project && Number.isFinite(t.seconds) && t.seconds >= 0 && t.outcome !== 'resumed')
    return PHASES.flatMap(({what, kind}) => {
        const of = mine.filter(t => t.kind === kind)
        const ok = of.filter(t => !t.outcome || t.outcome === 'again')
        const bad = of.filter(t => t.outcome === 'failed' || t.outcome === 'retry')
        const sum = (list: Timing[]) => list.reduce((s, t) => s + t.seconds, 0)
        return ok.length || bad.length ? [{what, seconds: sum(ok), jobs: ok.length, failedSeconds: sum(bad), failed: bad.length}] : []
    })
}

/** "14 h 03 min", "12 min", "45 s" */
export function duration(seconds: number): string {
    const s = Math.round(seconds)
    if (s < 60) return `${s} s`
    const minutes = Math.round(s / 60)
    if (minutes < 60) return `${minutes} min`
    return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`
}

/** "5:02" */
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`

/** What the chosen video went through, by its name - in words. */
export function variantSteps(parts: FinalParts): string[] {
    return [
        ...(parts.variant ? [parts.variant === 'original' ? 'refinished' : `refinished (${parts.variant})`] : []),
        ...(parts.fps ? [`frame-interpolated to ${parts.fps} fps`] : []),
        ...(parts.finished ? ['graded and sharpened'] : []),
        ...parts.endings.map(e => ({labeled: 'with the EU AI marker', credits: 'with title card and credits', intro: 'with an intro'})[e]),
    ]
}

/** The facts as far as the chosen video went through them: no interpolation model for a 24 fps video, no upscaler without a refinish. */
export function factsFor(facts: CreditFacts, parts: FinalParts): CreditFacts {
    return {
        ...facts,
        models: facts.models.filter(m => (m.what === 'Frame interpolation' ? parts.fps > 0 : m.what === 'Upscaling' ? !!parts.variant : true)),
    }
}

export type DescriptionInput = {
    title: string
    kind: 'music' | 'film'
    story?: string // the teaser of the language model
    facts?: CreditFacts
    phases: PhaseTime[]
    parts: FinalParts
    video?: {width: number; height: number; fps: number; seconds: number}
    aiSong: boolean // the song was rendered too (measured song jobs)
}

export type Description = {title: string; description: string; tags: string[]; warnings: string[]}

/** The text for YouTube, block by block. */
export function descriptionText(input: DescriptionInput, s: DescriptionSettings): Description {
    const blocks: string[] = []
    if (input.story?.trim()) blocks.push(input.story.trim())
    const what = input.kind === 'film' ? 'short film' : 'music video'
    blocks.push(`This ${what} is entirely AI-generated: every picture and every movement${input.aiSong ? ', the song as well,' : ''} came out of AI models.`)
    blocks.push(s.about.trim() || DEFAULT_ABOUT)
    if (s.facts) {
        const made: string[] = []
        const f = input.facts
        const hardware = [...(f?.gpus ?? []), ...(s.hardware ? [s.hardware] : [])]
        if (hardware.length) made.push(`Rendered on: ${hardware.join(', ')}`)
        if (f?.llm.length) made.push(`Language model: ${f.llm.join(', ')}`)
        for (const m of f?.models ?? []) made.push(`${m.what}: ${m.names.join(', ')}`)
        if (input.phases.length) {
            made.push('', 'Measured compute time (all jobs, re-renders included - job time, not the time that passed):')
            const rows = input.phases.filter(p => p.what !== 'Frame interpolation' || input.parts.fps > 0)
            for (const p of rows) made.push(`- ${p.what}: ${duration(p.seconds)} (${p.jobs} ${p.what.startsWith('Planning') ? 'calls' : 'jobs'})`)
            const total = rows.reduce((sum, p) => sum + p.seconds, 0)
            made.push(`- Total: ${duration(total)}`)
            const failed = rows.reduce((sum, p) => sum + p.failedSeconds, 0)
            const failedJobs = rows.reduce((sum, p) => sum + p.failed, 0)
            if (failedJobs) made.push(`- Failed and retried attempts on top: ${duration(failed)} (${failedJobs})`)
        }
        if (input.video) {
            const v = input.video
            const steps = variantSteps(input.parts)
            made.push(
                '',
                `This video: ${v.width}×${v.height}, ${Math.round(v.fps * 100) / 100} fps, ${clock(v.seconds)}${steps.length ? ` - ${steps.join(', ')}` : ''}`,
            )
        }
        if (f?.software) made.push(`Made with: ${f.software}`)
        if (made.length) blocks.push(['How it was made', ...made].join('\n'))
    }
    if (s.extra.length) blocks.push(s.extra.join('\n'))
    if (s.tags.length) blocks.push(s.tags.map(t => `#${t}`).join(' '))
    const description = blocks.join('\n\n')
    const warnings = [
        ...(input.title.length > YOUTUBE_LIMITS.title ? [`the title has ${input.title.length} characters, YouTube takes ${YOUTUBE_LIMITS.title}`] : []),
        ...(description.length > YOUTUBE_LIMITS.description
            ? [
                  `the description has ${description.length} characters, YouTube takes ${YOUTUBE_LIMITS.description} - shorten your own text or leave out the facts`,
              ]
            : []),
        ...(s.tags.join(',').length > YOUTUBE_LIMITS.tags ? [`the tags have more than ${YOUTUBE_LIMITS.tags} characters together`] : []),
    ]
    return {title: input.title, description, tags: s.tags, warnings}
}

/** What the language model gets to write the teaser from: the project's summary (a film's logline before it). Undefined: nothing to go by. */
export function storySource(dir: string, kind: 'music' | 'film'): string | undefined {
    const file = join(dir, 'project.json')
    if (!existsSync(file)) return undefined
    try {
        const p = JSON.parse(readFileSync(file, 'utf8')) as {summary?: unknown; story?: unknown; brief?: {logline?: unknown}}
        const parts = [
            ...(kind === 'film' && typeof p.brief?.logline === 'string' ? [p.brief.logline] : []),
            ...(typeof p.summary === 'string' ? [p.summary] : typeof p.story === 'string' ? [p.story.slice(0, 4000)] : []),
        ]
        return parts.length ? parts.join('\n\n') : undefined
    } catch {
        return undefined
    }
}

/** A music video's title: the heading of its story ("# The Bone-Saw's Dirge"), else undefined. */
export function storyTitle(dir: string): string | undefined {
    try {
        const story = (JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')) as {story?: unknown}).story
        return typeof story === 'string' ? /^#\s+(.+)$/m.exec(story)?.[1]?.trim() : undefined
    } catch {
        return undefined
    }
}

/** The prompt of the teaser. */
export const teaserPrompt = (title: string, kind: 'music' | 'film', source: string) => ({
    instructions: [
        `You write the opening lines of a YouTube description for an AI-generated ${kind === 'film' ? 'short film' : 'music video'} called "${title}".`,
        'Write a teaser of two to four sentences in English: vivid, a little feverish and dreamlike, in the present tense.',
        'Tell what it is about and set the mood; do not give away the ending.',
        'No hashtags, no emojis, no links, no quotation marks around the text, and do not mention AI, models or how it was made - that follows below it.',
        'Answer with the teaser only.',
    ].join(' '),
    input: source,
    maxTokens: 2048,
    label: 'youtube teaser',
})
