import {type DryRun} from '../../shared/workspace.ts'
import {formatSlotRanges} from '../assemble.ts'
import {onlyClips} from '../batch.ts'
import {projectInputs, stepUsed} from '../inputs.ts'
import {jsonOutput, log, styles} from '../log.ts'
import {projectLyricSections} from '../music.ts'
import {STEP_NAMES, type StepName, unplannedBeats} from '../project.ts'
import {clipEstimate, clipFailureRisks, pictureEstimate, renderState} from '../render-state.ts'
import {readTimings} from '../timings.ts'
import {existsSync} from 'node:fs'
import {join} from 'node:path'
import type {ProjectConfig} from '../config.ts'
import type {ProjectStore} from '../project.ts'
import type {Settings} from '../settings.ts'

// What a music video's run would do (index.ts --dry-run, #841): the steps it would redo and why, the steps not made yet, and what
// --render would render with the estimate. Only reads.

/** What makes steps be redone: the project, its inputs and settings as the run read them. */
export type ReasonsRun = {
    project: ProjectStore
    config: ProjectConfig
    readInput: (name: string) => Promise<string>
    redoWhole: StepName[]
    timelineOutdated: boolean
}

/** And what a dry run says beyond the reasons: what would be rendered. */
export type DryRunRun = ReasonsRun & {
    settings: Settings
    args: {only: string; again: boolean}
    render: Set<string>
    refreshKinds: Set<string>
    replanBeats: string[]
}

/**
 * --dry-run: the steps the run would redo (by --redo, by changed inputs and settings, by gone stems, by changed lyrics
 * sections or clip length - along the dependencies) and the steps not generated yet, then what --render would render,
 * with the estimate from the measured timings. The renders are counted from the requests of the last plan run.
 */
/** What makes this run redo steps, with the steps each one names: --redo, changed inputs and settings, gone stems, changed sections, clip length. */
export async function redoReasons(run: ReasonsRun): Promise<[string, StepName[]][]> {
    const {project, config, readInput, redoWhole, timelineOutdated} = run
    const changed = project.changedInputs(await projectInputs(project.dir, config))
    const lostStems = (['stems', 'instrumentStems'] as const).filter(
        step => project.data[step] && Object.values(project.data[step]!).some(file => !existsSync(join(project.dir, file))),
    )
    const labels = projectLyricSections(
        await readInput('lyrics.txt'),
        project.data.music?.sections.map(s => s.label),
    ).map(s => s.label)
    const sectionsChanged =
        project.data.music !== undefined && labels.length > 0 && project.data.music.sections.map(s => s.label).join('|') !== labels.join('|')
    return [
        ...(redoWhole.length ? [['--redo', redoWhole] as [string, StepName[]]] : []),
        ...changed.map(c => [`${c.name} changed`, c.steps] as [string, StepName[]]),
        ...lostStems.map(step => [`a file of ${step} is gone`, [step]] as [string, StepName[]]),
        ...(sectionsChanged ? [['the lyrics sections changed', ['music']] as [string, StepName[]]] : []),
        ...(timelineOutdated ? [['the longest clip changed', ['timeline']] as [string, StepName[]]] : []),
    ]
}

export async function dryRun(run: DryRunRun) {
    const {project, config, settings, args, render, refreshKinds, replanBeats} = run
    const reasons = await redoReasons(run)
    const redone = project.redoneBy(reasons.flatMap(([, steps]) => steps))
    // whether a step is used is read from the project as it is once the redone steps are gone (the blocking is made when the shots are planned again)
    const after = Object.fromEntries(Object.entries(project.data).filter(([step]) => !(redone as string[]).includes(step)))
    const missing = STEP_NAMES.filter(step => project.data[step] === undefined && !redone.includes(step) && stepUsed(step, project.dir, after, config))
    const unplanned = redone.includes('shotMoments') ? [] : [...new Set([...replanBeats, ...unplannedBeats(project.data)])]
    const staleAfter = (project.data.mapping ?? []).filter(m => unplanned.includes(m.beatId)).map(m => m.slotId)
    // the same as data, for the workspace's question before a plan run (--json, #836)
    const found: DryRun = {
        reasons: reasons.map(([why, steps]) => ({why, steps})),
        redone,
        plannedAgain: unplanned,
        staleAfter,
        generated: missing,
        warnings: [],
    }
    const said = (text: string) => Bun.stripANSI(text)

    log.section('DRY RUN - nothing is done')
    for (const [why, steps] of reasons) log.step(why, styles.muted(`redoes ${steps.join(', ')}`))
    log.step('Redone', redone.length ? redone.map(styles.name).join(', ') : styles.muted('nothing - every step is taken from project.json'))
    if (unplanned.length) {
        const why = replanBeats.length ? '- named by --beats or without a shot plan yet' : '- no shot plan yet'
        log.step('Planned again', `${unplanned.map(styles.name).join(', ')} ${styles.muted(`${why}, the other beats stay`)}`)
        if (staleAfter.length)
            log.step('Stale after', `${formatSlotRanges(staleAfter)} ${styles.muted('- render them again with --render=videos --refresh=clips')}`)
    }
    if (missing.length) log.step('Generated', `${missing.map(styles.name).join(', ')} ${styles.muted('- not generated yet')}`)

    if (render.has('images') || render.has('videos') || render.has('final')) {
        const state = await renderState(project.dir, project.id, config)
        const servers = settings.comfy.map(s => s.name)
        const warn = (text: string) => {
            found.warnings.push(said(text))
            log.warn(text)
        }
        if (redone.length || missing.length) warn('the renders below are counted from the requests of the last plan run - the steps redone now can change them')
        if (render.has('images')) {
            const stale = refreshKinds.has('pictures') ? styles.muted(' (stale pictures are not counted - --refresh=pictures renders those too)') : ''
            const estimate = state.missingPictures.length ? await pictureEstimate(state.missingPictures.length, config, servers) : undefined
            found.pictures = {count: state.missingPictures.length, estimate: estimate && said(estimate)}
            log.step('Pictures', estimate ? `${estimate}${stale}` : styles.muted('all rendered'))
        }
        if (render.has('videos')) {
            const only = new Set(args.only.split(',').filter(Boolean))
            const selected = onlyClips(state.clips, only)
            const todo = selected.filter(c => args.again || state.missingClips.includes(c) || (refreshKinds.has('clips') && state.staleClips.includes(c)))
            for (const risk of clipFailureRisks(readTimings(), todo, config.videoWorkflow, servers)) warn(risk)
            const estimate = todo.length ? await clipEstimate(todo, config, servers) : undefined
            found.clips = {ids: todo.map(c => c.id), estimate: estimate && said(estimate)}
            log.step('Clips', estimate ? `${estimate} ${styles.muted(`- ${formatSlotRanges(todo.map(c => c.id))}`)}` : styles.muted('all rendered'))
        }
        if (render.has('final')) {
            found.final = {missingClips: state.missingClips.length}
            log.step(
                'Final video',
                state.missingClips.length
                    ? styles.warning(`needs every clip - ${state.missingClips.length} missing`)
                    : styles.muted('assembled from the clips'),
            )
        }
    }
    if (jsonOutput()) log.json(found)
}
