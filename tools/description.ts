import {noProject} from '../lib/usage.ts'
import {cli} from '../lib/cli.ts'
// The text for publishing a finished video on YouTube (#805, docs/postwork.md): the video you choose, a teaser of its story,
// that it is AI-generated and what FeverSlop TS is, and how it was made - the graphics cards, the models, the measured time
// per phase - collected from the project and its measurements. Writes <video>.youtube.txt (to paste into YouTube Studio)
// and <video>.youtube.json (title, description, tags) next to the video. Nothing is uploaded.
// usage: bun run description <id> [--film] [--from=<video>] [--no-story] [--new-story] [--no-facts] [--hardware=] [--line=TEXT]...
//        [--no-lines] [--tag=TAG]... [--no-tags] [--save | --save-default] [--dry-run]
import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {basename, join} from 'node:path'
import {parseArgs} from 'node:util'
import {probeVideo} from '../lib/assemble.ts'
import {loadProjectConfig} from '../lib/config.ts'
import {loadFilmConfig} from '../lib/film/config.ts'
import {filmDir, filmExists, filmIds} from '../lib/film/setup.ts'
import {ask, configureLlm} from '../lib/llm.ts'
import {log, styles} from '../lib/log.ts'
import type {DescriptionSettings} from '../lib/postwork/config.ts'
import {collectFacts, projectTitle} from '../lib/postwork/credits.ts'
import {descriptionText, factsFor, phaseTimes, publishableVideos, storySource, storyTitle, teaserPrompt} from '../lib/postwork/description.ts'
import {loadPostwork, savePostwork, withOptions} from '../lib/postwork/store.ts'
import {projectDir, projectExists, listProjects} from '../lib/project-setup.ts'
import {loadSettings, readSettingsFile} from '../lib/settings.ts'
import {readTimings} from '../lib/timings.ts'
cli('description')

const usage =
    'usage: bun run description <id> [--film] [--from=<video>] [--no-story] [--new-story] [--no-facts] [--hardware=] [--line=TEXT]... [--no-lines] [--tag=TAG]... [--no-tags] [--save | --save-default] [--dry-run]'
const {
    values: args,
    positionals: [id],
} = (() => {
    try {
        const flag = {type: 'boolean'} as const
        return parseArgs({
            args: Bun.argv.slice(2),
            allowPositionals: true,
            options: {
                film: {type: 'boolean', default: false},
                from: {type: 'string'},
                story: flag,
                'no-story': flag,
                'new-story': flag,
                facts: flag,
                'no-facts': flag,
                hardware: {type: 'string'},
                line: {type: 'string', multiple: true},
                'no-lines': flag,
                tag: {type: 'string', multiple: true},
                'no-tags': flag,
                save: {type: 'boolean', default: false},
                'save-default': {type: 'boolean', default: false},
                'dry-run': {type: 'boolean', default: false},
            },
        })
    } catch (e) {
        return log.usageError(e instanceof Error ? e.message : String(e), usage)
    }
})()
if (!id || !(args.film ? filmExists(id) : projectExists(id)))
    log.usageError(args.film ? noProject('film', id, filmIds()) : noProject('project', id, listProjects()), usage)
const dir = args.film ? filmDir(id!) : projectDir(id!)
const kind = args.film ? ('film' as const) : ('music' as const)

// the video to publish is yours to choose: with only one there is nothing to choose, with more the command lists them
const videos = publishableVideos(dir, id!)
const chosen = (() => {
    if (args.from !== undefined) {
        const found = videos.find(v => v.name === args.from)
        if (found) return found
        return log.usageError(`--from: ${args.from} is no finished video of ${id} - there are: ${videos.map(v => v.name).join(', ') || 'none'}`, usage)
    }
    if (videos.length === 1) return videos[0]!
    if (!videos.length) return log.usageError(`${id} has no finished video yet - render it first`, usage)
    return log.usageError(`Which video do you publish? Say it with --from=<file>:\n${videos.map(v => `  ${v.name}`).join('\n')}`, usage)
})()
const video = join(dir, chosen.name)

