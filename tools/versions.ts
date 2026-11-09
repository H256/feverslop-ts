import {cli} from '../lib/cli.ts'
// The older versions of a clip or picture that were put away - rendered again, from an older plan, with a grey backdrop, before the
// library played it - as the workspace's Versions tab and References page list them, CLI first (#549). --pick makes one the current
// version again: what is current now is put away and stays selectable. Nothing is rendered.
// usage: bun run versions <project-id> <clip-id|picture-id> [--film] [--pick=<version>]
import {parseArgs} from 'node:util'
import {log, styles} from '../lib/log.ts'
import {pickVersion, readVersions} from '../lib/editor/choices.ts'
import {commandTarget} from '../lib/editor/preproduction.ts'
cli('versions')

const usage = 'usage: bun run versions <project-id> <clip-id|picture-id> [--film] [--pick=<version>]'
const {values: args, positionals} = (() => {
    try {
        return parseArgs({args: Bun.argv.slice(2), allowPositionals: true, options: {film: {type: 'boolean', default: false}, pick: {type: 'string'}}})
    } catch (e) {
        return log.usageError(e instanceof Error ? e.message : String(e), usage)
    }
})()
const target = commandTarget(positionals[0], args.film)
if (typeof target === 'string') log.usageError(target, usage)
const t = target as Exclude<typeof target, string>
const id = positionals[1]
if (!id) log.usageError('which clip or picture? e.g. slot-007 or a character id', usage)
const found = await readVersions(t, id!)
if (!found) log.usageError(`no clip or picture "${id}" in ${t.id}`, usage)

if (args.pick !== undefined) {
    if (!found!.versions.some(v => v.id === args.pick))
        log.usageError(`no version "${args.pick}" of ${id} - bun run versions ${t.id} ${id}${args.film ? ' --film' : ''} lists them`, usage)
    const result = await pickVersion(t, id!, args.pick)
    log.step('Put away', `${result.putAway} ${styles.muted('- what was current, selectable again')}`)
    log.next(
        found!.kind === 'clip'
            ? `the final video is assembled from it with: ${args.film ? 'bun film.ts' : 'bun index.ts'} ${t.id} --render=final`
            : `clips made from the old picture are stale: ${args.film ? 'bun film.ts' : 'bun index.ts'} ${t.id} --render=videos --refresh=clips`,
    )
    log.success(`${id} is ${args.pick} again`)
} else {
    const {kind, versions} = found!
    if (!versions.length) log.success(`${id} has no older versions`)
    else {
        const when = (ms: number) => new Date(ms).toLocaleString()
        const why = {again: 'rendered again', stale: 'from an older plan', leak: 'grey backdrop', library: 'before the library played it'} as Record<
            string,
            string
        >
        log.step(kind === 'clip' ? 'Clip' : 'Picture', `${id} ${styles.muted(`(${versions.length} older version(s), the newest first)`)}`)
        for (const v of versions) {
            const seed = 'seed' in v && v.seed !== undefined ? ` · seed ${v.seed}` : ''
            log.info(`   ${styles.name(v.id)}  ${styles.muted(`${when(v.made)} · ${why[v.source] ?? v.source}${seed}`)}`)
        }
        log.next(`bun run versions ${t.id} ${id}${args.film ? ' --film' : ''} --pick=<version>`)
    }
}
