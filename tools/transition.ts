import {cli} from '../lib/cli.ts'
import {extraArgument} from '../lib/command-schema.ts'
// How a clip of a music video comes in at the export (#1195) - CLI first, the workspace's "Transition into this clip" calls the same:
// a cut, or a crossfade or a fade through black or white from the clip before it, over the frames that clip was rendered past its
// end. Kept in transitions.json; only the next final video changes (bun index.ts <id> --render=final), the clips stay.
// usage: bun run transition <project-id> [<clip-id> [--type=crossfade|fade-black|fade-white] [--seconds=0.5] [--cut]]
import {parseArgs} from 'node:util'
import {log, styles} from '../lib/log.ts'
import {commandTarget} from '../lib/editor/preproduction.ts'
import {writeClipTransition} from '../lib/editor/choices.ts'
import {MAX_SECONDS, MIN_SECONDS, readTransitions, TRANSITION_TYPES, type Transition, type TransitionType} from '../lib/transitions.ts'
cli('transition')

const usage = `usage: bun run transition <project-id> [<clip-id> [--type=${TRANSITION_TYPES.join('|')}] [--seconds=0.5] [--cut]]`
const {values: args, positionals} = (() => {
    try {
        return parseArgs({
            args: Bun.argv.slice(2),
            allowPositionals: true,
            options: {type: {type: 'string'}, seconds: {type: 'string'}, cut: {type: 'boolean', default: false}},
        })
    } catch (e) {
        return log.usageError(e instanceof Error ? e.message : String(e), usage)
    }
})()
const extra = extraArgument(positionals, ['a project id', 'a clip id'])
if (extra) log.usageError(extra, usage)
const target = commandTarget(positionals[0], false)
if (typeof target === 'string') log.usageError(target, usage)
const t = target as Exclude<typeof target, string>
const clip = positionals[1]
const show = (transition: Transition | undefined) => (transition ? `${transition.type}, ${transition.seconds} s` : 'cut')

const {transitions, problems} = readTransitions(t.dir)
for (const problem of problems) log.warn(`transitions.json: ${problem}`)
if (!clip) {
    // all of them, in the order of the clips' names
    const ids = Object.keys(transitions).sort()
    if (!ids.length) log.step('Transitions', 'none - every clip comes in on a cut')
    for (const id of ids) log.step(id, show(transitions[id]))
    log.next(`bun run transition ${t.id} <clip-id> --type=crossfade --seconds=0.5`)
} else if (args.cut || args.type !== undefined || args.seconds !== undefined) {
    if (args.cut && (args.type !== undefined || args.seconds !== undefined)) log.usageError('--cut takes no --type or --seconds', usage)
    const was = transitions[clip]
    const type = (args.type ?? was?.type ?? 'crossfade') as TransitionType
    if (!TRANSITION_TYPES.includes(type)) log.usageError(`--type is one of ${TRANSITION_TYPES.join(', ')}, not "${args.type}"`, usage)
    const seconds = args.seconds !== undefined ? Number(args.seconds) : (was?.seconds ?? 0.5)
    if (!Number.isFinite(seconds) || seconds < MIN_SECONDS || seconds > MAX_SECONDS)
        log.usageError(`--seconds is from ${MIN_SECONDS} to ${MAX_SECONDS}, not "${args.seconds}"`, usage)
    const next = args.cut ? null : {type, seconds}
    await writeClipTransition(t, clip, next)
    log.step(clip, show(next ?? undefined))
    log.next(`bun index.ts ${t.id} --render=final   ${styles.muted('- the next final video has it; the clips stay as they are')}`)
    log.success(next ? `${clip} comes in with a ${type}` : `${clip} comes in on a cut`)
} else {
    log.step(clip, show(transitions[clip]))
    log.next(`bun run transition ${t.id} ${clip} --type=${TRANSITION_TYPES.join('|')} --seconds=0.5 | --cut`)
}
