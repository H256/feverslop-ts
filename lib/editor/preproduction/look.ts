import {join} from 'node:path'
import {copyKey} from '../../casting.ts'
import {withProjectLock} from '../../lock.ts'
import {builtOn, type Project, type StepName} from '../../project.ts'
import {filmBuiltOn, type FilmStepName} from '../../film/store.ts'
import type {FilmProject} from '../../film/types.ts'
import type {EditorKind, EditorTarget} from '../project.ts'
import type {LookElement, LookView, LookChange, LookResult} from '../../../shared/workspace.ts'
import {readJson, type Data, dataOf, save, planStateOf, sameText, cleanText, drop, type ElementKind, ELEMENT_STEPS, remake} from './base.ts'

// The preproduction in the workspace (#526): the look of everyone and every place. See ../preproduction.ts.

////////// THE LOOK - the film look, and how everyone and every place looks: read, changed by hand, written anew one by one (#541)

export type LookField = 'look' | 'description' | 'anchors' | 'layout'

export const LOOK_FIELDS: Record<EditorKind, Record<ElementKind, Partial<Record<LookField, string>>>> = {
    music: {
        character: {look: 'characterLooks', description: 'characterDescriptions'},
        location: {look: 'locationLooks', description: 'locationDescriptions', anchors: 'locationAnchors', layout: 'locationLayouts'},
    },
    film: {
        character: {look: 'characterLooks', description: 'characterDescriptions'},
        location: {look: 'locationLooks', description: 'locationDescriptions'},
    },
}
export const builtOnOf = (kind: EditorKind, steps: string[], data: Data) =>
    kind === 'film' ? filmBuiltOn(steps as FilmStepName[], data as FilmProject) : builtOn(steps as StepName[], data as Project)
export const elementStepsOf = (kind: EditorKind) => Object.keys(ELEMENT_STEPS[kind])

/** The elements of the look: every character (a film's other looks of a character too) and every place, with their texts. */
export function lookElements(kind: EditorKind, data: Data): {characters: LookElement[]; locations: LookElement[]} {
    const record = data as Record<string, unknown>
    const text = (step: string | undefined, key: string): string | undefined => {
        const value = step ? (record[step] as Record<string, unknown> | undefined)?.[key] : undefined
        return typeof value === 'string'
            ? value
            : value && typeof value === 'object' && 'layout' in value
              ? String((value as {layout: unknown}).layout)
              : undefined
    }
    const copies = data.castingCopies ?? {}
    const element = (elementKind: ElementKind, key: string, id: string, name: string): LookElement => {
        const fields = LOOK_FIELDS[kind][elementKind]
        return {
            kind: elementKind,
            id: key,
            name,
            library: copies[copyKey(elementKind, id)]?.library,
            look: text(fields.look, key),
            description: text(fields.description, key),
            anchors: text(fields.anchors, key),
            layout: text(fields.layout, key),
        }
    }
    const cast = data.cast as
        | {characters: {id: string; name: string; voiceOnly?: boolean; states?: {id: string; name: string}[]}[]; locations: {id: string; name: string}[]}
        | undefined
    return {
        characters: (cast?.characters ?? [])
            .filter(c => !c.voiceOnly)
            .flatMap(c => [
                element('character', c.id, c.id, c.name),
                ...(c.states ?? []).map(s => element('character', `${c.id}--${s.id}`, c.id, `${c.name} (${s.name})`)),
            ]),
        locations: (cast?.locations ?? []).map(l => element('location', l.id, l.id, l.name)),
    }
}

export function lookView(kind: EditorKind, data: Data): LookView {
    const elementSteps = elementStepsOf(kind)
    return {
        lookBrief: data.lookBrief,
        ...lookElements(kind, data),
        briefBuiltOn: builtOnOf(kind, ['lookBrief'], data),
        builtOn: builtOnOf(kind, elementSteps, data).filter(step => !elementSteps.includes(step)),
        stage: planStateOf(kind, data).stage,
    }
}

export const readLook = (target: EditorTarget): LookView => lookView(target.kind, dataOf(target))

