import {noProject} from '../lib/usage.ts'
import {cli} from '../lib/cli.ts'
// A clip in front of a finished video (#608, docs/postwork.md): a logo, a channel ident, a title card. Reads one final video
// of the project and writes <name>-intro.mp4 next to it; the intro takes the size and frame rate of the video. The intro
// is input/intro.mp4 of the project, or the path in "postwork": {"intro": {"file": ...}} of the settings file or config.json,
// or --file=; --save keeps the options for the project, --save-default for every project.
// usage: bun run intro <id> [--film] [--from=<video>] [--file=<video>] [--fade=0.5] [--save | --save-default] [--dry-run]
import {basename, join} from 'node:path'
import {parseCommand, usageOf} from '../lib/command-schema.ts'
import {introCommand} from '../lib/postwork/commands.ts'
import {versionStamp} from '../lib/archive.ts'
import {probeVideo} from '../lib/assemble.ts'
import {filmDir, filmExists, filmIds} from '../lib/film/setup.ts'
import {lockProject} from '../lib/lock.ts'
import {keepLogIn, log, styles} from '../lib/log.ts'
import {introFile, type IntroSettings} from '../lib/postwork/config.ts'
import {introFilter, introVideo} from '../lib/postwork/intro.ts'
import {loadPostwork, savePostwork, withOptions} from '../lib/postwork/store.ts'
import {sourceVideo} from '../lib/postwork/video.ts'
import {projectDir, projectExists, listProjects} from '../lib/project-setup.ts'
import {beginRun} from '../lib/run-record-view.ts'
cli('intro')

const usage = usageOf(introCommand)
const args = (() => {
    try {
        return parseCommand(introCommand, Bun.argv.slice(2))
    } catch (e) {
        return log.usageError(e instanceof Error ? e.message : String(e), usage)
    }
})()
const [id] = args.positionals
const film = args.flag('film')
if (!id || !(film ? filmExists(id) : projectExists(id)))
    log.usageError(film ? noProject('film', id, filmIds()) : noProject('project', id, listProjects()), usage)
const dir = film ? filmDir(id!) : projectDir(id!)

const given: Partial<IntroSettings> = {file: args.text('file'), fade: args.number('fade')}
const {intro, source, clip} = await (async () => {
    try {
        const intro = withOptions('intro', (await loadPostwork(dir)).intro, given)
        return {intro, source: sourceVideo(dir, id!, args.text('from')), clip: introFile(intro.file, dir)}
    } catch (e) {
        return log.usageError((e as Error).message, usage)
    }
})()

log.step('Intro', `${clip.startsWith(dir) ? clip.slice(dir.length + 1) : clip} ${styles.muted(intro.fade > 0 ? `- fades in ${intro.fade} s` : '- a hard cut')}`)
log.step('From', basename(source))

if (args.flag('dry-run')) {
    const [main, introInfo] = await Promise.all([probeVideo(source), probeVideo(clip)])
    log.step(
        'Filter',
        styles.muted(
            introFilter(
                {
                    width: main.width,
                    height: main.height,
                    fps: main.fps,
                    introSeconds: introInfo.frames / introInfo.fps,
                    introAudio: introInfo.hasAudio,
                    videoAudio: main.hasAudio,
                },
                intro,
            ),
        ),
    )
    log.step('Dry run', styles.muted('nothing written'))
    process.exit(0)
}

lockProject(dir, id!)
keepLogIn(join(dir, 'logs', `${versionStamp()}.log`))
beginRun(dir, 'tools/intro.ts')
if (args.flag('save') || args.flag('save-default')) {
    const where = await savePostwork(args.flag('save-default') ? 'settings' : 'project', dir, 'intro', given)
    log.step('Kept', styles.muted(`the options given, in ${where}`))
}
const done = await introVideo(source, clip, intro)
log.step('Saved', `${basename(done.file)} ${styles.muted(`- ${done.seconds.toFixed(1)} s of intro in front of ${basename(source)}`)}`)
