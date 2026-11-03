import {existsSync} from "node:fs";
import {join} from "node:path";
import {loadProjectConfig} from "./config.ts";
import {projectInputs, stepUsed} from "./inputs.ts";
import {clipEstimate, pictureEstimate, type RenderState, renderState} from "./render-state.ts";
import {styles} from "./log.ts";
import {ProjectStore, STEP_NAMES, unplannedBeats} from "./project.ts";
import {loadSettings} from "./settings.ts";
import {loadFilmConfig} from "./film/config.ts";
import {filmInputs, filmMode, filmStepUsed} from "./film/inputs.ts";
import {filmRenderConfig} from "./film/pictures.ts";
import {filmRenderState} from "./film/render.ts";
import {FILM_STEP_NAMES, FilmStore} from "./film/store.ts";
import {type Preproduction, preproductionOf} from "./editor/preproduction.ts";

// Where a project stands - for bun run status and the workspace. Read-only: no lock, no LLM, no ComfyUI; the render estimate comes
// from the measured timings.

export type StepState = 'done' | 'redo' | 'missing' | 'unused'
export type Next = { command: string, why: string, estimate?: string }
// what is printed, of a music video's project or of a film
export type Status = {
    id: string,
    dir: string,
    changed: { name: string, steps: string[] }[],
    notes: [string, string][],      // more lines under the changed inputs: label, text
    steps: { step: string, state: StepState }[],
    render: RenderState<{ id: string }>,
    next: Next,
    preproduction: Preproduction,   // the stage the plan is at, a casting not taken over yet, a story proposal waiting
    json: Record<string, unknown>,  // the parts of --json that differ between the two
}

/**
 * What the preproduction adds to the next command and the notes: a casting.json the project does not have yet comes first - its
 * plan run takes it over and plans again what was planned from the old texts (the run itself names that only once).
 */
export function withPreproduction(next: Next, pre: Preproduction, kind: 'music' | 'film', id: string): { next: Next, notes: [string, string][] } {
    const notes: [string, string][] = []
    const stageNames = {story: kind === 'film' ? 'the screenplay' : 'the story', cast: 'the cast', look: 'the look', plan: 'the shot plan'}
    if (pre.stage !== 'plan') notes.push(['Stage', pre.stage ? `planned up to ${stageNames[pre.stage]}${pre.next ? styles.muted(` - next: ${stageNames[pre.next]} (${kind === 'film' ? 'bun film.ts' : 'bun index.ts'} ${id}${pre.next !== 'plan' ? ` --until=${pre.next}` : ''})`) : ''}` : styles.muted('nothing planned yet')])
    for (const change of pre.casting.changes) notes.push(['Casting', `${change} ${styles.muted('- casting.json, not taken over yet')}`])
    if (pre.storyProposal) notes.push(['Story', `${styles.muted('a story told anew for the cast waits:')} bun run story ${id} --take ${styles.muted('or --drop')}`])
    if (!pre.nextCommand) return {next, notes}
    return {notes, next: {command: pre.nextCommand, why: `casting.json changed: ${pre.casting.changes.join(', ')}${pre.casting.redo.length ? ` - planned again: ${pre.casting.redo.join(', ')}` : ''}`}}
}

/** The next command, with what it costs where that is known: plan, pictures, clips, final video - the first that is not done. */
async function nextOf(run: string, toPlan: string[], render: RenderState<{ id: string, frames: number }>, estimates: {
    pictures: (count: number) => Promise<string>, clips: (clips: { frames: number }[]) => Promise<string>,
}, finalName: string): Promise<Next> {
    const {missingPictures, clips, missingClips, staleClips, finalState} = render
    if (toPlan.length || !clips.length) return {command: run, why: toPlan.length ? `${toPlan.length} step(s) to generate: ${toPlan.join(', ')}` : 'no clip requests yet'}
    if (missingPictures.length) return {command: `${run} --render=images`, why: `${missingPictures.length} picture(s) missing`, estimate: await estimates.pictures(missingPictures.length)}
    if (missingClips.length || staleClips.length) {
        return {
            command: `${run} --render=videos${staleClips.length ? ' --refresh=clips' : ''}`,
            why: [missingClips.length ? `${missingClips.length} clip(s) missing` : '', staleClips.length ? `${staleClips.length} stale` : ''].filter(Boolean).join(', '),
            estimate: await estimates.clips([...missingClips, ...staleClips]),
        }
    }
    if (finalState !== 'current') return {command: `${run} --render=final`, why: finalState === 'missing' ? `no ${finalName} yet` : `clips are newer than the ${finalName}`}
    return {command: '', why: 'everything is done'}
}

