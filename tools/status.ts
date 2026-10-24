import {cli} from '../lib/cli.ts';
// Where a project stands: which steps are done, which an edited input or setting will redo on the next run, which
// pictures and clips are rendered, missing or stale, and the command that comes next. Read-only - no lock, no LLM, no
// ComfyUI; the render estimate comes from the measured timings. --film: the same for a film in films/.
// usage: bun run status <project-id> [--json] [--film]
import {existsSync, readdirSync} from "node:fs";
import {join} from "node:path";
import {parseArgs} from "node:util";
import {loadProjectConfig} from "../lib/config.ts";
import {projectInputs, stepUsed} from "../lib/inputs.ts";
import {clipEstimate, pictureEstimate, type RenderState, renderState} from "../lib/render-state.ts";
import {log, styles} from "../lib/log.ts";
import {ProjectStore, STEP_NAMES} from "../lib/project.ts";
import {projectExists} from "../lib/project-setup.ts";
import {loadSettings} from "../lib/settings.ts";
import {loadFilmConfig} from "../lib/film/config.ts";
import {filmInputs, filmMode, filmStepUsed} from "../lib/film/inputs.ts";
import {filmRenderConfig} from "../lib/film/pictures.ts";
import {filmRenderState} from "../lib/film/render.ts";
import {filmExists} from "../lib/film/setup.ts";
import {FILM_STEP_NAMES, FILMS_DIR, FilmStore} from "../lib/film/store.ts";
cli('status')


const usage = 'usage: bun run status <project-id> [--json] [--film]'
const {values: args, positionals} = (() => {
    try {
        return parseArgs({args: Bun.argv.slice(2), allowPositionals: true, options: {json: {type: 'boolean', default: false}, film: {type: 'boolean', default: false}}})
    } catch (e) {
        return log.usageError(e instanceof Error ? e.message : String(e), usage)
    }
})()
const id = positionals[0]

type StepState = 'done' | 'redo' | 'missing' | 'unused'
type Next = { command: string, why: string, estimate?: string }
// what is printed, of a music video's project or of a film
type Status = {
    id: string,
    changed: { name: string, steps: string[] }[],
    notes: [string, string][],      // more lines under the changed inputs: label, text
    steps: { step: string, state: StepState }[],
    render: RenderState<{ id: string }>,
    next: Next,
    json: Record<string, unknown>,  // the parts of --json that differ between the two
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

async function projectStatus(id: string): Promise<Status> {
    const project = new ProjectStore(id)
    await project.load()
    const config = await loadProjectConfig(project.dir)
    const data = project.data

    // what the next run will redo: changed inputs and settings, and stems whose files are gone - along the dependencies
    const changed = project.changedInputs(await projectInputs(project.dir, config))
    const lostStems = (['stems', 'instrumentStems'] as const).filter(step => data[step] && Object.values(data[step]!).some(file => !existsSync(join(project.dir, file))))
    const redo = new Set(project.redoneBy([...changed.flatMap(c => c.steps), ...lostStems]))
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
    return {
        id: project.id, changed, steps, render, next,
        notes: lostStems.map(step => ['Gone', `${styles.name(step)} ${styles.muted('- a stem file is missing, the next run separates them again')}`]),
        json: {project: project.id},
    }
}

async function filmStatus(id: string): Promise<Status> {
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
    return {id: film.id, changed, steps, render, next, notes: [['Mode', styles.muted(mode === 'screenplay' ? 'a screenplay of your own' : 'developed from an idea')]], json: {film: film.id}}
}

if (args.film) {
    if (!id || !filmExists(id)) {
        const films = existsSync(FILMS_DIR) ? readdirSync(FILMS_DIR, {withFileTypes: true}).filter(d => d.isDirectory() && existsSync(join(FILMS_DIR, d.name, 'input'))).map(d => d.name) : []
        log.usageError(`${id ? `No film "${id}" in ${FILMS_DIR}/` : 'Which film?'} - the films here are: ${films.join(', ')}`, usage)
    }
} else if (!id || !projectExists(id)) {
    const projects = existsSync('projects') ? readdirSync('projects', {withFileTypes: true}).filter(d => d.isDirectory() && existsSync(join('projects', d.name, 'input'))).map(d => d.name) : []
    log.usageError(`${id ? `No project "${id}" in projects/` : 'Which project?'} - the projects here are: ${projects.join(', ')}`, usage)
}

const {changed, notes, steps, render, next, json} = args.film ? await filmStatus(id!) : await projectStatus(id!)
const {pictures, missingPictures, clips, missingClips, staleClips, finalVideo, finalState} = render
const finalLabel = args.film ? 'Film' : 'Final video'

if (args.json) {
    log.json({
        ...json,
        changedInputs: changed,
        steps,
        pictures: {total: pictures.length, missing: missingPictures.map(p => p.id)},
        clips: {total: clips.length, missing: missingClips.map(c => c.id), stale: staleClips.map(c => c.id)},
        finalVideo: finalState === 'missing' ? 'missing' : finalState === 'current' ? 'current' : 'older than the clips',
        next,
    })
    process.exit(0)
}

const mark: Record<StepState, string> = {done: styles.answer('✔'), redo: styles.warning('⟳'), missing: styles.warning('✗'), unused: styles.muted('–')}
for (const c of changed) log.step('Changed', `${styles.name(c.name)} ${styles.muted(`- the next run redoes ${c.steps.join(', ')} and what is built on it`)}`)
for (const [label, text] of notes) log.step(label, text)
// in columns, in pipeline order
const width = Math.max(...steps.map(s => s.step.length)) + 4
const perLine = Math.max(1, Math.floor(((process.stdout.columns || 100) - 2) / width))
for (let i = 0; i < steps.length; i += perLine) {
    log.info(steps.slice(i, i + perLine).map(({step, state}) => `${mark[state]} ${(state === 'unused' ? styles.muted : (t: string) => t)(step.padEnd(width - 2))}`).join(''))
}
log.info(styles.muted(`✔ done · ⟳ redone by the next run · ✗ not generated yet · – not used by this ${args.film ? 'film' : 'project'}`))

log.section('RENDERS')
log.step('Pictures', pictures.length ? `${pictures.length - missingPictures.length} of ${pictures.length} rendered${missingPictures.length ? styles.muted(` - missing: ${missingPictures.map(p => p.id).join(', ')}`) : ''}` : styles.muted('no plan yet'))
log.step('Clips', clips.length ? `${clips.length - missingClips.length} of ${clips.length} rendered${staleClips.length ? styles.warning(` · ${staleClips.length} stale: ${staleClips.map(c => c.id).join(', ')}`) : ''}` : styles.muted('no plan yet'))
log.step(finalLabel, finalState === 'missing' ? styles.muted('not assembled yet') : finalState === 'current' ? finalVideo : styles.warning(`${finalVideo} - older than its clips`))

log.section('NEXT')
if (next.command) {
    log.info(styles.muted(next.why))
    log.next(next.command)
    if (next.estimate) log.step('Estimate', styles.muted(next.estimate))
} else log.step('Done', styles.muted(next.why))
