import {cli} from '../lib/cli.ts';
// The look of a music video or film, as the workspace's Look page has it - CLI first (#548): the look of the whole, and per character
// and place its look, description, background and floor plan. Without an option it is printed; --json prints it in the form --set
// takes back. A changed text is kept as written, what is written from it is written again for that one only; --again has the
// language model write characters or places anew. Nothing is rendered; the next plan run writes what is missing.
// usage: bun run look <project-id> [--film] [--json | --set=look.json | --again=leo,location:hall]
import {existsSync, readFileSync} from "node:fs";
import {parseArgs} from "node:util";
import {log, styles} from "../lib/log.ts";
import {commandTarget, type LookChange, planCommand, readLook, writeLook} from "../lib/editor/preproduction.ts";
cli('look')

const usage = 'usage: bun run look <project-id> [--film] [--json | --set=look.json | --again=<character>,location:<place>]'
const {values: args, positionals} = (() => {
    try {
        return parseArgs({args: Bun.argv.slice(2), allowPositionals: true, options: {film: {type: 'boolean', default: false}, json: {type: 'boolean', default: false}, set: {type: 'string'}, again: {type: 'string'}}})
    } catch (e) {
        return log.usageError(e instanceof Error ? e.message : String(e), usage)
    }
})()
const target = commandTarget(positionals[0], args.film)
if (typeof target === 'string') log.usageError(target, usage)
const t = target as Exclude<typeof target, string>
const look = readLook(t)
if (look.lookBrief === undefined) log.usageError(`no look yet - plan up to it: ${t.kind === 'film' ? 'bun film.ts' : 'bun index.ts'} ${t.id} --until=look`, usage)
const elements = [...look.characters, ...look.locations]

if (args.set !== undefined || args.again !== undefined) {
    let change: LookChange = {}
    if (args.set !== undefined) {
        if (!existsSync(args.set)) log.usageError(`no file ${args.set}`, usage)
        try {
            change = JSON.parse(readFileSync(args.set, 'utf8'))
        } catch (e) {
            log.usageError(`${args.set} is no JSON: ${(e as Error).message} - bun run look ${t.id} --json gives the form`, usage)
        }
    }
    // "leo" is the character or place of that id, "location:hall" or "character:leo" says which
    const again = (args.again ?? '').split(',').map(s => s.trim()).filter(Boolean).map(name => {
        const [kind, id] = name.includes(':') ? name.split(':') as [string, string] : [undefined, name]
        const found = elements.find(e => e.id === id && (!kind || e.kind === kind))
        if (!found) log.usageError(`no character or place "${name}" - the ids are: ${elements.map(e => e.id).join(', ')}`, usage)
        return {kind: found!.kind, id: found!.id}
    })
    const result = await writeLook(t, {...change, again: [...change.again ?? [], ...again]})
    if (!result.changed) log.success('the look is the same - nothing changed')
    else {
        for (const line of result.remade) log.step('Written anew', `${line} ${styles.muted('- by the next plan run, the others keep theirs')}`)
        if (result.dropped.length) log.step('Dropped', `${result.dropped.join(', ')} ${styles.muted('- the next plan run makes them again, the language model only')}`)
        log.next(planCommand(t, 'look'))
        log.success('the look is saved')
    }
} else if (args.json) {
    const form = (e: (typeof elements)[number]) => Object.fromEntries(Object.entries({kind: e.kind, id: e.id, look: e.look, description: e.description, anchors: e.anchors, layout: e.layout}).filter(([, v]) => v !== undefined))
    console.log(JSON.stringify({lookBrief: look.lookBrief, elements: elements.filter(e => !e.library).map(form)}, null, 2))
} else {
    log.step('Look', look.lookBrief!)
    for (const e of elements) {
        log.info(`\n${styles.name(e.id)} ${e.name}${e.library ? styles.muted(` - played by library:${e.library}, its texts are the library's`) : ''}`)
        for (const [label, text] of [['look', e.look], ['description', e.description], ['background', e.anchors], ['floor plan', e.layout]] as const) {
            if (text !== undefined) log.info(`   ${styles.muted(label.padEnd(12))} ${text}`)
        }
    }
    log.next(`bun run look ${t.id}${t.kind === 'film' ? ' --film' : ''} --json > look.json   (change it, then --set=look.json; or --again=<id> to have one written anew)`)
}
