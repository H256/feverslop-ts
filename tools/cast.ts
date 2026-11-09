import {cli} from '../lib/cli.ts'
// The cast of a music video or film, as the workspace's Casting page edits it - CLI first (#548). Without an option it is printed;
// --json prints it in the form --set takes back: change names, roles and props, add a character or place (without an id), leave one
// out to remove it. A film's script says who is in it: there names and texts change, nobody comes or goes. What was planned from
// the old cast goes - for a music video the looks only of whoever is new or changed. Nothing is rendered.
// usage: bun run cast <project-id> [--film] [--json | --set=cast.json]
import {existsSync, readFileSync} from 'node:fs'
import {parseArgs} from 'node:util'
import {log, styles} from '../lib/log.ts'
import {type CastChange, commandTarget, planCommand, readCast, writeCast} from '../lib/editor/preproduction.ts'
cli('cast')

const usage = 'usage: bun run cast <project-id> [--film] [--json | --set=cast.json]'
const {values: args, positionals} = (() => {
    try {
        return parseArgs({
            args: Bun.argv.slice(2),
            allowPositionals: true,
            options: {film: {type: 'boolean', default: false}, json: {type: 'boolean', default: false}, set: {type: 'string'}},
        })
    } catch (e) {
        return log.usageError(e instanceof Error ? e.message : String(e), usage)
    }
})()
const target = commandTarget(positionals[0], args.film)
if (typeof target === 'string') log.usageError(target, usage)
const t = target as Exclude<typeof target, string>
const view = readCast(t)
if (!view) log.usageError(`no cast yet - plan up to it: ${t.kind === 'film' ? 'bun film.ts' : 'bun index.ts'} ${t.id} --until=cast`, usage)
const cast = view!

if (args.set !== undefined) {
    if (!existsSync(args.set)) log.usageError(`no file ${args.set}`, usage)
    let change: CastChange
    try {
        change = JSON.parse(readFileSync(args.set, 'utf8'))
    } catch (e) {
        log.usageError(`${args.set} is no JSON: ${(e as Error).message} - bun run cast ${t.id} --json gives the form`, usage)
    }
    const result = await writeCast(t, change!)
    if (!result.changed) log.success('the cast is the same - nothing changed')
    else {
        if (result.added.length) log.step('Added', result.added.join(', '))
        if (result.removed.length) log.step('Removed', result.removed.join(', '))
        for (const line of result.remade) log.step('Written anew', `${line} ${styles.muted('- by the next plan run, the others keep theirs')}`)
        if (result.dropped.length)
            log.step('Dropped', `${result.dropped.join(', ')} ${styles.muted('- the next plan run makes them again, the language model only')}`)
        // the story still tells of the cast before (#542)
        if (t.kind === 'music' && result.renamed.length)
            log.step(
                'Story',
                `${styles.muted('the new names in it too:')} bun run story ${t.id} ${result.renamed.map(r => `--rename="${r.from}=${r.to}"`).join(' ')}`,
            )
        if (t.kind === 'music' && (result.added.length || result.removed.length))
            log.step('Story', `${styles.muted('told anew for this cast, as a proposal:')} bun run story ${t.id} --adapt`)
        log.next(planCommand(t, 'cast'))
        log.success('the cast is saved')
    }
} else if (args.json) {
    // the form --set takes: what the page shows of each member, without what the command adds about it
    const form = (m: Record<string, unknown>) =>
        Object.fromEntries(Object.entries(m).filter(([key, value]) => value !== undefined && key !== 'group' && key !== 'voiceOnly'))
    console.log(JSON.stringify({characters: cast.characters.map(form), locations: cast.locations.map(form)}, null, 2))
} else {
    log.step('Characters', styles.muted(`(${cast.characters.length})`))
    for (const c of cast.characters)
        log.info(
            `   ${styles.name(c.id)} ${c.name} ${styles.muted(`- ${[c.role, c.prop && `prop: ${c.prop}`, c.group && 'a group', c.voiceOnly && 'voice only'].filter(Boolean).join(' · ')}`)}`,
        )
    log.step('Places', styles.muted(`(${cast.locations.length})`))
    for (const l of cast.locations) log.info(`   ${styles.name(l.id)} ${l.name}${l.description ? styles.muted(` - ${l.description}`) : ''}`)
    if (cast.builtOn.length || cast.remakes.length)
        log.step('A change drops', styles.muted([...cast.builtOn, ...cast.remakes.map(s => `${s} (only of whoever is new or changed)`)].join(', ')))
    log.next(`bun run cast ${t.id}${t.kind === 'film' ? ' --film' : ''} --json > cast.json   (change it, then --set=cast.json)`)
}
