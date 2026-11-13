import {languageName} from '../config.ts'
import {directionPlanNotes, directionPlanRules, recordPlannedDirection} from '../direction/service.ts'
import {CoverageProblem, type RawCoverage, toCoverage} from '../film/coverage.ts'
import {askFilmJson as askJson} from '../film/json.ts'
import {namedByScene} from '../film/names.ts'
import {coveragePrompt} from '../film/prompts.ts'
import {estimateSeconds, locationOf} from '../film/screenplay.ts'
import {maxShotsFor} from '../film/shot-checks.ts'
import {type SceneCoverage} from '../film/types.ts'
import {log, styles} from '../log.ts'
import type {LoadedFilmConfig} from '../film/config.ts'
import type {FilmStore} from '../film/store.ts'
import type {Brief, FilmCast, FilmMode, FilmProp, LocationView, Screenplay} from '../film/types.ts'

// The shots of a film (film.ts step 9, #841): every scene broken into shots, one LLM call per scene, checked and asked again where a
// shot breaks a rule. The step is the film's (film.step/film.each): cached per scene, redone by --redo or --scenes, the same as
// when it was part of film.ts.

/** What the shots are planned from: the film, its screenplay, cast, look and places, and the scenes planned again. */
export type FilmShotsRun = {
    film: FilmStore
    config: LoadedFilmConfig
    mode: FilmMode
    brief: Brief
    screenplay: Screenplay
    cast: FilmCast
    lookBrief: string
    locationViews: Record<string, LocationView[]>
    props: FilmProp[]
    sceneIds: Set<string>
    keptCoverage: SceneCoverage[] | undefined
    keptBasis: string | undefined
    coverageBasis: () => string
}

export async function planFilmShots(run: FilmShotsRun) {
    const {film, config, mode, brief, screenplay, cast, lookBrief, locationViews, props, sceneIds, keptCoverage, keptBasis, coverageBasis} = run
    /////////// 9 · SHOTS - every scene broken into shots, one LLM call per scene
    // the length of the film: asked for in the config (an idea always has one), shared out to the scenes by the length of their script
    const sceneWeight = (scene: (typeof screenplay.scenes)[number]) => estimateSeconds({...screenplay, scenes: [scene]})
    const totalWeight = screenplay.scenes.reduce((sum, s) => sum + sceneWeight(s), 0)
    const budgeted = config.targetDuration > 0 && (mode === 'idea' || config.targetDurationSet)
    const budgetOf = (scene: (typeof screenplay.scenes)[number]) =>
        budgeted ? Math.max(4, Math.round((config.targetDuration * sceneWeight(scene)) / totalWeight)) : undefined
    if (budgeted) log.step('Planned length', `${config.targetDuration}s ${styles.muted('- every scene gets its share of it')}`)
    // the director's edits (direction.json): a plan made again keeps to them - the code enforces them on it as well (applyDirectionOverlay)
    const directionTarget = {id: film.id, dir: film.dir, kind: 'film' as const}
    const directionNotes = directionPlanNotes(directionTarget, film.data)
    // the rules each scene gets as notes: a scene planned now has them in its shots, a preview need not write them again (#960)
    const directionRules = directionPlanRules(directionTarget, film.data)
    const plannedNow: string[] = []
    const coverage = await film.step('coverage', '9 · PLANNING THE SHOTS', async () => {
        const result: SceneCoverage[] = []
        // what the scene before ended with, by the names of the cast - the shots of this scene start from it where the scene goes on
        const handover = (i: number) => {
            const previous = result[i - 1]
            const ends = Object.entries(previous?.ends ?? {}).map(([id, where]) => [cast.characters.find(c => c.id === id)?.name ?? id, where] as const)
            return previous && ends.length ? {scene: previous.sceneId, ends: Object.fromEntries(ends), view: previous.shots.at(-1)?.view} : undefined
        }
        const keepsShots = keptBasis === undefined || keptBasis === coverageBasis()
        if (!keepsShots)
            log.warn('the screenplay, cast or look changed since the shots were planned - every scene is planned again, --scenes cannot keep the old shots')
        for (const [i, scene] of screenplay.scenes.entries()) {
            // a scene that is not named keeps the shots it had
            const kept = keepsShots ? keptCoverage?.find(c => c.sceneId === scene.id) : undefined
            if (sceneIds.size && !sceneIds.has(scene.id) && kept) {
                log.step(`Scene ${i + 1}/${screenplay.scenes.length}`, styles.muted(`${scene.id} keeps its shots`))
                result.push(kept)
                continue
            }
            log.step(`Scene ${i + 1}/${screenplay.scenes.length}`, styles.name(`${scene.setting}. ${scene.location} - ${scene.time}`))
            const location = locationOf(cast, scene.location)!
            const planScene = async () => {
                let problems: string[] = []
                for (let attempt = 0; ; attempt++) {
                    const raw = await askJson<RawCoverage>(
                        coveragePrompt(
                            scene,
                            location,
                            cast.characters,
                            languageName(brief.language) ?? brief.language,
                            lookBrief,
                            budgetOf(scene),
                            maxShotsFor(scene),
                            problems,
                            handover(i),
                            locationViews[location.id],
                            i + 1,
                            props,
                            directionNotes[scene.id],
                        ),
                    )
                    try {
                        // the first time what the script checks find is a reason to ask again, the second time it is only noted
                        const {coverage: planned, notes} = toCoverage(
                            raw,
                            scene,
                            cast,
                            attempt === 0,
                            namedByScene(screenplay.scenes, cast.characters, i),
                            i + 1,
                            props,
                        )
                        for (const note of notes) log.warn(note)
                        return planned
                    } catch (e) {
                        // a dropped line of dialogue or a wrong name is what the model can fix when told - once
                        if (!(e instanceof CoverageProblem) || attempt >= 1) throw e
                        problems = e.problems
                        log.warn(`${e.message} - asking again`)
                    }
                }
            }
            // kept as soon as it is planned: a failure on a later scene does not cost the scenes before it. What it was asked
            // (the first prompt, with the hand-over of the scene before) decides whether it is asked again
            const firstAsk = coveragePrompt(
                scene,
                location,
                cast.characters,
                languageName(brief.language) ?? brief.language,
                lookBrief,
                budgetOf(scene),
                maxShotsFor(scene),
                [],
                handover(i),
                locationViews[location.id],
                i + 1,
                props,
                directionNotes[scene.id],
            )
            result.push(await film.each('coverage', scene.id, firstAsk, planScene))
            plannedNow.push(scene.id)
        }
        return result
    })
    recordPlannedDirection(directionTarget, plannedNow, directionRules)
    return {coverage}
}
