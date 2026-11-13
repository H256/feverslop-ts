import {cli} from '../lib/cli.ts'
import {extraArgument} from '../lib/command-schema.ts'
// Who sings which line of a music video, as the workspace's Singers page has it - CLI first (#549). Without an option every sung
// line is printed with its singers; --json gives them in the form --set takes back, --line changes single lines. The beats a
// changed line is sung in lose their shot plan - the next plan run plans just those again. Nothing is rendered.
// usage: bun run singers <project-id> [--json | --set=singers.json | --line=12:mara,ben ...]
import {existsSync, readFileSync} from 'node:fs'
import {parseArgs} from 'node:util'
import {log, styles} from '../lib/log.ts'
import {commandTarget} from '../lib/editor/preproduction.ts'
import {readSinging, type SingingChange, writeSinging} from '../lib/editor/singing.ts'
cli('singers')

const usage = 'usage: bun run singers <project-id> [--json | --set=singers.json | --line=<n>:<singer>,<singer> ...]'
const {values: args, positionals} = (() => {
    try {
        return parseArgs({
            args: Bun.argv.slice(2),
            allowPositionals: true,
            options: {json: {type: 'boolean', default: false}, set: {type: 'string'}, line: {type: 'string', multiple: true}},
        })
    } catch (e) {
        return log.usageError(e instanceof Error ? e.message : String(e), usage)
    }
})()
// a word more than it takes is said before any work (#938)
const extra = extraArgument(positionals, ['a project id'])
if (extra) log.usageError(extra, usage)
const target = commandTarget(positionals[0], false)
if (typeof target === 'string') log.usageError(target, usage)
const t = target as Exclude<typeof target, string>
const view = await readSinging(t)
if (!view) log.usageError(`nobody sings in ${t.id} yet - "singers" in config.json, then plan up to the cast: bun index.ts ${t.id} --until=cast`, usage)
const singing = view!
// lines are numbered from 1 here, as the page shows them
const shown = (line: number) => line + 1

if (args.set !== undefined || args.line?.length) {
    let change: SingingChange = {lines: []}
    if (args.set !== undefined) {
        if (!existsSync(args.set)) log.usageError(`no file ${args.set}`, usage)
        try {
            change = JSON.parse(readFileSync(args.set, 'utf8'))
        } catch (e) {
            log.usageError(`${args.set} is no JSON: ${(e as Error).message} - bun run singers ${t.id} --json gives the form`, usage)
        }
    }
    for (const entry of args.line ?? []) {
        const match = /^(\d+):([a-z0-9-]+(?:,[a-z0-9-]+)*)$/.exec(entry.trim())
        if (!match) log.usageError(`--line takes "<line>:<singer>,<singer>" (the line as numbered here, the singers by id), not "${entry}"`, usage)
        change.lines.push({line: Number(match![1]) - 1, singers: match![2]!.split(',')})
    }
    const result = await writeSinging(t, change)
    if (!result.changed.length) log.success('the singers are the same - nothing changed')
    else {
        log.step('Changed', `${result.changed.length} line(s): ${result.changed.map(shown).join(', ')}`)
        for (const {beat, character} of result.added)
            log.step('Added', `${character} to ${beat} ${styles.muted('- the beat is staged again without its floor plan')}`)
        if (result.newSingers.length) log.step('Sing now', result.newSingers.join(', '))
        if (result.formerSingers.length) log.step('Sing no more', result.formerSingers.join(', '))
        if (result.replanned.length)
            log.step(
                'Planned again',
                `${result.replanned.join(', ')} ${styles.muted('- the shot plan of these beats goes, the next plan run makes it again: the language model only')}`,
            )
        if (result.staleClips.length) log.step('Stale', `${result.staleClips.length} clip(s) once planned again: ${result.staleClips.join(', ')}`)
        log.next(`bun index.ts ${t.id}`)
        log.success('the singers are saved')
    }
} else if (args.json) {
    // "line" as project.json numbers it (from 0), "n" as shown here and taken by --line (from 1)
    console.log(
        JSON.stringify(
            {lines: singing.lines.map(l => ({line: l.line, n: shown(l.line), text: l.text, singers: l.singers, ...(l.parts ? {parts: l.parts} : {})}))},
            null,
            2,
        ),
    )
} else {
    const name = (id: string) => singing.characters.find(c => c.id === id)?.name ?? id
    log.step('Singers', singing.singers.map(id => `${styles.name(id)} ${name(id)}`).join(', '))
    let section: string | undefined
    for (const l of singing.lines) {
        if (l.section !== section) log.info(styles.muted(`\n[${(section = l.section)}]`))
        const who = l.parts?.length ? l.parts.map(p => `${p.singers.join('+')} from word ${p.from + 1}`).join(' · ') : l.singers.join(' + ')
        log.info(`${String(shown(l.line)).padStart(4)}  ${who.padEnd(28)} ${l.text}`)
    }
    log.next(`bun run singers ${t.id} --line=<n>:<singer>,<singer>   (or --json > singers.json, change it, --set=singers.json)`)
}