/**
 * The change put into the project data, in place. A changed look of the whole: every look goes and is written anew. A changed text
 * of one character or place: that text is kept, what is written from it is written again for that one only (a changed look: its
 * description; a place's look: its description, background and floor plan), unless it was changed here too - every other
 * character and place keeps its texts. What is planned from the looks as a whole (the floor plans of the beats, the shots) goes.
 */
export function applyLook(kind: EditorKind, data: Data, change: LookChange): LookResult {
    if (data.lookBrief === undefined) throw new Error('no look yet - plan up to the look first')
    const record = data as Record<string, unknown>
    if (change.lookBrief !== undefined) {
        cleanText(change.lookBrief, 'the look', 8000)
        // its paragraphs stay: the look of the whole is a text of several
        const brief = String(change.lookBrief).replace(/\r\n/g, '\n').trim()
        if (!sameText(brief, data.lookBrief)) {
            data.lookBrief = brief
            const dropped = builtOnOf(kind, ['lookBrief'], data)
            drop(data, dropped)
            return {changed: true, dropped, remade: []}
        }
    }
    const {characters, locations} = lookElements(kind, data)
    const known = (elementKind: ElementKind, id: string) => (elementKind === 'character' ? characters : locations).find(e => e.id === id)
    const edited = new Map<string, Set<string>>() // step -> the elements changed by hand
    const again = new Map<string, Set<string>>() // step -> the elements written anew
    const add = (map: Map<string, Set<string>>, step: string, id: string) => map.set(step, (map.get(step) ?? new Set()).add(id))
    for (const wanted of change.elements ?? []) {
        const element = known(wanted.kind, wanted.id)
        if (!element) throw new Error(`no ${wanted.kind} ${wanted.id}`)
        for (const field of ['look', 'description', 'anchors', 'layout'] as const) {
            if (wanted[field] === undefined) continue
            const step = LOOK_FIELDS[kind][wanted.kind][field]
            const values = step ? (record[step] as Record<string, unknown> | undefined) : undefined
            if (!step || !values || element[field] === undefined) throw new Error(`${element.name} has no ${field} to change`)
            const value = cleanText(wanted[field], `the ${field} of ${element.name}`, 8000)
            // a whole look given back (bun run look --set) has every text: only a changed one counts
            if (sameText(value, element[field]!)) continue
            if (element.library) throw new Error(`${element.name} is played by library:${element.library} - its texts are the library's`)
            values[wanted.id] = field === 'layout' ? {...(values[wanted.id] as object), layout: value} : value
            add(edited, step, wanted.id)
        }
    }
    for (const wanted of change.again ?? []) {
        const element = known(wanted.kind, wanted.id)
        if (!element) throw new Error(`no ${wanted.kind} ${wanted.id}`)
        if (element.library) throw new Error(`${element.name} is played by library:${element.library} - its texts are the library's`)
        add(again, LOOK_FIELDS[kind][wanted.kind].look!, wanted.id)
    }
    // what is written from a changed text, for that element, unless it was changed by hand too
    const follow = (step: string, id: string) => {
        for (const next of ELEMENT_STEPS[kind][step]?.then ?? []) if (!edited.get(next)?.has(id)) add(again, next, id)
    }
    for (const [step, ids] of [...edited, ...again]) for (const id of ids) follow(step, id)
    const remade: string[] = []
    for (const [step, ids] of again) {
        if (record[step] === undefined) continue
        remake(data, step, [...ids])
        remade.push(`${step}: ${[...ids].join(', ')}`)
    }
    const touched = [...new Set([...edited.keys(), ...again.keys()])]
    if (!touched.length) return {changed: false, dropped: [], remade: []}
    const elementSteps = elementStepsOf(kind)
    const dropped = builtOnOf(kind, touched, data).filter(step => !elementSteps.includes(step))
    drop(data, dropped)
    return {changed: true, dropped, remade}
}

export async function writeLook(target: EditorTarget, change: LookChange): Promise<LookResult> {
    return withProjectLock(target.dir, target.id, () => {
        const data = readJson<Data>(join(target.dir, 'project.json'))
        if (!data) throw new Error('no project.json yet - plan up to the look first')
        const result = applyLook(target.kind, data, change)
        if (result.changed) save(target, data)
        return result
    })
}
