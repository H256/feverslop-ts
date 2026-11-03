import {cli} from '../lib/cli.ts';
// When each sung line and word of a music video is, as the workspace's Timing page moves them on the vocals - CLI first (#549).
// Without an option every line is printed with its start and end; --json gives the words in the form --set takes back. A moved
// line changes the clips it is sung in; their beats lose their shot plan, the next plan run plans just those again.
// usage: bun run timing <project-id> [--json | --set=timing.json]
import {existsSync, readFileSync} from "node:fs";
import {parseArgs} from "node:util";
import {formatTime} from "../lib/frames.ts";
import {log, styles} from "../lib/log.ts";
import {commandTarget} from "../lib/editor/preproduction.ts";
import {readTiming, type TimingChange, writeTiming} from "../lib/editor/timing.ts";
cli('timing')

const usage = 'usage: bun run timing <project-id> [--json | --set=timing.json]'
const {values: args, positionals} = (() => {
    try {
        return parseArgs({args: Bun.argv.slice(2), allowPositionals: true, options: {json: {type: 'boolean', default: false}, set: {type: 'string'}}})
    } catch (e) {
        return log.usageError(e instanceof Error ? e.message : String(e), usage)
    }
})()
const target = commandTarget(positionals[0], false)
if (typeof target === 'string') log.usageError(target, usage)
const t = target as Exclude<typeof target, string>
const view = await readTiming(t)
if (!view) log.usageError(`${t.id} has no timed lyrics - they come with "alignLyrics" (or singers) and the stems: bun index.ts ${t.id} --until=story`, usage)
const timing = view!

if (args.set !== undefined) {
    if (!existsSync(args.set)) log.usageError(`no file ${args.set}`, usage)
    let change: TimingChange
    try {
        change = JSON.parse(readFileSync(args.set, 'utf8'))
    } catch (e) {
        log.usageError(`${args.set} is no JSON: ${(e as Error).message} - bun run timing ${t.id} --json gives the form`, usage)
    }
    // a line given back as it was is no change: only the ones whose words moved are passed on
    const before = new Map(timing.lines.map(l => [l.line, JSON.stringify(l.words.map(w => [w.start, w.end]))]))
    const moved = {lines: (change!.lines ?? []).filter(l => before.get(l.line) !== JSON.stringify((l.words ?? []).map(w => [w.start, w.end])))}
    const result = await writeTiming(t, moved)
    if (!result.changed.length) log.success('the timing is the same - nothing changed')
    else {
        log.step('Moved', `${result.changed.length} line(s)`)
        if (result.slots.length) log.step('Clips', `${result.slots.join(', ')} ${styles.muted('- their vocals changed')}`)
        if (result.replanned.length) log.step('Planned again', `${result.replanned.join(', ')} ${styles.muted('- the shot plan of these beats goes, the next plan run makes it again')}`)
        for (const c of result.crossing) log.warn(`line ${c.line + 1}: "${c.word}" crosses a cut at ${formatTime(c.cut, true)} - cutting the song again helps: bun index.ts ${t.id} --redo=timeline`)
        log.next(`bun index.ts ${t.id}`)
        log.success('the timing is saved')
    }
} else if (args.json) {
    console.log(JSON.stringify({lines: timing.lines.map(l => ({line: l.line, text: l.text, words: l.words}))}, null, 2))
} else {
    let section: string | undefined
    for (const l of timing.lines) {
        if (l.section !== section) log.info(styles.muted(`\n[${section = l.section}]`))
        const start = l.words[0]?.start ?? 0, end = l.words.at(-1)?.end ?? start
        log.info(`${String(l.line + 1).padStart(4)}  ${formatTime(start, true)} – ${formatTime(end, true)}  ${l.text}${l.estimated ? styles.muted('  (a guess: barely heard)') : ''}${l.byHand ? styles.muted('  (by hand)') : ''}`)
    }
    log.next(`bun run timing ${t.id} --json > timing.json   (move the words' start and end, then --set=timing.json)`)
}