export async function projectStatus(id: string): Promise<Status> {
    const project = new ProjectStore(id)
    await project.load()
    const config = await loadProjectConfig(project.dir)
    const data = project.data

    // what the next run will redo: changed inputs and settings, and stems whose files are gone - along the dependencies
    const changed = project.changedInputs(await projectInputs(project.dir, config))
    const lostStems = (['stems', 'instrumentStems'] as const).filter(step => data[step] && Object.values(data[step]!).some(file => !existsSync(join(project.dir, file))))
    const redo = new Set(project.redoneBy([...changed.flatMap(c => c.steps), ...lostStems]))
    // beats without a shot plan among planned ones: the next run plans just those
    const unplanned = unplannedBeats(data)
    if (unplanned.length) redo.add('shotMoments')
    const steps = STEP_NAMES.map(step => ({
        step,
        state: (!stepUsed(step, project.dir, data, config) ? 'unused' : redo.has(step) ? 'redo' : data[step] !== undefined ? 'done' : 'missing') as StepState,
    }))

    // renders, from the requests of the last plan run
    const render = await renderState(project.dir, project.id, config)

    const settings = await loadSettings({projectModel: config.llm.model})
    const servers = settings.comfy.map(s => s.name)
    const toPlan = steps.filter(s => s.state === 'redo' || s.state === 'missing').map(s => s.step)
    const next = await nextOf(`bun index.ts ${project.id}`, toPlan, render, {
        pictures: count => pictureEstimate(count, config, servers),
        clips: clips => clipEstimate(clips, config, servers),
    }, 'final video')
    const preproduction = await preproductionOf({id: project.id, kind: 'music', dir: project.dir})
    const withPre = withPreproduction(next, preproduction, 'music', project.id)
    return {
        id: project.id, dir: project.dir, changed, steps, render, next: withPre.next, preproduction,
        notes: [
            ...withPre.notes,
            ...lostStems.map(step => ['Gone', `${styles.name(step)} ${styles.muted('- a stem file is missing, the next run separates them again')}`] as [string, string]),
            ...(unplanned.length ? [['Unplanned', `${unplanned.map(styles.name).join(', ')} ${styles.muted('- no shot plan, the next run plans just these')}`] as [string, string]] : []),
        ],
        json: {project: project.id},
    }
}

export async function filmStatus(id: string): Promise<Status> {
    const film = new FilmStore(id)
    await film.load()
    const config = await loadFilmConfig(film.dir)
    const mode = await filmMode(film.dir)

    const changed = film.changedInputs(await filmInputs(film.dir, config))
    const redo = new Set(film.redoneBy(changed.flatMap(c => c.steps)))
    const steps = FILM_STEP_NAMES.map(step => ({
        step,
        state: (!filmStepUsed(step, mode, film.data, config) ? 'unused' : redo.has(step) ? 'redo' : film.data[step] !== undefined ? 'done' : 'missing') as StepState,
    }))
    const renderConfig = filmRenderConfig(config)
    const render = await filmRenderState(film.dir, film.id, renderConfig)

    const settings = await loadSettings({projectModel: config.llm.model})
    const servers = settings.comfy.map(s => s.name)
    // the subtitles are translated when the film is assembled, not by a plan run
    const toPlan = steps.filter(s => (s.state === 'redo' || s.state === 'missing') && s.step !== 'subtitles').map(s => s.step)
    const next = await nextOf(`bun film.ts ${film.id}`, toPlan, render, {
        pictures: count => pictureEstimate(count, renderConfig, servers),
        clips: clips => clipEstimate(clips, renderConfig, servers),
    }, 'film')
    const preproduction = await preproductionOf({id: film.id, kind: 'film', dir: film.dir})
    const withPre = withPreproduction(next, preproduction, 'film', film.id)
    return {id: film.id, dir: film.dir, changed, steps, render, next: withPre.next, preproduction, notes: [['Mode', styles.muted(mode === 'screenplay' ? 'a screenplay of your own' : 'developed from an idea')], ...withPre.notes], json: {film: film.id}}
}
