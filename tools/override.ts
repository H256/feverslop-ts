import {cli} from '../lib/cli.ts';
// A film clip's own choice, as the workspace's Render tab makes it - CLI first (#549): the view of its place it is in, the order
// of its reference pictures, pictures left out. Kept in clip-overrides/<clip>.json (the file can be written by hand as well); it
// applies from the next plan run on, and the clip then counts as stale. Without an option the choice there is is printed.
// usage: bun run override <film-id> <clip-id> [--view=<n>] [--order=<picture>,...] [--without=<picture>,...] [--clear]
import {parseArgs} from "node:util";
import {log, styles} from "../lib/log.ts";
import {readOverride, writeOverride} from "../lib/editor/choices.ts";
import {commandTarget} from "../lib/editor/preproduction.ts";
import type {EditorOverride} from "../lib/editor/project.ts";
cli('override')

const usage = 'usage: bun run override <film-id> <clip-id> [--view=<n>] [--order=<picture>,...] [--without=<picture>,...] [--clear]'
const {values: args, positionals} = (() => {
    try {
        return parseArgs({args: Bun.argv.slice(2), allowPositionals: true, options: {view: {type: 'string'}, order: {type: 'string'}, without: {type: 'string'}, clear: {type: 'boolean', default: false}}})
    } catch (e) {
        return log.usageError(e instanceof Error ? e.message : String(e), usage)
    }
})()
const target = commandTarget(positionals[0], true)
if (typeof target === 'string') log.usageError(target, usage)
const t = target as Exclude<typeof target, string>
const clip = positionals[1]
if (!clip) log.usageError('which clip? e.g. clip-007', usage)
const list = (value: string | undefined) => value === undefined ? undefined : value.split(',').map(s => s.trim()).filter(Boolean)
const show = (o: EditorOverride | undefined) => o ? [o.placeView !== undefined ? `view ${o.placeView}` : '', o.order?.length ? `order ${o.order.join(', ')}` : '', o.without?.length ? `without ${o.without.join(', ')}` : ''].filter(Boolean).join(' · ') : 'none - as the plan has it'

if (args.clear || args.view !== undefined || args.order !== undefined || args.without !== undefined) {
    if (args.view !== undefined && !/^\d+$/.test(args.view)) log.usageError(`--view takes the number of a view, not "${args.view}"`, usage)
    // what is not said stays as it was; --clear takes all of it away
    const was = args.clear ? undefined : readOverride(t, clip!)
    const next: EditorOverride = {
        placeView: args.view !== undefined ? Number(args.view) : was?.placeView,
        order: list(args.order) ?? was?.order,
        without: list(args.without) ?? was?.without,
    }
    await writeOverride(t, clip!, args.clear ? null : next)
    log.step('Choice', show(args.clear ? undefined : next))
    log.next(`bun film.ts ${t.id}   ${styles.muted(`- the plan run takes it; ${clip} is stale then: --render=videos --only=${clip}`)}`)
    log.success(args.clear ? `${clip} is as the plan has it again` : `${clip} has a choice of its own`)
} else {
    log.step(clip!, show(readOverride(t, clip!)))
    log.next(`bun run override ${t.id} ${clip} --view=<n> | --order=<picture>,... | --without=<picture>,... | --clear`)
}
