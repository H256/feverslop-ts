import {cli} from '../lib/cli.ts'
// Who plays each role and which picture each place has - casting.json, as the workspace's Casting page has it, CLI first (#548).
// Without an option: every role with its entry, what the next plan run takes over that the project does not have yet, and the
// --redo that plans again what was planned from the old texts (the run itself names it only once). --set changes entries.
// usage: bun run casting <project-id> [--film] [--set=character:mara=library:mara-v2] [--set=location:hall=project:hall]
import {parseArgs} from 'node:util'
import {log, styles} from '../lib/log.ts'
import {readCasting, writeCastingEntry} from '../lib/editor/library.ts'
import {castingRedo, commandTarget, planCommand} from '../lib/editor/preproduction.ts'
cli('casting')

const usage = 'usage: bun run casting <project-id> [--film] [--set=character:<id>=library:<asset> | --set=location:<id>=project:<id>]...'
const {values: args, positionals} = (() => {
    try {
        return parseArgs({
            args: Bun.argv.slice(2),
            allowPositionals: true,
            options: {film: {type: 'boolean', default: false}, set: {type: 'string', multiple: true}},
        })
    } catch (e) {
        return log.usageError(e instanceof Error ? e.message : String(e), usage)
    }
})()
const target = commandTarget(positionals[0], args.film)
if (typeof target === 'string') log.usageError(target, usage)
const t = target as Exclude<typeof target, string>
const pipeline = `${t.kind === 'film' ? 'bun film.ts' : 'bun index.ts'} ${t.id}`

for (const entry of args.set ?? []) {
    const match = /^(character|location):([a-z0-9-]+)=((?:library|project):[a-z0-9-]+)$/.exec(entry.trim())
    if (!match) log.usageError(`--set takes "character:<id>=library:<asset>" or "location:<id>=project:<id>", not "${entry}"`, usage)
    await writeCastingEntry(t, match![1] as 'character' | 'location', match![2]!, match![3]!)
    log.step('Casting', `${styles.name(match![2]!)} ${match![3]}`)
}

const casting = await readCasting(t, [])
for (const line of casting.errors) log.warn(line)
for (const kind of ['character', 'location'] as const) {
    const roles = casting.roles.filter(r => r.kind === kind)
    if (!roles.length) continue
    log.step(kind === 'character' ? 'Characters' : 'Places', styles.muted(`(${roles.length})`))
    for (const r of roles)
        log.info(
            `   ${styles.name(r.id)} ${r.entry ?? `project:${r.id}`}${r.libraryId && !r.copied ? styles.muted(' - not copied yet: the next plan run takes it') : ''}${r.errors.length ? ` ${r.errors.join(' ')}` : ''}`,
        )
}
if (!casting.roles.length) log.usageError(`no cast yet - plan up to it: ${pipeline} --until=cast`, usage)
const {changes, redo} = await castingRedo(t)
for (const change of changes) log.step('Pending', change)
if (changes.length)
    log.next(
        `${planCommand(t, 'cast', redo)}   ${styles.muted(redo.length ? '- takes the casting over and plans again what was planned from the old texts' : '- takes the casting over')}`,
    )
log.success(changes.length ? `${changes.length} change(s) for the next plan run` : 'the project has what casting.json says')
