import {existsSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {visionUrls} from "../describe-picture.ts";
import {picturesReadable} from "../llm.ts";
import {log, styles} from "../log.ts";
import {askFilmJson as askJson} from "./json.ts";
import {locationViewAsset} from "./pictures.ts";
import {sheetViewsPrompt, shotViewsPrompt} from "./prompts.ts";
import type {FilmStore} from "./store.ts";
import type {FilmCast, LocationView, SceneCoverage} from "./types.ts";

// Which view of a place each shot is in, without designed views (config.locationViews). A clip was given the whole location sheet,
// and the video model took its first view as the background whatever the shot's camera said (last-rehearsal: the rows of seats
// behind a singer who was to look out at them). Now the views of every rendered sheet are read once by a vision model, the view
// of every shot is chosen from them, and the clip gets that one view - the way designed views work (lib/film/compose.ts).

const VIEWS = 5

/** The frames of a place's sheet, one per view - all of them, or none while the sheet is not rendered. */
export function sheetFrames(projectDir: string, locationId: string): string[] {
    const files = Array.from({length: VIEWS}, (_, n) => join(projectDir, locationViewAsset(locationId, n + 1)))
    return files.every(existsSync) ? files : []
}

const fingerprintOf = (files: string[]) => Bun.hash(files.map(f => Bun.hash(readFileSync(f)).toString(16)).join('.')).toString(16)

/** The views of every rendered location sheet, read again only when the sheet changed. Saves what it learnt. */
export async function readSheetViews(film: FilmStore, cast: FilmCast, descriptions: Record<string, string>): Promise<Record<string, LocationView[]>> {
    const result: Record<string, LocationView[]> = {}
    let changed = false
    // asked once, at the first sheet that has to be read: without pictures that are surely read, nothing is asked
    let readable: Promise<boolean> | undefined
    for (const location of cast.locations) {
        const frames = sheetFrames(film.dir, location.id)
        if (!frames.length) continue
        const fingerprint = fingerprintOf(frames)
        const kept = film.data.sheetViews?.[location.id]
        if (kept?.fingerprint === fingerprint) {
            result[location.id] = kept.views
            continue
        }
        readable ??= picturesReadable().then(yes => {
            if (!yes) log.step('Views', styles.muted('the view of the place per clip needs a model that reads pictures - bun run setup vision; until then the clips are given the whole sheet'))
            return yes
        })
        if (!await readable) continue
        log.step('Views', `${styles.name(location.id)} ${styles.muted('- reading its sheet with the vision model')}`)
        try {
            const answer = await askJson<{ views: LocationView[] }>(sheetViewsPrompt(await visionUrls(frames), location, descriptions[location.id] ?? location.description))
            if (answer.views?.length !== VIEWS) throw new Error(`${answer.views?.length ?? 0} views instead of ${VIEWS}`)
            result[location.id] = answer.views.map(v => ({name: String(v.name ?? '').trim(), shows: String(v.shows ?? '').trim()}))
            film.data.sheetViews = {...film.data.sheetViews, [location.id]: {fingerprint, views: result[location.id]!}}
            changed = true
            log.line(styles.muted(`        ${result[location.id]!.map((v, n) => `${n + 1}. ${v.name}`).join(' · ')}`))
        } catch (e) {
            log.warn(`the sheets of the places could not be read (${location.id}: ${e instanceof Error ? e.message : e}) - their clips get the whole sheet, the next run asks again`)
            // one warning, not one per place: the next ones would fail the same way
            readable = Promise.resolve(false)
        }
    }
    if (changed) await film.save()
    return result
}

/** The view of every shot of the scenes whose place has read views (1-based), chosen again only when the shots or the views changed. */
export async function chooseShotViews(film: FilmStore, coverage: SceneCoverage[], locationOfScene: (sceneId: string) => string | undefined, sheetViews: Record<string, LocationView[]>): Promise<Record<string, number[]>> {
    const result: Record<string, number[]> = {}
    for (const scene of coverage) {
        const views = sheetViews[locationOfScene(scene.sceneId) ?? '']
        if (!views) continue
        const shots = scene.shots.map(s => ({framing: s.framing, camera: s.camera, view: s.view, action: s.action}))
        // the question itself: another wording of it asks again
        const question = shotViewsPrompt(views, scene.staging ?? '', shots)
        const fingerprint = Bun.hash(JSON.stringify([question.input, question.reasoning])).toString(16)
        const kept = film.data.shotViews?.[scene.sceneId]
        if (kept?.fingerprint === fingerprint) {
            result[scene.sceneId] = kept.views
            continue
        }
        try {
            const answer = await askJson<{ views: unknown[] }>(question)
            result[scene.sceneId] = shots.map((_, n) => {
                const v = Number(answer.views?.[n])
                return Number.isInteger(v) && v >= 1 && v <= views.length ? v : 1
            })
            film.data.shotViews = {...film.data.shotViews, [scene.sceneId]: {fingerprint, views: result[scene.sceneId]!}}
            // saved scene by scene: with a thinking model a scene takes up to a minute, a stopped run keeps what it chose
            await film.save()
            log.step('Views', `${styles.name(scene.sceneId)} ${styles.muted(`shots in views ${result[scene.sceneId]!.join(', ')}`)}`)
        } catch (e) {
            log.warn(`${scene.sceneId}: the views of its shots could not be chosen (${e instanceof Error ? e.message : e}) - its clips get the whole sheet, the next run asks again`)
        }
    }
    return result
}

/**
 * The coverage with the chosen view of every shot of the scenes that have them. They win over a "placeView" the planning wrote:
 * without designed views it was never shown any views, and its JSON example has the field anyway - last-rehearsal planned 1, 2, 1, 3, …
 * for shots chosen as 5, 3, 3, 2, … and the clips got the planning's guess. With designed views no views are chosen (readSheetViews
 * reads only without them), so the planning's numbers stay.
 */
export const withShotViews = (coverage: SceneCoverage[], shotViews: Record<string, number[]>): SceneCoverage[] =>
    coverage.map(scene => shotViews[scene.sceneId] ? {...scene, shots: scene.shots.map((s, n) => ({...s, placeView: shotViews[scene.sceneId]![n]}))} : scene)
