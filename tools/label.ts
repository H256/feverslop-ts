import {noProject} from '../lib/usage.ts'
import {cli} from '../lib/cli.ts'
// The AI marker over a finished video (#607, docs/postwork.md): a PNG in a corner - the EU icon for AI-generated content, or
// one of your own - for the first seconds, at an interval or the whole time. Reads one final video of the project and writes
// <name>-labeled.mp4 next to it; nothing else of the project is touched. The settings: "postwork": {"label": {...}} in the
// settings file and the project's config.json, the options here beat both; --save keeps them for the project.
// usage: bun run label <id> [--film] [--from=<video>] [--marker=generated-white|<png>] [--mode=credits|interval|always]
//        [--seconds=5] [--interval=60] [--corner=top-right] [--size=6] [--margin=3] [--save | --save-default] [--dry-run]
import {basename, join} from 'node:path'
import {parseCommand, usageOf} from '../lib/command-schema.ts'
import {labelCommand} from '../lib/postwork/commands.ts'
import {filmDir, filmExists, filmIds} from '../lib/film/setup.ts'
import {lockProject} from '../lib/lock.ts'
import {keepLogIn, log, styles} from '../lib/log.ts'
import {versionStamp} from '../lib/archive.ts'
import {type LabelSettings, markerFile} from '../lib/postwork/config.ts'
import {labelFilter, labelVideo} from '../lib/postwork/label.ts'
import {loadPostwork, savePostwork, withOptions} from '../lib/postwork/store.ts'
import {sourceVideo} from '../lib/postwork/video.ts'
import {probeVideo} from '../lib/assemble.ts'
import {projectDir, projectExists, listProjects} from '../lib/project-setup.ts'
import {beginRun} from '../lib/run-record-view.ts'
cli('label')

const usage = usageOf(labelCommand)
const args = (() => {
    try {
        return parseCommand(labelCommand, Bun.argv.slice(2))
    } catch (e) {
        return log.usageError(e instanceof Error ? e.message : String(e), usage)
    }
})()
const [id] = args.positionals
const film = args.flag('film')
if (!id || !(film ? filmExists(id) : projectExists(id)))
    log.usageError(film ? noProject('film', id, filmIds()) : noProject('project', id, listProjects()), usage)
const dir = film ? filmDir(id!) : projectDir(id!)

const given: Partial<LabelSettings> = {
    marker: args.text('marker'),
    mode: args.text('mode') as LabelSettings['mode'] | undefined,
    corner: args.text('corner') as LabelSettings['corner'] | undefined,
    seconds: args.number('seconds'),
    interval: args.number('interval'),
    size: args.number('size'),
    margin: args.number('margin'),
}
const {label, source, marker} = await (async () => {
    try {
        const label = withOptions('label', (await loadPostwork(dir)).label, given)
        return {label, source: sourceVideo(dir, id!, args.text('from')), marker: markerFile(label.marker, dir)}
    } catch (e) {
        return log.usageError((e as Error).message, usage)
    }
})()

const when =
    label.mode === 'always'
        ? 'the whole time'
        : label.mode === 'credits'
          ? `the first ${label.seconds} s`
          : `${label.seconds} s at the start and every ${label.interval} s`
log.step('Marker', `${label.marker} ${styles.muted(`- ${label.corner}, ${label.size} % of the height, ${when}`)}`)
log.step('From', basename(source))

if (args.flag('dry-run')) {
    log.step('Filter', styles.muted(labelFilter(label, (await probeVideo(source)).height)))
    log.step('Dry run', styles.muted('nothing written'))
    process.exit(0)
}

lockProject(dir, id!)
keepLogIn(join(dir, 'logs', `${versionStamp()}.log`))
beginRun(dir, 'tools/label.ts')
if (args.flag('save') || args.flag('save-default')) {
    const where = await savePostwork(args.flag('save-default') ? 'settings' : 'project', dir, 'label', given)
    log.step('Kept', styles.muted(`the options given, in ${where}`))
}
const done = await labelVideo(source, marker, label)
log.step('Saved', `${basename(done.file)} ${styles.muted(`next to ${basename(source)}`)}`)
