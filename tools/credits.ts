import {noProject} from '../lib/usage.ts'
import {cli} from '../lib/cli.ts'
// A title card before a finished video and scrolling credits after it (#609, docs/postwork.md): the title, who made it, a line
// that it contains AI-generated content, your own lines, and what it was made with - the language model, the models of the
// workflows, the graphics cards - collected by code from the project and the measurements of its renders. Reads one final
// video of the project and writes <name>-credits.mp4 next to it. The settings: "postwork": {"credits": {...}} of the
// settings file and config.json; the options here beat both, --save keeps them for the project.
// usage: bun run credits <id> [--film] [--from=<video>] [--title=] [--artist=] [--director=] [--disclosure=] [--marker=]
//        [--line=TEXT]... [--hardware=] [--no-facts] [--no-opening] [--no-end] [--opening-seconds=4] [--end-seconds=0]
//        [--sound=<file>] [--font=<ttf>] [--save | --save-default] [--dry-run]
import {existsSync} from 'node:fs'
import {basename, isAbsolute, join} from 'node:path'
import {parseArgs} from 'node:util'
import {versionStamp} from '../lib/archive.ts'
import {filmDir, filmExists, filmIds} from '../lib/film/setup.ts'
import {lockProject} from '../lib/lock.ts'
import {keepLogIn, log, styles} from '../lib/log.ts'
import {type CreditsSettings, markerFile} from '../lib/postwork/config.ts'
import {probeVideo} from '../lib/assemble.ts'
import {collectFacts, creditLines, creditsVideo, DISCLOSURE_LENGTH, endSeconds, fontFiles, projectTitle, wrapLines} from '../lib/postwork/credits.ts'
import {loadPostwork, savePostwork, withOptions} from '../lib/postwork/store.ts'
import {sourceVideo} from '../lib/postwork/video.ts'
import {projectDir, projectExists, listProjects} from '../lib/project-setup.ts'
import {beginRun} from '../lib/run-record-view.ts'
import {readSettingsFile} from '../lib/settings.ts'
cli('credits')

const usage =
    'usage: bun run credits <id> [--film] [--from=<video>] [--title=] [--artist=] [--director=] [--disclosure=] [--marker=] [--line=TEXT]... [--hardware=] [--no-facts] [--no-opening] [--no-end] [--opening-seconds=4] [--end-seconds=0] [--sound=<file>] [--font=<ttf>] [--save | --save-default] [--dry-run]'
const {
    values: args,
    positionals: [id],
} = (() => {
    try {
        const text = {type: 'string'} as const
        const flag = {type: 'boolean'} as const
        return parseArgs({
            args: Bun.argv.slice(2),
            allowPositionals: true,
            options: {
                film: {type: 'boolean', default: false},
                from: text,
                title: text,
                artist: text,
                director: text,
                disclosure: text,
                marker: text,
                line: {type: 'string', multiple: true},
                'no-lines': flag,
                hardware: text,
                facts: flag,
                'no-facts': flag,
                opening: flag,
                'no-opening': flag,
                end: flag,
                'no-end': flag,
                'opening-seconds': text,
                'end-seconds': text,
                sound: text,
                font: text,
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

const numberOf = (name: string, value: string | undefined) => {
    if (value === undefined) return undefined
    const n = Number(value)
    return Number.isFinite(n) && value.trim() !== '' ? n : log.usageError(`--${name} must be a number, got "${value}"`, usage)
}
// --facts / --no-facts: either, or neither (the settings say it)
const onOff = (on: boolean | undefined, off: boolean | undefined) => (off ? false : on ? true : undefined)
const given: Partial<CreditsSettings> = {
    title: args.title,
    artist: args.artist,
    director: args.director,
    disclosure: args.disclosure,
    marker: args.marker,
    extra: args['no-lines'] ? [] : args.line,
    hardware: args.hardware,
    sound: args.sound,
    font: args.font,
    facts: onOff(args.facts, args['no-facts']),
    opening: onOff(args.opening, args['no-opening']),
    end: onOff(args.end, args['no-end']),
    openingSeconds: numberOf('opening-seconds', args['opening-seconds']),
    endSeconds: numberOf('end-seconds', args['end-seconds']),
}
const {credits, source, fonts, marker, sound} = await (async () => {
    try {
        const credits = withOptions('credits', (await loadPostwork(dir)).credits, given)
        if (!credits.opening && !credits.end) throw new Error('--no-opening and --no-end: nothing to add')
        const soundPath = credits.sound ? (isAbsolute(credits.sound) ? credits.sound : join(dir, credits.sound)) : undefined
        if (soundPath && !existsSync(soundPath))
            throw new Error(`sound: no file ${credits.sound} - the path of a sound file, absolute or relative to the project`)
        return {
            credits,
            source: sourceVideo(dir, id!, args.from),
            fonts: fontFiles(credits.font, dir),
            marker: credits.marker && credits.opening ? markerFile(credits.marker, dir) : undefined,
            sound: soundPath,
        }
    } catch (e) {
        return log.usageError((e as Error).message, usage)
    }
})()

const kind = args.film ? ('film' as const) : ('music' as const)
const {version} = (await Bun.file(join(import.meta.dir, '..', 'package.json')).json()) as {version: string}
const facts = credits.facts ? collectFacts(dir, {version, fallbackLlm: (await readSettingsFile()).llm?.model}) : undefined
const written = creditLines(credits, facts, {title: projectTitle(dir, kind, id!, credits.title), kind})
// as they are drawn on this video: a line too long for its picture is broken into several (drawtext does not wrap)
const picture = await probeVideo(source)
const lines = {opening: wrapLines(written.opening, picture.width, picture.height), end: wrapLines(written.end, picture.width, picture.height)}
if (credits.disclosure.length > DISCLOSURE_LENGTH)
    log.warn(
        `The disclosure has ${credits.disclosure.length} characters, more than the ${DISCLOSURE_LENGTH} recommended - it goes in as it is, over more lines.`,
    )

log.step('From', basename(source))
if (credits.opening)
    log.step('Title card', `${credits.openingSeconds} s ${styles.muted(`- ${lines.opening.map(l => l.text).join(' / ')}${marker ? ', with the marker' : ''}`)}`)
if (credits.end) {
    log.step(
        'Credits',
        `${endSeconds(credits, lines.end.length)} s ${styles.muted(`- ${lines.end.length} lines${sound ? `, ${basename(sound)} under them` : ''}`)}`,
    )
    // the text as it runs, to check it before it is drawn
    for (const line of lines.end) log.info(styles.muted(`    ${line.size === 'small' ? line.text.toUpperCase() : line.text}`))
}

if (args['dry-run']) {
    log.step('Dry run', styles.muted('nothing written'))
    process.exit(0)
}

lockProject(dir, id!)
keepLogIn(join(dir, 'logs', `${versionStamp()}.log`))
beginRun(dir, 'tools/credits.ts')
if (args.save || args['save-default']) {
    const where = await savePostwork(args['save-default'] ? 'settings' : 'project', dir, 'credits', given)
    log.step('Kept', styles.muted(`the options given, in ${where}`))
}
const done = await creditsVideo(source, {...(credits.opening ? {opening: lines.opening} : {}), ...(credits.end ? {end: lines.end} : {})}, credits, {
    ...fonts,
    marker,
    sound,
})
log.step('Saved', `${basename(done.file)} ${styles.muted(`next to ${basename(source)}`)}`)
