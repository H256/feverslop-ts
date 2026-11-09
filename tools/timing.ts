import {cli} from '../lib/cli.ts';
// When each sung line and word of a music video is, as the workspace's Timing page moves them on the vocals - CLI first (#549).
// Without an option every line is printed with its start and end; --json gives the words in the form --set takes back. A moved
// line changes the clips it is sung in; their beats lose their shot plan, the next plan run plans just those again.
// usage: bun run timing <project-id> [--json | --set=timing.json | --tighten | --off=12,40 | --on=12 | --reset=12,40|all]
// --off: lines left out - heard, but not sung (a misheard ad-lib on top of a line): no clip sings them. --on sings them again.
// --tighten: the first word of each line that starts in silence starts where the singing does (the lines placed by hand stay) - a project
// aligned before that was part of the alignment gets it here, and a run of --redo=lyricsTiming has it by itself.
// --reset: lines placed by hand go back to the automatic timing, worked out again from the kept transcript (whisper does not run
// again) - a correction that was wrong. An ad-lib (heard, not in lyrics.txt) is a suggestion: --on=N sings it, --off=N leaves it.
import {existsSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {parseArgs} from "node:util";
import {formatTime} from "../lib/frames.ts";
import {MIN_WORD_SEC} from "../lib/lyrics.ts";
import {readFineWaveform} from "../lib/waveform.ts";
import {EARLY_FROM, leadOf} from "../shared/timing-fit.ts";
import {log, styles} from "../lib/log.ts";
import {commandTarget} from "../lib/editor/preproduction.ts";
import {readTiming, type TimingChange, writeTiming} from "../lib/editor/timing.ts";
cli('timing')

const usage = 'usage: bun run timing <project-id> [--json | --set=timing.json | --tighten | --off=12,40 | --on=12 | --reset=12,40|all]'
const {values: args, positionals} = (() => {
    try {
        return parseArgs({args: Bun.argv.slice(2), allowPositionals: true, options: {json: {type: 'boolean', default: false}, set: {type: 'string'}, tighten: {type: 'boolean', default: false}, off: {type: 'string'}, on: {type: 'string'}, reset: {type: 'string'}}})
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

if ([args.tighten, args.set !== undefined, args.off !== undefined || args.on !== undefined, args.reset !== undefined].filter(Boolean).length > 1) log.usageError('--tighten, --set, --off/--on and --reset do not go together', usage)
let change: TimingChange | undefined
// the line numbers as listed (from 1)
const numbers = (value: string | undefined, flag: string) => (value ?? '').split(',').filter(Boolean).map(n => {
    const line = Number(n.trim()) - 1
    if (!timing.lines.some(l => l.line === line)) log.usageError(`--${flag}: no line ${n.trim()} - bun run timing ${t.id} lists them`, usage)
    return line
})
if (args.reset !== undefined) {
    // all: every line placed by hand
    const lines = args.reset === 'all' ? timing.lines.filter(l => l.byHand).map(l => l.line) : numbers(args.reset, 'reset')
    if (!lines.length) log.success('no line is placed by hand - nothing to set back')
    else change = {lines: lines.map(line => ({line, reset: true}))}
} else if (args.off !== undefined || args.on !== undefined) {
    change = {lines: [...numbers(args.off, 'off').map(line => ({line, off: true})), ...numbers(args.on, 'on').map(line => ({line, off: false}))]}
} else if (args.tighten) {
    const loudness = timing.audio ? await readFineWaveform(join(t.dir, timing.audio.file), 100).catch(() => undefined) : undefined
    if (!loudness) log.usageError(`the vocals of ${t.id} cannot be read - they come with the stems: bun index.ts ${t.id} --until=story`, usage)
    let early = timing.lines.flatMap(l => { const lead = l.words[0] && !l.unplaced && !l.off ? leadOf(l.words, loudness!) : 0; return lead >= EARLY_FROM && !l.byHand ? [{line: l.line, text: l.text, lead}] : [] })
    // a line with a word of no length cannot be saved as it is (an alignment that failed): it is left to the Timing page
    const broken = (n: number) => timing.lines.find(x => x.line === n)!.words.some(w => w.end - w.start < MIN_WORD_SEC)
    for (const e of early.filter(e => broken(e.line))) log.warn(`line ${e.line + 1} (${e.text}) has a word without length - set it on the Timing page`)
    early = early.filter(e => !broken(e.line))
    for (const e of early) log.info(`${String(e.line + 1).padStart(4)}  starts ${e.lead.toFixed(2)} s early  ${e.text}`)
    if (!early.length) log.success('no line starts in silence - nothing to tighten')
    else change = {lines: early.map(e => { const l = timing.lines.find(x => x.line === e.line)!; const by = Math.min(e.lead, l.words[0]!.end - l.words[0]!.start - MIN_WORD_SEC); return {line: e.line, words: l.words.map((w, n) => ({start: n === 0 ? w.start + by : w.start, end: w.end}))} })}
} else if (args.set !== undefined) {
    if (!existsSync(args.set)) log.usageError(`no file ${args.set}`, usage)
    try {
        change = JSON.parse(readFileSync(args.set, 'utf8'))
    } catch (e) {
        log.usageError(`${args.set} is no JSON: ${(e as Error).message} - bun run timing ${t.id} --json gives the form`, usage)
    }
}
if (change) {
    // a line given back as it was is no change - writeTiming tells, as it does for the workspace's Timing page
    const result = await writeTiming(t, change)
    if (!result.changed.length) log.success('the timing is the same - nothing changed')
    else {
        log.step('Changed', `${result.changed.length} line(s)`)
        if (result.slots.length) log.step('Clips', `${result.slots.join(', ')} ${styles.muted('- their vocals changed')}`)
        if (result.replanned.length) log.step('Planned again', `${result.replanned.join(', ')} ${styles.muted('- the shot plan of these beats goes, the next plan run makes it again')}`)
        for (const c of result.crossing) log.warn(`line ${c.line + 1}: "${c.word}" crosses a cut at ${formatTime(c.cut, true)} - cutting the song again helps: bun index.ts ${t.id} --redo=timeline`)
        log.next(`bun index.ts ${t.id}`)
        log.success('the timing is saved')
    }
} else if (args.json) {
    console.log(JSON.stringify({lines: timing.lines.map(l => ({line: l.line, text: l.text, words: l.words, ...(l.off ? {off: true} : {})}))}, null, 2))
} else {
    let section: string | undefined
    for (const l of timing.lines) {
        if (l.section !== section) log.info(styles.muted(`\n[${section = l.section}]`))
        const start = l.words[0]?.start ?? 0, end = l.words.at(-1)?.end ?? start
        log.info(`${String(l.line + 1).padStart(4)}  ${formatTime(start, true)} – ${formatTime(end, true)}  ${l.text}${l.unplaced ? styles.muted('  (not found: laid out here, move it where it is sung)') : l.estimated ? styles.muted('  (a guess: barely heard)') : ''}${l.byHand ? styles.muted('  (by hand)') : ''}${l.adlib ? styles.warning(`  (heard, not in the lyrics${l.off ? ` - not sung, --on=${l.line + 1} sings it` : ''})`) : l.off ? styles.warning('  (left out - not sung)') : ''}${l.problem ? styles.warning(`  (${l.problem})`) : ''}`)
    }
    const problems = timing.lines.filter(l => l.problem)
    if (problems.length) log.warn(`${problems.length} line(s) do not match lyrics.txt - move or check them on the Timing page; --reset=N sets a line placed by hand back to the automatic timing`)
    log.next(`bun run timing ${t.id} --json > timing.json   (move the words' start and end, "off": true leaves a line out, then --set=timing.json)`)
}
