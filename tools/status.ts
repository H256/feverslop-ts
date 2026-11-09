import {cli} from '../lib/cli.ts'
// Where a project stands: which steps are done, which an edited input or setting will redo on the next run, which
// pictures and clips are rendered, missing or stale, and the command that comes next. Read-only - no lock, no LLM, no
// ComfyUI; the render estimate comes from the measured timings. --film: the same for a film in films/.
// usage: bun run status <project-id> [--json] [--film]
import {join} from 'node:path'
import {parseArgs} from 'node:util'
import {log, styles} from '../lib/log.ts'
import {listProjects, projectExists} from '../lib/project-setup.ts'
import {filmExists, filmIds} from '../lib/film/setup.ts'
import {FILMS_DIR} from '../lib/film/store.ts'
import {filmStatus, projectStatus, type StepState} from '../lib/status.ts'
import {lastRun, runState} from '../lib/run-record.ts'
import {lastRunLines} from '../lib/run-record-view.ts'
cli('status')

const usage = 'usage: bun run status <project-id> [--json] [--film]'
const {values: args, positionals} = (() => {
    try {
        return parseArgs({
            args: Bun.argv.slice(2),
            allowPositionals: true,
            options: {json: {type: 'boolean', default: false}, film: {type: 'boolean', default: false}},
        })
    } catch (e) {
        return log.usageError(e instanceof Error ? e.message : String(e), usage)
    }
})()
const id = positionals[0]

if (args.film) {
    if (!id || !filmExists(id)) {
        log.usageError(`${id ? `No film "${id}" in ${FILMS_DIR}/` : 'Which film?'} - the films here are: ${filmIds().join(', ')}`, usage)
    }
} else if (!id || !projectExists(id)) {
    log.usageError(`${id ? `No project "${id}" in projects/` : 'Which project?'} - the projects here are: ${listProjects().join(', ')}`, usage)
}

const {dir, changed, notes, steps, render, next, preproduction, json} = args.film ? await filmStatus(id!) : await projectStatus(id!)
const {pictures, missingPictures, stalePictures, clips, missingClips, staleClips, finalVideo, finalState} = render
const finalLabel = args.film ? 'Film' : 'Final video'
const run = lastRun(dir)

if (args.json) {
    log.json({
        ...json,
        lastRun: run ? {...run, state: runState(run)} : null,
        changedInputs: changed,
        steps,
        pictures: {total: pictures.length, missing: missingPictures.map(p => p.id), stale: stalePictures.map(p => p.id)},
        clips: {total: clips.length, missing: missingClips.map(c => c.id), stale: staleClips.map(c => c.id)},
        finalVideo: finalState === 'missing' ? 'missing' : finalState === 'current' ? 'current' : 'older than the clips',
        next,
        preproduction,
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
    log.info(
        steps
            .slice(i, i + perLine)
            .map(({step, state}) => `${mark[state]} ${(state === 'unused' ? styles.muted : (t: string) => t)(step.padEnd(width - 2))}`)
            .join(''),
    )
}
log.info(styles.muted(`✔ done · ⟳ redone by the next run · ✗ not generated yet · – not used by this ${args.film ? 'film' : 'project'}`))

log.section('RENDERS')
log.step(
    'Pictures',
    pictures.length
        ? `${pictures.length - missingPictures.length} of ${pictures.length} rendered${missingPictures.length ? styles.muted(` - missing: ${missingPictures.map(p => p.id).join(', ')}`) : ''}${stalePictures.length ? styles.warning(` · ${stalePictures.length} stale: ${stalePictures.map(p => p.id).join(', ')}`) : ''}`
        : styles.muted('no plan yet'),
)
log.step(
    'Clips',
    clips.length
        ? `${clips.length - missingClips.length} of ${clips.length} rendered${staleClips.length ? styles.warning(` · ${staleClips.length} stale: ${staleClips.map(c => c.id).join(', ')}`) : ''}`
        : styles.muted('no plan yet'),
)
log.step(
    finalLabel,
    finalState === 'missing'
        ? styles.muted('not assembled yet')
        : finalState === 'current'
          ? finalVideo
          : styles.warning(`${finalVideo} - older than its clips`),
)

if (run && runState(run) !== 'finished') {
    log.section('LAST RUN')
    for (const line of lastRunLines(run)) log.line(line)
}

log.section('NEXT')
if (next.command) {
    log.info(styles.muted(next.why))
    log.next(next.command)
    if (next.estimate) log.step('Estimate', styles.muted(next.estimate))
} else log.step('Done', styles.muted(next.why))
