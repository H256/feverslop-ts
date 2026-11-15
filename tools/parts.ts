import {cli} from '../lib/cli.ts'
import {extraArgument} from '../lib/command-schema.ts'
// The stretches of a song where nobody sings, split into parts, and how each instrument plays in them (#1021) - measured from the
// stems, nothing is planned, rendered or changed. A section the lyrics call "Guitar Solo" can hold a solo, a break of staccato hits
// and a build-up; this says which and when.
// usage: bun run parts <project-id> [--json] [--no-vocals] [--min-gap=8]
// --no-vocals: count the song as music only - the whole song is one gap, split by its energy (a video told by the music alone).
import {existsSync, readdirSync} from 'node:fs'
import {join} from 'node:path'
import {parseArgs} from 'node:util'
import {formatTime} from '../lib/frames.ts'
import {instrumentParts, MIN_GAP_SEC} from '../lib/instrument-parts.ts'
import {STEM_FRAME_SEC, stemFramePower} from '../lib/music.ts'
import {log, styles} from '../lib/log.ts'
import {commandTarget} from '../lib/editor/preproduction.ts'
import {readJson} from '../lib/editor/preproduction/base.ts'
import type {Project} from '../lib/project.ts'
cli('parts')

const usage = 'usage: bun run parts <project-id> [--json] [--no-vocals] [--min-gap=8]'
const {values: args, positionals} = (() => {
    try {
        return parseArgs({
            args: Bun.argv.slice(2),
            allowPositionals: true,
            options: {json: {type: 'boolean', default: false}, 'no-vocals': {type: 'boolean', default: false}, 'min-gap': {type: 'string'}},
        })
    } catch (e) {
        return log.usageError(e instanceof Error ? e.message : String(e), usage)
    }
})()
const extra = extraArgument(positionals, ['a project id'])
if (extra) log.usageError(extra, usage)
const minGap = args['min-gap'] === undefined ? MIN_GAP_SEC : Number(args['min-gap'])
if (!Number.isFinite(minGap) || minGap <= 0) log.usageError(`--min-gap: "${args['min-gap']}" is no number of seconds`, usage)
const target = commandTarget(positionals[0], false)
if (typeof target === 'string') log.usageError(target, usage)
const t = target as Exclude<typeof target, string>

const music = readJson<Project>(join(t.dir, 'project.json'))?.music
const stemsDir = join(t.dir, 'stems')
if (!music?.downbeats?.length || !music.barEnergy?.length || !existsSync(stemsDir))
    log.usageError(`${t.id} has no analyzed song and stems yet - they come with the first plan run: bun index.ts ${t.id} --until=story`, usage)
// every stem on disk but the vocals and the mixes made of stems for the clips (mix-bass-guitar.wav)
const names = readdirSync(stemsDir)
    .filter(f => f.endsWith('.wav') && !f.startsWith('mix-'))
    .map(f => f.slice(0, -4))
const stems: Record<string, number[]> = {}
for (const name of names.filter(n => n !== 'vocals')) stems[name] = await stemFramePower(join(stemsDir, `${name}.wav`))
const vocals = !args['no-vocals'] && names.includes('vocals') ? await stemFramePower(join(stemsDir, 'vocals.wav')) : undefined

const gaps = instrumentParts({
    downbeats: music!.downbeats,
    durationSec: music!.durationSec,
    barEnergy: music!.barEnergy,
    vocals,
    stems,
    hopSec: STEM_FRAME_SEC,
    minGapSec: minGap,
})

if (args.json) console.log(JSON.stringify({gaps}, null, 2))
else {
    log.step(
        'Song',
        `${formatTime(music!.durationSec)} ${styles.muted(`· stems: ${Object.keys(stems).join(', ') || 'none'}${vocals ? '' : ' · counted as music only'}`)}`,
    )
    if (!gaps.length) log.info(styles.muted(`no stretch of ${minGap} s or more without singing`))
    for (const gap of gaps) {
        log.info(styles.muted(`\nwithout singing ${formatTime(gap.start)}-${formatTime(gap.end)} (${Math.round(gap.end - gap.start)} s)`))
        for (const part of gap.parts) {
            const play = part.stems
                .map(
                    s =>
                        `${s.stem} ${s.articulation}${s.articulation === 'hits' ? ` (${s.pauses} pause${s.pauses === 1 ? '' : 's'})` : ''} ${s.relDb >= 0 ? '+' : ''}${s.relDb.toFixed(0)} dB`,
                )
                .join(' · ')
            log.info(
                `  ${formatTime(part.start)}-${formatTime(part.end)}  ${part.level.padEnd(5)} ${part.energy.toFixed(2)}${part.leads ? `  ${styles.name(part.leads)} leads` : ''}  ${styles.muted(play)}`,
            )
        }
    }
}
