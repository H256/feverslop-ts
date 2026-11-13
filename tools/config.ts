import {cli} from '../lib/cli.ts'
import {extraArgument} from '../lib/command-schema.ts'
// The render settings of a music video or film - config.json - as the workspace's Settings page has them (#576): printed, or changed with
// --set=key=value (more than once), a key taken back to its default with --unset=key. A change is checked as the loader checks it, and
// says what it makes stale - which rendered clips and pictures; nothing is rendered or planned by it. Other keys of config.json
// (singers, language, ...) are edited where they belong, or by hand.
// usage: bun run config <project-id> [--film] [--json] [--set=videoWorkflow=h3-ref2video-prism-2pass] [--unset=seed]
import {parseArgs} from 'node:util'
import {log, styles} from '../lib/log.ts'
import {commandTarget} from '../lib/editor/preproduction.ts'
import {previewConfig, readConfig, writeConfig, type ConfigChange} from '../lib/editor/projectconfig.ts'
cli('config')

const usage = 'usage: bun run config <project-id> [--film] [--json] [--set=<setting>=<value>]... [--unset=<setting>]...'
const {values: args, positionals} = (() => {
    try {
        return parseArgs({
            args: Bun.argv.slice(2),
            allowPositionals: true,
            options: {
                film: {type: 'boolean', default: false},
                json: {type: 'boolean', default: false},
                set: {type: 'string', multiple: true},
                unset: {type: 'string', multiple: true},
            },
        })
    } catch (e) {
        return log.usageError(e instanceof Error ? e.message : String(e), usage)
    }
})()
// a word more than it takes is said before any work (#938)
const extra = extraArgument(positionals, ['a project id'])
if (extra) log.usageError(extra, usage)
const target = commandTarget(positionals[0], args.film)
if (typeof target === 'string') log.usageError(target, usage)
const t = target as Exclude<typeof target, string>
const show = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value))

if (args.set?.length || args.unset?.length) {
    // 7 is a number, false is false, h3-ref2video a name, 16:9 a ratio: what is no JSON is the text itself
    const change: ConfigChange = {}
    for (const entry of args.set ?? []) {
        const at = entry.indexOf('=')
        if (at < 1) log.usageError(`--set takes <setting>=<value>, got "${entry}"`, usage)
        const text = entry.slice(at + 1)
        change[entry.slice(0, at)] = (() => {
            try {
                return JSON.parse(text)
            } catch {
                return text
            }
        })()
    }
    for (const key of args.unset ?? []) change[key] = null
    const before = new Map((await readConfig(t)).settings.map(s => [s.key, s.value]))
    const impact = await previewConfig(t, change)
    if (impact.problems.length) log.usageError(`${impact.problems.join('\n')}\nnothing is written`, usage)
    if (!impact.changed.length) {
        log.success('the settings are the same - nothing changed')
    } else {
        const result = await writeConfig(t, change)
        const now = new Map((await readConfig(t)).settings.map(s => [s.key, s.value]))
        for (const key of result.changed) log.step(key, `${show(before.get(key))} ${styles.muted('→')} ${show(now.get(key))}`)
        for (const note of result.notes) log.warn(note)
        const {clips, pictures} = result.stale
        if (clips.length || pictures.length) {
            log.step(
                'Stale',
                `${[clips.length && `${clips.length} of ${result.rendered.clips} rendered clips`, pictures.length && `${pictures.length} of ${result.rendered.pictures} rendered pictures`].filter(Boolean).join(' and ')} would be made from something else now ${styles.muted('- nothing is rendered by this')}`,
            )
            log.next(
                `${t.kind === 'film' ? 'bun film.ts' : 'bun index.ts'} ${t.id} --render=${pictures.length ? 'images,videos' : 'videos'} --refresh=${pictures.length ? 'pictures,clips' : 'clips'}`,
            )
        }
        log.success('config.json is saved')
    }
} else if (args.json) {
    console.log(JSON.stringify(Object.fromEntries((await readConfig(t)).settings.map(s => [s.key, s.value])), null, 2))
} else {
    let group = ''
    for (const setting of (await readConfig(t)).settings) {
        if (setting.group !== group) log.info(`\n${styles.name((group = setting.group))}`)
        log.info(`   ${setting.key.padEnd(20)} ${show(setting.value)}${setting.own ? '' : styles.muted('  (default)')}`)
    }
    log.next(
        `bun run config ${t.id}${t.kind === 'film' ? ' --film' : ''} --set=<setting>=<value>   (--unset=<setting> takes it back to the default; --json prints the values)`,
    )
}