const onOff = (on: boolean | undefined, off: boolean | undefined) => (off ? false : on ? true : undefined)
const given: Partial<DescriptionSettings> = {
    story: onOff(args.story, args['no-story']),
    facts: onOff(args.facts, args['no-facts']),
    hardware: args.hardware,
    extra: args['no-lines'] ? [] : args.line,
    tags: args['no-tags'] ? [] : args.tag?.map(t => t.replace(/^#/, '')),
}
const {settings, credits} = await (async () => {
    try {
        const all = await loadPostwork(dir)
        return {settings: withOptions('description', all.description, given), credits: all.credits}
    } catch (e) {
        return log.usageError((e as Error).message, usage)
    }
})()

// the title the credits have; a music video without one set: the heading of its story, not its id
const title = kind === 'music' && !credits.title.trim() ? (storyTitle(dir) ?? id!) : projectTitle(dir, kind, id!, credits.title)
const timings = readTimings()
const {version} = (await Bun.file(join(import.meta.dir, '..', 'package.json')).json()) as {version: string}
const facts = settings.facts ? factsFor(collectFacts(dir, {timings, version, fallbackLlm: (await readSettingsFile()).llm?.model}), chosen.parts) : undefined
const info = await probeVideo(video).catch(() => undefined)
const project = basename(dir)
const target = video.replace(/\.mp4$/, '.youtube')

// the teaser: the one written before for this video, unless a new one is asked for - so a run for other tags keeps it
const earlier = (() => {
    try {
        return existsSync(`${target}.json`) ? (JSON.parse(readFileSync(`${target}.json`, 'utf8')) as {story?: string}).story : undefined
    } catch {
        return undefined
    }
})()
async function teaser(): Promise<string | undefined> {
    if (!settings.story) return undefined
    if (earlier && !args['new-story']) return earlier
    const source = storySource(dir, kind)
    if (!source) {
        log.warn('No summary of the story in project.json: the description goes without a teaser.')
        return undefined
    }
    if (args['dry-run']) return '(a teaser of the story, written by the language model)'
    const model = args.film ? (await loadFilmConfig(dir)).llm.model : (await loadProjectConfig(dir)).llm.model
    configureLlm((await loadSettings({projectModel: model})).llm)
    try {
        return (await ask(teaserPrompt(title, kind, source))).trim().replace(/^["“]|["”]$/g, '')
    } catch (e) {
        log.warn(`The language model wrote no teaser (${(e as Error).message}): the description goes without one.`)
        return undefined
    }
}
const story = await teaser()

const text = descriptionText(
    {
        title,
        kind,
        ...(story ? {story} : {}),
        ...(facts ? {facts} : {}),
        phases: phaseTimes(timings, project),
        parts: chosen.parts,
        ...(info ? {video: {width: info.width, height: info.height, fps: info.fps, seconds: info.frames / info.fps}} : {}),
        aiSong: timings.some(t => t.project === project && t.kind === 'song' && !t.outcome),
    },
    settings,
)

log.step('Video', chosen.name)
log.step('Title', text.title)
log.step('Tags', text.tags.map(t => `#${t}`).join(' ') || styles.muted('none'))
for (const line of text.description.split('\n')) log.info(styles.muted(`    ${line}`))
for (const warning of text.warnings) log.warn(warning)

if (args['dry-run']) {
    log.step('Dry run', styles.muted('nothing written'))
    process.exit(0)
}
if (args.save || args['save-default']) {
    const where = await savePostwork(args['save-default'] ? 'settings' : 'project', dir, 'description', given)
    log.step('Kept', styles.muted(`the options given, in ${where}`))
}
writeFileSync(`${target}.txt`, `${text.description}\n`)
writeFileSync(
    `${target}.json`,
    `${JSON.stringify({video: chosen.name, title: text.title, description: text.description, tags: text.tags, ...(story ? {story} : {}), containsSyntheticMedia: true}, null, 2)}\n`,
)
log.step('Saved', `${basename(target)}.txt ${styles.muted(`and .json next to ${chosen.name}`)}`)
log.warn('On upload, set "Altered or synthetic content" to Yes in YouTube Studio - the description alone does not count as the disclosure.')
