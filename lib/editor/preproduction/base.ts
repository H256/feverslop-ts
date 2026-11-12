import {existsSync, readFileSync} from 'node:fs'
import {writeJsonFile} from '../../json-file.ts'
import {join} from 'node:path'
import {dropPartials, KEPT_BY_HAND} from '../../partials.ts'
import {type Project, STEP_NAMES} from '../../project.ts'
import {filmStage, musicStage, type PlanStage, nextStage} from '../../stages.ts'
import {FILM_STEP_NAMES} from '../../film/store.ts'
import type {FilmProject} from '../../film/types.ts'
import type {EditorKind, EditorTarget} from '../project.ts'

// The preproduction in the workspace (#526): what the book, the cast and the look share - project.json read and written, the steps of one element. See ../preproduction.ts.

export const readJson = <T>(file: string): T | undefined => (existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : undefined)
export type Data = Project | FilmProject

export const dataOf = (target: EditorTarget): Data => readJson<Data>(join(target.dir, 'project.json')) ?? {}

/** project.json written as the pipeline writes it: next to it first, so a crash mid-write never leaves half of it. */
export function save(target: EditorTarget, data: Data) {
    writeJsonFile(join(target.dir, 'project.json'), data)
}

/** The steps of this kind of project, in the order of the pipeline - what a --redo from the page may name. */
export const stepNamesOf = (kind: EditorKind): readonly string[] => (kind === 'film' ? FILM_STEP_NAMES : STEP_NAMES)

/** How far the plan of a project is: the last stage it has, and the one a plan run makes next. */
export function planStateOf(kind: EditorKind, data: Data): {stage?: PlanStage; next?: PlanStage} {
    const stage = kind === 'film' ? filmStage(data as FilmProject) : musicStage(data as Project)
    return {stage, next: nextStage(stage)}
}

/** The last stage the plan of this project has, read from its project.json. */
export const stageOf = (target: EditorTarget): PlanStage | undefined => planStateOf(target.kind, dataOf(target)).stage

/** The same text but for its spaces and line breaks. */
export const sameText = (a: string, b: string) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim()
export const cleanText = (value: unknown, what: string, max = 2000): string => {
    if (typeof value !== 'string') throw new Error(`${what} is missing`)
    const text = value.replace(/\s+/g, ' ').trim()
    if (!text) throw new Error(`${what} is empty`)
    if (text.length > max) throw new Error(`${what} is longer than ${max} characters`)
    return text
}
export const optionalText = (value: unknown, what: string) =>
    value === undefined || value === null || (typeof value === 'string' && !value.trim()) ? undefined : cleanText(value, what)

/** Drops these steps and their kept answers, in place. */
export function drop(data: Data, steps: string[]) {
    for (const step of steps) {
        delete (data as Record<string, unknown>)[step]
        dropPartials(data, step)
    }
}

////////// ONE ELEMENT AGAIN - the steps that ask once per character or place keep every answer apart (lib/partials.ts): a step
// made again for some of its elements keeps the answers of the others, marked as kept by hand, and the run asks only for these

export type ElementKind = 'character' | 'location'
// per pipeline: the steps with one answer per character or place, and which of them are written from which (same element)
export const ELEMENT_STEPS: Record<EditorKind, Record<string, {kind: ElementKind; then: string[]}>> = {
    music: {
        characterLooks: {kind: 'character', then: ['characterDescriptions']},
        characterDescriptions: {kind: 'character', then: []},
        locationLooks: {kind: 'location', then: ['locationDescriptions', 'locationAnchors', 'locationLayouts']},
        locationDescriptions: {kind: 'location', then: ['locationAnchors', 'locationLayouts']},
        locationAnchors: {kind: 'location', then: []},
        locationLayouts: {kind: 'location', then: []},
    },
    film: {
        characterLooks: {kind: 'character', then: ['characterDescriptions']},
        characterDescriptions: {kind: 'character', then: []},
        locationLooks: {kind: 'location', then: ['locationDescriptions', 'locationViews']},
        locationDescriptions: {kind: 'location', then: []},
        locationViews: {kind: 'location', then: []},
    },
}
export const isElementStep = (kind: EditorKind, step: string) => step in ELEMENT_STEPS[kind]
// a film character's other looks (wounded, disguised) are elements of their own: "<character>--<state>" goes with the character
export const ofElement = (key: string, id: string) => key === id || key.startsWith(`${id}--`)

/**
 * The step made again for these elements only: its answers for every other element are kept by hand, the step itself goes - the
 * next run takes the kept ones and asks for the rest. Elements no longer in the cast are left out of it.
 */
export function remake(data: Data, step: string, ids: string[]) {
    const values = (data as Record<string, unknown>)[step] as Record<string, unknown> | undefined
    if (values === undefined) return
    delete (data as Record<string, unknown>)[step]
    dropPartials(data, step)
    const kept = Object.entries(values).filter(([key]) => !ids.some(id => ofElement(key, id)))
    if (!kept.length) return
    const partials = (data.partials ??= {})
    partials[step] = Object.fromEntries(kept.map(([key, value]) => [key, {fingerprint: KEPT_BY_HAND, value}]))
}

/** The element steps with an answer, of the kind of element these steps are, made again for `ids` - with the steps written from them. */
export function remakeElements(kind: EditorKind, data: Data, steps: string[], ids: string[]): string[] {
    if (!ids.length) return []
    const reached = new Set<string>()
    const visit = (step: string) => {
        if (reached.has(step)) return
        reached.add(step)
        for (const next of ELEMENT_STEPS[kind][step]?.then ?? []) visit(next)
    }
    for (const step of steps) visit(step)
    const made = [...reached].filter(step => (data as Record<string, unknown>)[step] !== undefined)
    for (const step of made) remake(data, step, ids)
    return made
}
