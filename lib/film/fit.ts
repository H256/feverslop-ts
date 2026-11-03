// What the user chose for one clip (clip-overrides/<clip>.json) is more than its pictures: a person left out is still named in the
// shots as planned, and a chosen view of the place changes only the background picture while the shot's own words keep the camera
// where it was planned (#531). The plan run has the language model fit the shots of such a clip to the choice; the code only checks
// that no left-out name is still in them. Kept per clip with a fingerprint of the question: the same choice is not asked again.
import type {AskOptions} from "../llm.ts";
import {log, styles} from "../log.ts";
import type {ClipOverride} from "./compose.ts";
import type {FilmClip} from "./coverage.ts";
import {askFilmJson as askJson} from "./json.ts";
import {mentions} from "./names.ts";
import {clipFitPrompt} from "./prompts.ts";
import type {FilmStore} from "./store.ts";
import type {FilmCharacter, LocationView, Shot} from "./types.ts";

export type FittedShot = { view: string, camera: string, action: string, people: Record<string, { state?: string, motion?: string }> }
type Answer = { shots?: { view?: unknown, camera?: unknown, action?: unknown, people?: unknown }[] }

/** What a clip's choice changes in its shots: the people left out who are in them, and a view other than the planned one. */
export function fitOf(clip: FilmClip, override: ClipOverride | undefined, characters: FilmCharacter[], views: LocationView[] | undefined) {
    if (!override) return undefined
    const inShots = new Set(clip.shots.flatMap(s => s.characters))
    const without = characters.filter(c => override.without?.includes(c.id) && inShots.has(c.id))
    const planned = clip.shots.find(s => s.placeView)?.placeView ?? 1
    const view = views?.length && override.placeView !== undefined && override.placeView !== planned ? views[Math.min(views.length, Math.max(1, override.placeView)) - 1] : undefined
    return without.length || view ? {without, view, placeView: view ? override.placeView! : undefined} : undefined
}

/** What is wrong with an answer, by count and by name: the code checks, the language model writes. */
export function fitProblems(answer: Answer, shots: Shot[], without: FilmCharacter[]): string[] {
    const got = Array.isArray(answer.shots) ? answer.shots : []
    if (got.length !== shots.length) return [`${shots.length} shots are asked for, the answer has ${got.length}`]
    return got.flatMap((shot, n) => {
        const text = [shot.view, shot.camera, shot.action, ...(Array.isArray(shot.people) ? shot.people.flatMap(p => [(p as { state?: unknown }).state, (p as { motion?: unknown }).motion]) : [])].filter(t => typeof t === 'string').join(' ')
        return without.filter(c => mentions(text, c)).map(c => `shot ${n + 1} still names ${c.name}, who is not in the picture`)
    })
}

const text = (value: unknown, fallback: string) => typeof value === 'string' && value.trim() ? value.trim() : fallback

/** The shots with the answer put in: the people left out are no longer in them, the others keep how they are framed and face. */
export function fittedShots(shots: Shot[], answer: FittedShot[], without: FilmCharacter[], placeView: number | undefined): Shot[] {
    const out = new Set(without.map(c => c.id))
    return shots.map((shot, n) => {
        const fit = answer[n]!
        const people = shot.people && Object.fromEntries(Object.entries(shot.people).filter(([id]) => !out.has(id)).map(([id, p]) => [id, {...p, state: fit.people[id]?.state || p.state, motion: fit.people[id]?.motion || p.motion}]))
        return {
            ...shot, view: fit.view || shot.view, camera: fit.camera || shot.camera, action: fit.action || shot.action,
            characters: shot.characters.filter(id => !out.has(id)),
            ...(people ? {people} : {}),
            ...(placeView !== undefined ? {placeView} : {}),
        }
    })
}

/**
 * The clips with their shots fitted to the user's choice, where it changes them. A question that fails leaves the clip as planned,
 * said - the next run asks again.
 */
export async function fitOverrides(film: FilmStore, clips: FilmClip[], overrides: Record<string, ClipOverride>, characters: FilmCharacter[], placeOf: (clip: FilmClip) => { views?: LocationView[], staging: string }, ask: (options: AskOptions) => Promise<Answer> = askJson): Promise<FilmClip[]> {
    const kept = {...film.data.clipFits}
    const result: FilmClip[] = []
    for (const clip of clips) {
        const {views, staging} = placeOf(clip)
        const fit = fitOf(clip, overrides[clip.id], characters, views)
        if (!fit) { result.push(clip); continue }
        const nameOf = (id: string) => characters.find(c => c.id === id)?.name ?? id
        const shots = clip.shots.map(s => ({framing: s.framing, camera: s.camera, view: s.view, action: s.action, people: s.characters.map(id => ({id, name: nameOf(id), state: s.people?.[id]?.state, motion: s.people?.[id]?.motion}))}))
        const change = {without: fit.without.map(c => c.name), view: fit.view}
        const question = clipFitPrompt(shots, change, staging)
        const fingerprint = Bun.hash(JSON.stringify([question.input, question.reasoning])).toString(16)
        let answer = kept[clip.id]?.fingerprint === fingerprint ? kept[clip.id]!.shots : undefined
        if (!answer) {
            try {
                let raw = await ask(question)
                let problems = fitProblems(raw, clip.shots, fit.without)
                // told what is wrong, once; what is still wrong then is said, and the answer taken - it is closer than the plan
                if (problems.length) raw = await ask(clipFitPrompt(shots, change, staging, problems))
                problems = fitProblems(raw, clip.shots, fit.without)
                if (problems.some(p => p.includes('shots are asked for'))) throw new Error(problems.join('; '))
                for (const problem of problems) log.warn(`${clip.id}: ${problem}`)
                answer = raw.shots!.map((s, n) => ({
                    view: text(s.view, clip.shots[n]!.view ?? ''), camera: text(s.camera, clip.shots[n]!.camera), action: text(s.action, clip.shots[n]!.action),
                    people: Object.fromEntries((Array.isArray(s.people) ? s.people : []).flatMap(p => {
                        const {id, state, motion} = p as { id?: unknown, state?: unknown, motion?: unknown }
                        return typeof id === 'string' ? [[id, {state: text(state, ''), motion: text(motion, '')}]] : []
                    })),
                }))
                kept[clip.id] = {fingerprint, shots: answer}
                film.data.clipFits = kept
                await film.save()
                log.step('Fitted', `${styles.name(clip.id)} ${styles.muted([fit.without.length && `without ${joinNames(fit.without)}`, fit.view && `seen ${fit.view.name}`].filter(Boolean).join(' · '))}`)
            } catch (e) {
                log.warn(`${clip.id}: its shots could not be fitted to the choice made for it (${e instanceof Error ? e.message : e}) - it is planned as it was, the next run asks again`)
                result.push(clip)
                continue
            }
        }
        result.push({...clip, shots: fittedShots(clip.shots, answer, fit.without, fit.placeView)})
    }
    return result
}

const joinNames = (characters: FilmCharacter[]) => characters.map(c => c.name).join(', ')
