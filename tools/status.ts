// Where a project stands: which steps are done, which an edited input or setting will redo on the next run, which
// pictures and clips are rendered, missing or stale, and the command that comes next. Read-only - no lock, no LLM, no
// ComfyUI; the render estimate comes from the measured timings.
// usage: bun run status <project-id> [--json]
import {existsSync, readdirSync} from "node:fs";
import {join} from "node:path";
import {parseArgs} from "node:util";
import {loadProjectConfig} from "../lib/config.ts";
import {projectInputs, stepUsed} from "../lib/inputs.ts";
import {clipEstimate, pictureEstimate, renderState} from "../lib/render-state.ts";
import {log, styles} from "../lib/log.ts";
import {ProjectStore, STEP_NAMES} from "../lib/project.ts";
import {projectExists} from "../lib/project-setup.ts";
import {loadSettings} from "../lib/settings.ts";

const usage = 'usage: bun run status <project-id> [--json]'
const {values: args, positionals} = (() => {
    try {
        return parseArgs({args: Bun.argv.slice(2), allowPositionals: true, options: {json: {type: 'boolean', default: false}}})
    } catch (e) {
        return log.usageError(e instanceof Error ? e.message : String(e), usage)
    }
})()
const id = positionals[0]
if (!id || !projectExists(id)) {
    const projects = existsSync('projects') ? readdirSync('projects', {withFileTypes: true}).filter(d => d.isDirectory() && existsSync(join('projects', d.name, 'input'))).map(d => d.name) : []
    log.usageError(`${id ? `No project "${id}" in projects/` : 'Which project?'} - the projects here are: ${projects.join(', ')}`, usage)
}

const project = new ProjectStore(id!)
await project.load()
const config = await loadProjectConfig(project.dir)
const data = project.data

// what the next run will redo: changed inputs and settings, and stems whose files are gone - along the dependencies
const changed = project.changedInputs(await projectInputs(project.dir, config))
const lostStems = (['stems', 'instrumentStems'] as const).filter(step => data[step] && Object.values(data[step]!).some(file => !existsSync(join(project.dir, file))))
const redo = new Set(project.redoneBy([...changed.flatMap(c => c.steps), ...lostStems]))
type StepState = 'done' | 'redo' | 'missing' | 'unused'
const steps = STEP_NAMES.map(step => ({
    step,
    state: (!stepUsed(step, project.dir, data, config) ? 'unused' : redo.has(step) ? 'redo' : data[step] !== undefined ? 'done' : 'missing') as StepState,
}))

// renders, from the requests of the last plan run
const {pictures, missingPictures, clips, missingClips, staleClips, finalVideo, finalState} = await renderState(project.dir, project.id, config)

// the next command, with what it costs where that is known
const settings = await loadSettings({projectModel: config.llm.model})
const servers = settings.comfy.map(s => s.name)
const toPlan = steps.filter(s => s.state === 'redo' || s.state === 'missing').map(s => s.step)
let next: { command: string, why: string, estimate?: string }
if (toPlan.length || !clips.length) {
    next = {command: `bun index.ts ${project.id}`, why: toPlan.length ? `${toPlan.length} step(s) to generate: ${toPlan.join(', ')}` : 'no clip requests yet'}
} else if (missingPictures.length) {
    next = {command: `bun index.ts ${project.id} --render=images`, why: `${missingPictures.length} picture(s) missing`, estimate: await pictureEstimate(missingPictures.length, config, servers)}
} else if (missingClips.length || staleClips.length) {
    next = {
        command: `bun index.ts ${project.id} --render=videos${staleClips.length ? ' --refresh=clips' : ''}`,
        why: [missingClips.length ? `${missingClips.length} clip(s) missing` : '', staleClips.length ? `${staleClips.length} stale` : ''].filter(Boolean).join(', '),
        estimate: await clipEstimate([...missingClips, ...staleClips], config, servers),
    }
} else if (finalState !== 'current') {
    next = {command: `bun index.ts ${project.id} --render=final`, why: finalState === 'missing' ? 'no final video yet' : 'clips are newer than the final video'}
} else {
    next = {command: '', why: 'everything is done'}
}

if (args.json) {
    console.log(JSON.stringify({
        project: project.id,
        changedInputs: changed,
        steps,
        pictures: {total: pictures.length, missing: missingPictures.map(p => p.id)},
        clips: {total: clips.length, missing: missingClips.map(c => c.id), stale: staleClips.map(c => c.id)},
        finalVideo: finalState === 'missing' ? 'missing' : finalState === 'current' ? 'current' : 'older than the clips',
        next,
    }, null, 2))
    process.exit(0)
}

const mark: Record<StepState, string> = {done: styles.answer('✔'), redo: styles.warning('⟳'), missing: styles.warning('✗'), unused: styles.muted('–')}
log.section(`STATUS · ${project.id}`)
for (const c of changed) log.step('Changed', `${styles.name(c.name)} ${styles.muted(`- the next run redoes ${c.steps.join(', ')} and what is built on it`)}`)
for (const step of lostStems) log.step('Gone', `${styles.name(step)} ${styles.muted('- a stem file is missing, the next run separates them again')}`)
// in columns, in pipeline order
const width = Math.max(...steps.map(s => s.step.length)) + 4
const perLine = Math.max(1, Math.floor(((process.stdout.columns || 100) - 2) / width))
for (let i = 0; i < steps.length; i += perLine) {
    console.log(steps.slice(i, i + perLine).map(({step, state}) => `${mark[state]} ${(state === 'unused' ? styles.muted : (t: string) => t)(step.padEnd(width - 2))}`).join(''))
}
console.log(styles.muted(`✔ done · ⟳ redone by the next run · ✗ not generated yet · – not used by this project`))

log.section('RENDERS')
log.step('Pictures', pictures.length ? `${pictures.length - missingPictures.length} of ${pictures.length} rendered${missingPictures.length ? styles.muted(` - missing: ${missingPictures.map(p => p.id).join(', ')}`) : ''}` : styles.muted('no plan yet'))
log.step('Clips', clips.length ? `${clips.length - missingClips.length} of ${clips.length} rendered${staleClips.length ? styles.warning(` · ${staleClips.length} stale: ${staleClips.map(c => c.id).join(', ')}`) : ''}` : styles.muted('no plan yet'))
log.step('Final video', finalState === 'missing' ? styles.muted('not assembled yet') : finalState === 'current' ? finalVideo : styles.warning(`${finalVideo} - older than its clips`))

log.section('NEXT')
if (next.command) {
    log.step('Next', `${next.command} ${styles.muted(`- ${next.why}`)}`)
    if (next.estimate) log.step('Estimate', styles.muted(next.estimate))
} else log.step('Done', styles.muted(next.why))
