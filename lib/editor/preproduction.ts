import {noProject} from '../usage.ts'
import {type Project} from '../project.ts'
import {type PlanStage} from '../stages.ts'
import {projectDir, projectExists, validProjectId, listProjects} from '../project-setup.ts'
import {filmDir, filmExists, filmIds} from '../film/setup.ts'
import type {FilmProject} from '../film/types.ts'
import type {EditorTarget} from './project.ts'
import type {CastingRedo} from '../../shared/workspace.ts'
import {dataOf, planStateOf, stageOf} from './preproduction/base.ts'
import {castingRedo} from './preproduction/cast.ts'
import {screenplayProposal, storyProposal} from './preproduction/story.ts'
export type {
    CastingRedo,
    CastMember,
    CastView,
    CastChange,
    CastResult,
    BookView,
    LookElement,
    LookView,
    LookChange,
    LookResult,
} from '../../shared/workspace.ts'

// The preproduction in the workspace (issue #526): the book, the cast and the look are looked at and changed before the shots
// are planned and long before anything is rendered. What is changed here is put into project.json as the pipeline would have
// written it, and every step built on it goes - the next plan run makes those again from it (the language model only). Nothing
// is rendered: pictures and clips made before stay, and are stale once the plan has new prompts for them.
// Its parts: preproduction/base.ts (project.json, element steps), cast.ts, story.ts, look.ts (#841). This file is what the
// workspace and the commands import.
export {stepNamesOf, planStateOf, stageOf} from './preproduction/base.ts'
export * from './preproduction/cast.ts'
export * from './preproduction/story.ts'
export * from './preproduction/look.ts'

////////// FROM THE TERMINAL - the same as the pages, as commands (tools/story.ts, cast.ts, look.ts, casting.ts - CLI first, #548)

/** The project or film a command is about, or why there is none. */
export function commandTarget(id: string | undefined, film: boolean): EditorTarget | string {
    if (!id) return film ? noProject('film', undefined, filmIds()) : noProject('project', undefined, listProjects())
    if (!validProjectId(id)) return `"${id}" is no project id`
    if (film) return filmExists(id) ? {id, kind: 'film', dir: filmDir(id)} : noProject('film', id, filmIds())
    return projectExists(id) ? {id, kind: 'music', dir: projectDir(id)} : noProject('project', id, listProjects())
}

/**
 * The command that plans what a change left to plan: up to the stage the project is at, and at least up to the stage of the change
 * (a look written anew is written by --until=look, even where the cast went too) - a planned project all of it. `redo`: steps first.
 */
export function planCommand(target: EditorTarget, change: PlanStage, redo: string[] = []): string {
    const at = stageOf(target)
    const stages: PlanStage[] = ['story', 'cast', 'look', 'plan']
    const until = stages[Math.max(stages.indexOf(change), at ? stages.indexOf(at) : -1)]!
    return `bun ${target.kind === 'film' ? 'film.ts' : 'index.ts'} ${target.id}${redo.length ? ` --redo=${redo.join(',')}` : ''}${until !== 'plan' ? ` --until=${until}` : ''}`
}

////////// WHERE THE PREPRODUCTION STANDS - for bun run status and the workspace alike

export type Preproduction = {
    stage?: PlanStage // the last stage the plan has
    next?: PlanStage // the one a plan run makes next
    casting: CastingRedo // what casting.json says that the project does not have yet, and the --redo for it
    storyProposal: boolean // a story told anew for the cast waits to be taken or dropped
    nextCommand?: string // the plan run that takes the casting over - only when there is something to take over
}

export async function preproductionOf(target: EditorTarget): Promise<Preproduction> {
    const data = dataOf(target)
    const casting = await castingRedo(target)
    return {
        ...planStateOf(target.kind, data),
        casting,
        storyProposal:
            target.kind === 'music'
                ? storyProposal(target.dir, (data as Project).story) !== undefined
                : screenplayProposal(target.dir, data as FilmProject) !== undefined,
        ...(casting.changes.length ? {nextCommand: planCommand(target, 'cast', casting.redo)} : {}),
    }
}
