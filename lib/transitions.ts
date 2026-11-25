// How a clip comes in at the export (#1195): a cut, or a dissolve or a fade through black or white from the clip before it. Kept in
// transitions.json of the project ({"<clip id>": {"type": "crossfade", "seconds": 0.5}}), written by `bun run transition` or the
// workspace; the plan and the clips are not touched, only the next final video.
//
// On a music video the song is the clock: every clip starts on the frame its audio started on. So a transition never moves the clip
// it leads into - it plays over the frames the clip before it was rendered past its own end (the model renders to its own lengths),
// as many as there are. Without such frames it stays a cut.

import {existsSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'

export const TRANSITION_TYPES = ['crossfade', 'fade-black', 'fade-white'] as const
export type TransitionType = (typeof TRANSITION_TYPES)[number]
export type Transition = {type: TransitionType; seconds: number}
export type Transitions = Record<string, Transition>

export const MIN_SECONDS = 0.1
export const MAX_SECONDS = 3
const XFADE: Record<TransitionType, string> = {crossfade: 'fade', 'fade-black': 'fadeblack', 'fade-white': 'fadewhite'}

export const transitionsFile = (dir: string) => join(dir, 'transitions.json')

/** Why a transition cannot be kept, or nothing. */
export function transitionProblem(value: unknown): string | undefined {
    if (!value || typeof value !== 'object') return 'a transition is {"type": ..., "seconds": ...}'
    const {type, seconds} = value as Partial<Transition>
    if (!TRANSITION_TYPES.includes(type as TransitionType)) return `type must be one of ${TRANSITION_TYPES.join(', ')}`
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < MIN_SECONDS || seconds > MAX_SECONDS)
        return `seconds must be from ${MIN_SECONDS} to ${MAX_SECONDS}`
    return undefined
}

/** The transitions of a project; a broken entry is left out with its reason, so the export still runs. */
export function readTransitions(dir: string): {transitions: Transitions; problems: string[]} {
    const file = transitionsFile(dir)
    if (!existsSync(file)) return {transitions: {}, problems: []}
    let data: unknown
    try {
        data = JSON.parse(readFileSync(file, 'utf8'))
    } catch (e) {
        return {transitions: {}, problems: [`transitions.json cannot be read: ${e instanceof Error ? e.message : String(e)}`]}
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {transitions: {}, problems: ['transitions.json is not an object of clip ids']}
    const transitions: Transitions = {}
    const problems: string[] = []
    for (const [clip, value] of Object.entries(data)) {
        const problem = transitionProblem(value)
        if (problem) problems.push(`${clip}: ${problem}`)
        else transitions[clip] = {type: (value as Transition).type, seconds: (value as Transition).seconds}
    }
    return {transitions, problems}
}

/** A clip's transition set, or taken away (null: a cut). The file goes when nothing is left in it. */
export function writeTransition(dir: string, clip: string, transition: Transition | null) {
    const problem = transition && transitionProblem(transition)
    if (problem) throw new Error(problem)
    const {transitions} = readTransitions(dir)
    if (transition) transitions[clip] = {type: transition.type, seconds: transition.seconds}
    else delete transitions[clip]
    if (Object.keys(transitions).length) writeFileSync(transitionsFile(dir), JSON.stringify(transitions, null, 2) + '\n')
    else rmSync(transitionsFile(dir), {force: true})
}

/**
 * The filter that joins the clips' video streams `[v0]`, `[v1]`, ... (each already trimmed to its frames plus `extra[i]` frames
 * past its end) into `[out]`: a concat where clips are cut, an xfade where a clip comes in with a transition. `frames`: each clip's
 * own frames, at `fps`. Returns the graph and how each transition came out, in frames (0: a cut, there was nothing to fade over).
 */
export function joinGraph(
    ids: string[],
    frames: number[],
    fps: number,
    transitions: Transitions,
    available: number[], // frames each clip has past its own end
    out = 'out',
): {graph: string[]; extra: number[]; used: Record<string, number>} {
    const extra = ids.map(() => 0)
    const used: Record<string, number> = {}
    for (let i = 1; i < ids.length; i++) {
        const transition = transitions[ids[i]!]
        if (!transition) continue
        // never longer than the clip it leads into, nor than what the clip before has past its end
        const wanted = Math.round(transition.seconds * fps)
        const take = Math.max(0, Math.min(wanted, available[i - 1]!, frames[i]! - 1))
        used[ids[i]!] = take
        extra[i - 1] = take
    }
    if (ids.length === 1) return {graph: [`[v0]null[${out}]`], extra, used}
    const graph: string[] = []
    let current = '[v0]'
    let at = frames[0]! // where the stream built so far ends, in frames, without the extra frames of its last clip
    for (let i = 1; i < ids.length; i++) {
        const next = i === ids.length - 1 ? `[${out}]` : `[j${i}]`
        const take = used[ids[i]!] ?? 0
        if (take > 0) {
            const type = XFADE[transitions[ids[i]!]!.type]
            graph.push(`${current}[v${i}]xfade=transition=${type}:duration=${(take / fps).toFixed(6)}:offset=${(at / fps).toFixed(6)}${next}`)
        } else graph.push(`${current}[v${i}]concat=n=2:v=1:a=0${next}`)
        current = next
        at += frames[i]!
    }
    return {graph, extra, used}
}
