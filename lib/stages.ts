import {log, styles} from "./log.ts";
import type {Project} from "./project.ts";
import type {FilmProject} from "./film/types.ts";

// The preproduction in stages, as a film is made (issue #526): the book first, then who plays and where, then how it looks,
// then the shots - and only then the expensive part, the rendering. Every stage is the language model only. A run can stop
// after one of them (--until), so that it is looked at and changed in the workspace before what is built on it is planned.
//
//   story  music video: story and summary · film: brief, outline, screenplay and the script check
//   cast   the characters and places; a music video also who sings which line
//   look   the film look, the looks and descriptions of everyone and every place, the layouts and views of the places, a film's props
//   plan   the beats and shots of a music video, the shots of every scene of a film: what the clips are made from

export const PLAN_STAGES = ['story', 'cast', 'look', 'plan'] as const
export type PlanStage = typeof PLAN_STAGES[number]
// where a run can stop: after the plan there is nothing left to stop before but the rendering, which is asked for (--render)
export const UNTIL_STAGES = ['story', 'cast', 'look'] as const
export type UntilStage = typeof UNTIL_STAGES[number]

export const STAGE_NAMES: Record<PlanStage, string> = {story: 'the story', cast: 'the cast', look: 'the look', plan: 'the shot plan'}

/** --until as given: one of the stages, or undefined when not given. Throws on anything else. */
export function parseUntil(value: string | undefined): UntilStage | undefined {
    if (!value) return undefined
    if (!(UNTIL_STAGES as readonly string[]).includes(value)) throw new Error(`--until: unknown "${value}" - use ${UNTIL_STAGES.join(', ')}`)
    return value as UntilStage
}

/** The last stage a music video's plan has, undefined when it has not even a story. */
export function musicStage(data: Project): PlanStage | undefined {
    // a plan with --legacy-moments has no shot plan of its own: the beats on the clips are its plan
    if (data.mapping !== undefined) return 'plan'
    if (data.locationLayouts !== undefined) return 'look'
    if (data.cast !== undefined) return 'cast'
    if (data.story !== undefined) return 'story'
    return undefined
}

/** The last stage a film's plan has, undefined when it has not even a screenplay. */
export function filmStage(data: FilmProject): PlanStage | undefined {
    if (data.coverage !== undefined) return 'plan'
    if (data.props !== undefined) return 'look'
    if (data.cast !== undefined) return 'cast'
    if (data.screenplay !== undefined) return 'story'
    return undefined
}

/** The stage after this one; after the plan comes the rendering, which is not a stage of the plan. */
export const nextStage = (stage: PlanStage | undefined): PlanStage | undefined => stage === undefined ? 'story' : PLAN_STAGES[PLAN_STAGES.indexOf(stage) + 1]

/**
 * Ends the run here when --until names this stage: everything so far is saved, the next run goes on from it. The process
 * ends as --review's "stop" does - the lock and the run record are let go on exit.
 */
export function stopAfter(until: UntilStage | undefined, stage: UntilStage, file: string, resume: string) {
    if (until !== stage) return
    // shown also after a cached step, whose details only go into the log file
    log.info(`${styles.label('▸ Stopped')} ${styles.muted(`after ${STAGE_NAMES[stage]} (--until=${stage}) - it is saved in ${file}, the next run goes on from it`)}`)
    log.next(resume)
    process.exit(0)
}
