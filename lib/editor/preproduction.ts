import {existsSync, readFileSync, rmSync} from "node:fs";
import {writeJsonFile} from "../json-file.ts";
import {join} from "node:path";
import slugify from "slugify";
import {CASTING_FILE, castingAfterCastChange, type CastEntry, copyKey, droppedCopies, libraryFingerprint, readCastingFile, resolveCasting} from "../casting.ts";
import {libraryDir, libraryIds} from "../library.ts";
import {withProjectLock} from "../lock.ts";
import {dropPartials, KEPT_BY_HAND} from "../partials.ts";
import {builtOn, type Character, type Location, type Project, redoAfter, STEP_NAMES, type StepName} from "../project.ts";
import {filmStage, musicStage, type PlanStage, nextStage} from "../stages.ts";
import {projectDir, projectExists, validProjectId} from "../project-setup.ts";
import {filmDir, filmExists} from "../film/setup.ts";
import {screenplayToText} from "../film/fountain.ts";
import {FILM_STEP_NAMES, filmBuiltOn, filmRedoAfter, type FilmStepName} from "../film/store.ts";
import type {FilmCharacter, FilmLocation, FilmProject} from "../film/types.ts";
import type {EditorKind, EditorTarget} from "./project.ts";
import type {CastingRedo, CastMember, CastView, CastChange, CastResult, BookView, LookElement, LookView, LookChange, LookResult} from '../../shared/workspace.ts';
export type {CastingRedo, CastMember, CastView, CastChange, CastResult, BookView, LookElement, LookView, LookChange, LookResult} from '../../shared/workspace.ts';

// The preproduction in the workspace (issue #526): the book, the cast and the look are looked at and changed before the shots
// are planned and long before anything is rendered. What is changed here is put into project.json as the pipeline would have
// written it, and every step built on it goes - the next plan run makes those again from it (the language model only). Nothing
// is rendered: pictures and clips made before stay, and are stale once the plan has new prompts for them.

const readJson = <T>(file: string): T | undefined => existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as T : undefined
type Data = Project | FilmProject

const dataOf = (target: EditorTarget): Data => readJson<Data>(join(target.dir, 'project.json')) ?? {}

/** project.json written as the pipeline writes it: next to it first, so a crash mid-write never leaves half of it. */
function save(target: EditorTarget, data: Data) {
    writeJsonFile(join(target.dir, 'project.json'), data)
}

/** The steps of this kind of project, in the order of the pipeline - what a --redo from the page may name. */
export const stepNamesOf = (kind: EditorKind): readonly string[] => kind === 'film' ? FILM_STEP_NAMES : STEP_NAMES

/** How far the plan of a project is: the last stage it has, and the one a plan run makes next. */
export function planStateOf(kind: EditorKind, data: Data): { stage?: PlanStage, next?: PlanStage } {
    const stage = kind === 'film' ? filmStage(data as FilmProject) : musicStage(data as Project)
    return {stage, next: nextStage(stage)}
}

/** The last stage the plan of this project has, read from its project.json. */
export const stageOf = (target: EditorTarget): PlanStage | undefined => planStateOf(target.kind, dataOf(target)).stage

////////// A CHANGED casting.json - what the next plan run has to make again (issue #527)

// the steps a library asset stands in for: its texts replace theirs in the run (index.ts castTexts, film.ts fromLibrary)
const MUSIC_LIBRARY_STEPS: StepName[] = ['characterLooks', 'characterDescriptions', 'locationLooks', 'locationDescriptions', 'locationAnchors', 'locationLayouts']
const FILM_LIBRARY_STEPS: FilmStepName[] = ['characterLooks', 'characterDescriptions', 'locationLooks', 'locationDescriptions']


/**
 * What a plan run would take over from casting.json that the project does not have yet - a role the library plays now (or in
 * another version of the asset), a role back to "project:" - and the steps planned from the old texts. The run itself only
 * names those (index.ts "changed since the plan was made"): the page asks first and then gives the run this --redo.
 */
export async function castingRedo(target: EditorTarget): Promise<CastingRedo> {
    const data = dataOf(target)
    const raw = data.cast as { characters: { id: string, name: string, voiceOnly?: boolean }[], locations: { id: string, name: string }[] } | undefined
    if (!raw) return {changes: [], redo: []}
    const cast = {characters: raw.characters.filter(c => !c.voiceOnly), locations: raw.locations}
    const library = await libraryDir()
    let resolved: ReturnType<typeof resolveCasting>
    try {
        resolved = resolveCasting(readCastingFile(target.dir), cast, (kind, id) => libraryIds(library, kind).includes(id))
    } catch {
        return {changes: [], redo: []}      // a broken casting.json: the casting page says so, and the run stops on it
    }
    if (resolved.errors.length) return {changes: [], redo: []}
    return castingRedoOf(target.kind, data, resolved.entries, entry => libraryFingerprint(library, entry.kind, entry.libraryId))
}

/** castingRedo from what casting.json resolves to: `fingerprint` is the version of the library asset an entry names. */
export function castingRedoOf(kind: EditorKind, data: Data, entries: CastEntry[], fingerprint: (entry: CastEntry) => string): CastingRedo {
    const copies = data.castingCopies ?? {}
    const taken = entries.filter(entry => {
        const was = copies[copyKey(entry.kind, entry.id)]
        return !was || was.library !== entry.libraryId || was.fingerprint !== fingerprint(entry)
    })
    const dropped = droppedCopies(copies, entries).map(key => key.split(':') as ['character' | 'location', string])
    const changes = [
        ...taken.map(entry => `${entry.id} is played by library:${entry.libraryId}`),
        ...dropped.map(([, id]) => `${id} is made by the project again`),
    ]
    if (!changes.length) return {changes, redo: []}
    const redo = new Set<string>(kind === 'film'
        ? filmRedoAfter(FILM_LIBRARY_STEPS, data as FilmProject)
        : redoAfter(MUSIC_LIBRARY_STEPS, data as Project))
    // a role back to "project:" still has the library's texts: its look is made anew, and with it everything after
    for (const [kind] of dropped) {
        const look = kind === 'character' ? 'characterLooks' : 'locationLooks'
        if ((data as Record<string, unknown>)[look] !== undefined) redo.add(look)
    }
    return {changes, redo: stepNamesOf(kind).filter(step => redo.has(step))}
}

////////// THE CAST BY HAND - who is in it and what they are, without the library (issue #529)

// what the page shows and changes of a member of the cast: the fields that are the same for a music video and a film are named
// alike; the others are there only for the kind that has them
// dropped: steps gone as a whole; remade: steps made again for some of their elements, "step: id, id"
// renamed: who kept their id and got another name - the story still says the old one (#542)

/** The same text but for its spaces and line breaks. */
const sameText = (a: string, b: string) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim()
const cleanText = (value: unknown, what: string, max = 2000): string => {
    if (typeof value !== 'string') throw new Error(`${what} is missing`)
    const text = value.replace(/\s+/g, ' ').trim()
    if (!text) throw new Error(`${what} is empty`)
    if (text.length > max) throw new Error(`${what} is longer than ${max} characters`)
    return text
}
const optionalText = (value: unknown, what: string) => value === undefined || value === null || (typeof value === 'string' && !value.trim()) ? undefined : cleanText(value, what)

/** A new id from a name, as the cast step makes them: lowercase, dashes, a number when it is taken. */
function newId(name: string, taken: Set<string>, fallback: string) {
    const base = slugify(name, {lower: true, strict: true}) || fallback
    let id = base
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
    taken.add(id)
    return id
}

/** The steps that go when the cast changes. A music video keeps the separated instruments while the instruments heard stay the same: those are no language model, but minutes of demucs. */
function droppedByCast(kind: EditorKind, before: Data, after: Data): string[] {
    if (kind === 'film') return filmBuiltOn(['cast'], before as FilmProject)
    const stems = (data: Data) => [...new Set(((data as Project).cast?.characters ?? []).map(c => c.propStem).filter(Boolean))].sort().join(',')
    const keep: StepName[] = stems(before) === stems(after) ? ['instrumentStems', 'propActivity'] : []
    return builtOn(['cast'], before as Project).filter(step => !keep.includes(step))
}

export function castView(kind: EditorKind, data: Data): CastView | undefined {
    if (!data.cast) return undefined
    const {stage} = planStateOf(kind, data)
    if (kind === 'film') {
        const cast = (data as FilmProject).cast!
        return {
            characters: cast.characters.map(c => ({id: c.id, name: c.name, role: c.role, appearance: c.appearance, voice: c.voice, voiceOnly: c.voiceOnly})),
            locations: cast.locations.map(l => ({id: l.id, name: l.name, description: l.description})),
            canAdd: false, builtOn: filmBuiltOn(['cast'], data as FilmProject), remakes: [], stage,
        }
    }
    const cast = (data as Project).cast!
    return {
        characters: cast.characters.map(c => ({id: c.id, name: c.name, role: c.role, prop: c.prop, group: c.isGroup})),
        locations: cast.locations.map(l => ({id: l.id, name: l.name})),
        canAdd: true, stage,
        builtOn: droppedByCast(kind, data, data).filter(step => !isElementStep(kind, step)),
        remakes: droppedByCast(kind, data, data).filter(step => isElementStep(kind, step)),
    }
}

/** The new cast of a music video: the members kept with what they had and what was changed, the new ones with an id of their own. */
function musicCast(cast: NonNullable<Project['cast']>, change: CastChange): NonNullable<Project['cast']> {
    const takenLocations = new Set(cast.locations.map(l => l.id))
    const locations: Location[] = change.locations.map((wanted, n) => {
        const name = cleanText(wanted.name, `the name of place ${n + 1}`, 200)
        const old = wanted.id ? cast.locations.find(l => l.id === wanted.id) : undefined
        if (wanted.id && !old) throw new Error(`no place ${wanted.id}`)
        return old ? {...old, name} : {id: newId(name, takenLocations, 'place'), name}
    })
    if (!locations.length) throw new Error('a music video needs at least one place: every beat is somewhere')
    const takenCharacters = new Set(cast.characters.map(c => c.id))
    const characters: Character[] = change.characters.map((wanted, n) => {
        const name = cleanText(wanted.name, `the name of character ${n + 1}`, 200)
        const role = cleanText(wanted.role ?? '', `the role of ${name}`)
        const prop = optionalText(wanted.prop, `the prop of ${name}`)
        const old = wanted.id ? cast.characters.find(c => c.id === wanted.id) : undefined
        if (wanted.id && !old) throw new Error(`no character ${wanted.id}`)
        const character: Character = old ? {...old, name, role} : {id: newId(name, takenCharacters, 'character'), name, role}
        if (prop === undefined) {
            // without a prop nothing of it is left: no instrument heard, no place it stands in
            for (const key of ['prop', 'propStem', 'propCarried', 'propInHand', 'propPlace'] as const) delete character[key]
        } else if (prop !== old?.prop) {
            character.prop = prop
            // another thing than before: what was known of the old one does not hold for it
            for (const key of ['propStem', 'propCarried', 'propInHand', 'propPlace'] as const) delete character[key]
        }
        // the place its prop stands in is gone: it carries the prop
        if (character.propPlace && !locations.some(l => l.id === character.propPlace)) for (const key of ['propCarried', 'propInHand', 'propPlace'] as const) delete character[key]
        return character
    })
    const ids = new Set<string>()
    for (const c of characters) {
        if (ids.has(c.id)) throw new Error(`${c.id} is in the cast twice`)
        ids.add(c.id)
    }
    return {characters, locations}
}

/** The new cast of a film: the script says who is in it - names and texts change, nobody comes or goes. */
function filmCast(cast: NonNullable<FilmProject['cast']>, change: CastChange): NonNullable<FilmProject['cast']> {
    const same = (wanted: { id?: string }[], have: { id: string }[]) => wanted.length === have.length && have.every(h => wanted.some(w => w.id === h.id))
    if (!same(change.characters, cast.characters) || !same(change.locations, cast.locations)) throw new Error('the script says who is in a film and where it is: change it there - here the names and texts change')
    const characters: FilmCharacter[] = cast.characters.map(old => {
        const wanted = change.characters.find(c => c.id === old.id)!
        const name = cleanText(wanted.name, `the name of ${old.id}`, 200)
        return {
            ...old, name,
            role: cleanText(wanted.role ?? '', `the role of ${name}`),
            appearance: old.voiceOnly ? old.appearance : cleanText(wanted.appearance ?? '', `what ${name} looks like`),
            voice: cleanText(wanted.voice ?? '', `the voice of ${name}`),
            // the new name is a name the script can use for them too
            aliases: old.aliases.some(a => a.toLowerCase() === name.toLowerCase()) ? old.aliases : [...old.aliases, name],
        }
    })
    const locations: FilmLocation[] = cast.locations.map(old => {
        const wanted = change.locations.find(l => l.id === old.id)!
        const name = cleanText(wanted.name, `the name of ${old.id}`, 200)
        return {...old, name, description: cleanText(wanted.description ?? '', `the description of ${name}`)}
    })
    return {characters, locations}
}

/** Drops these steps and their kept answers, in place. */
function drop(data: Data, steps: string[]) {
    for (const step of steps) {
        delete (data as Record<string, unknown>)[step]
        dropPartials(data, step)
    }
}

////////// ONE ELEMENT AGAIN - the steps that ask once per character or place keep every answer apart (lib/partials.ts): a step
// made again for some of its elements keeps the answers of the others, marked as kept by hand, and the run asks only for these

type ElementKind = 'character' | 'location'
// per pipeline: the steps with one answer per character or place, and which of them are written from which (same element)
const ELEMENT_STEPS: Record<EditorKind, Record<string, { kind: ElementKind, then: string[] }>> = {
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
const isElementStep = (kind: EditorKind, step: string) => step in ELEMENT_STEPS[kind]
// a film character's other looks (wounded, disguised) are elements of their own: "<character>--<state>" goes with the character
const ofElement = (key: string, id: string) => key === id || key.startsWith(`${id}--`)

/**
 * The step made again for these elements only: its answers for every other element are kept by hand, the step itself goes - the
 * next run takes the kept ones and asks for the rest. Elements no longer in the cast are left out of it.
 */
function remake(data: Data, step: string, ids: string[]) {
    const values = (data as Record<string, unknown>)[step] as Record<string, unknown> | undefined
    if (values === undefined) return
    delete (data as Record<string, unknown>)[step]
    dropPartials(data, step)
    const kept = Object.entries(values).filter(([key]) => !ids.some(id => ofElement(key, id)))
    if (!kept.length) return
    const partials = data.partials ??= {}
    partials[step] = Object.fromEntries(kept.map(([key, value]) => [key, {fingerprint: KEPT_BY_HAND, value}]))
}

/** The element steps with an answer, of the kind of element these steps are, made again for `ids` - with the steps written from them. */
function remakeElements(kind: EditorKind, data: Data, steps: string[], ids: string[]): string[] {
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

/**
 * The change put into the project data, in place: the new cast, and every step built on the old one gone - for a music video
 * also who sings which line (the singers are asked again; with a changed Singers page the hand-made choice goes too).
 */
export function applyCast(kind: EditorKind, data: Data, change: CastChange): CastResult {
    if (!data.cast) throw new Error('no cast yet - plan up to the cast first')
    if (!Array.isArray(change?.characters) || !Array.isArray(change?.locations)) throw new Error('characters and places are needed')
    const before = structuredClone(data)
    const next = kind === 'film' ? filmCast((data as FilmProject).cast!, change) : musicCast((data as Project).cast!, change)
    if (JSON.stringify(next) === JSON.stringify(data.cast)) return {changed: false, dropped: [], remade: [], added: [], removed: [], renamed: []}
    const ids = (cast: { characters: { id: string }[], locations: { id: string }[] }) => [...cast.characters, ...cast.locations].map(m => m.id)
    const added = ids(next).filter(id => !ids(data.cast!).includes(id))
    const removed = ids(data.cast!).filter(id => !ids(next).includes(id))
    const members = (cast: { characters: { id: string, name: string }[], locations: { id: string, name: string }[] }) => [...cast.characters, ...cast.locations]
    const renamed = members(next).flatMap(m => {
        const was = members(data.cast!).find(o => o.id === m.id)
        return was && was.name !== m.name ? [{from: was.name, to: m.name}] : []
    })
    ;(data as { cast: unknown }).cast = next
    const builtOnCast = droppedByCast(kind, before, data)
    if (kind === 'film') {
        // a film's summary is written from its cast, and the look and every look from the summary: all of it goes
        drop(data, builtOnCast)
        return {changed: true, dropped: builtOnCast, remade: [], added, removed, renamed}
    }
    // a music video: the looks of whoever is new or changed are written again, the others stay as they are
    const changedIn = <T extends { id: string }>(was: T[], now: T[]) => now.filter(m => JSON.stringify(m) !== JSON.stringify(was.find(w => w.id === m.id))).map(m => m.id)
    const oldCast = (before as Project).cast!
    const changedCharacters = changedIn(oldCast.characters, next.characters as Character[])
    const changedLocations = changedIn(oldCast.locations, next.locations as Location[])
    const elementSteps = builtOnCast.filter(step => isElementStep(kind, step))
    const dropped = builtOnCast.filter(step => !isElementStep(kind, step))
    drop(data, dropped)
    const remade = [
        ...remakeElements(kind, data, elementSteps.filter(s => ELEMENT_STEPS.music[s]!.kind === 'character'), changedCharacters).map(step => `${step}: ${changedCharacters.join(', ')}`),
        ...remakeElements(kind, data, elementSteps.filter(s => ELEMENT_STEPS.music[s]!.kind === 'location'), changedLocations).map(step => `${step}: ${changedLocations.join(', ')}`),
    ].filter(line => !line.endsWith(': '))
    return {changed: true, dropped, remade, added, removed, renamed}
}

export const readCast = (target: EditorTarget): CastView | undefined => castView(target.kind, dataOf(target))

export async function writeCast(target: EditorTarget, change: CastChange): Promise<CastResult> {
    return withProjectLock(target.dir, target.id, () => {
        const data = readJson<Data>(join(target.dir, 'project.json'))
        if (!data) throw new Error('no project.json yet - plan up to the cast first')
        const before = structuredClone(data.cast)
        const result = applyCast(target.kind, data, change)
        if (!result.changed) return result
        save(target, data)
        // casting.json follows who is in the cast: the roles that left lose their entry, new ones run as "project:" (a file
        // that is not there yet is written by the next run, from this cast)
        if (before && data.cast && existsSync(join(target.dir, CASTING_FILE))) {
            const casting = castingAfterCastChange(readCastingFile(target.dir), before, data.cast)
            if (casting) writeJsonFile(join(target.dir, CASTING_FILE), casting)
        }
        return result
    })
}

////////// THE BOOK - the story of a music video, the screenplay of a film


export function bookView(kind: EditorKind, data: Data): BookView {
    const state = planStateOf(kind, data)
    if (kind === 'film') {
        const screenplay = (data as FilmProject).screenplay
        return {text: screenplay && screenplayToText(screenplay), editable: false, builtOn: [], keptByCast: [], ...state}
    }
    const story = (data as Project).story
    return {text: story, editable: story !== undefined, builtOn: builtOn(['story'], data as Project), keptByCast: droppedKeepingCast(data as Project), ...state}
}

export function readBook(target: EditorTarget): BookView {
    const data = dataOf(target)
    const view = bookView(target.kind, data)
    return target.kind === 'music' ? {...view, proposal: storyProposal(target.dir, (data as Project).story)} : view
}

/** A music video's story as written on the page, in place: every step built on the old one goes. */
export function applyStory(data: Project, text: unknown): { changed: boolean, dropped: string[] } {
    if (data.story === undefined) throw new Error('no story yet - plan up to the story first')
    if (typeof text !== 'string' || !text.trim()) throw new Error('the story is empty')
    const story = text.replace(/\r\n/g, '\n').trim()
    if (story === data.story.trim()) return {changed: false, dropped: []}
    const dropped = builtOn(['story'], data)
    data.story = story
    drop(data, dropped)
    return {changed: true, dropped}
}

export async function writeStory(target: EditorTarget, text: unknown): Promise<{ changed: boolean, dropped: string[] }> {
    if (target.kind !== 'music') throw new Error('a film\'s screenplay is changed in its script (input/) or in project.json')
    return withProjectLock(target.dir, target.id, () => {
        const data = readJson<Project>(join(target.dir, 'project.json'))
        if (!data) throw new Error('no project.json yet - plan up to the story first')
        const result = applyStory(data, text)
        if (result.changed) save(target, data)
        return result
    })
}

////////// THE LOOK - the film look, and how everyone and every place looks: read, changed by hand, written anew one by one (#541)

type LookField = 'look' | 'description' | 'anchors' | 'layout'

const LOOK_FIELDS: Record<EditorKind, Record<ElementKind, Partial<Record<LookField, string>>>> = {
    music: {
        character: {look: 'characterLooks', description: 'characterDescriptions'},
        location: {look: 'locationLooks', description: 'locationDescriptions', anchors: 'locationAnchors', layout: 'locationLayouts'},
    },
    film: {
        character: {look: 'characterLooks', description: 'characterDescriptions'},
        location: {look: 'locationLooks', description: 'locationDescriptions'},
    },
}
const builtOnOf = (kind: EditorKind, steps: string[], data: Data) => kind === 'film' ? filmBuiltOn(steps as FilmStepName[], data as FilmProject) : builtOn(steps as StepName[], data as Project)
const elementStepsOf = (kind: EditorKind) => Object.keys(ELEMENT_STEPS[kind])

/** The elements of the look: every character (a film's other looks of a character too) and every place, with their texts. */
function lookElements(kind: EditorKind, data: Data): { characters: LookElement[], locations: LookElement[] } {
    const record = data as Record<string, unknown>
    const text = (step: string | undefined, key: string): string | undefined => {
        const value = step ? (record[step] as Record<string, unknown> | undefined)?.[key] : undefined
        return typeof value === 'string' ? value : value && typeof value === 'object' && 'layout' in value ? String((value as { layout: unknown }).layout) : undefined
    }
    const copies = data.castingCopies ?? {}
    const element = (elementKind: ElementKind, key: string, id: string, name: string): LookElement => {
        const fields = LOOK_FIELDS[kind][elementKind]
        return {
            kind: elementKind, id: key, name, library: copies[copyKey(elementKind, id)]?.library,
            look: text(fields.look, key), description: text(fields.description, key), anchors: text(fields.anchors, key), layout: text(fields.layout, key),
        }
    }
    const cast = data.cast as { characters: { id: string, name: string, voiceOnly?: boolean, states?: { id: string, name: string }[] }[], locations: { id: string, name: string }[] } | undefined
    return {
        characters: (cast?.characters ?? []).filter(c => !c.voiceOnly).flatMap(c => [
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
    const edited = new Map<string, Set<string>>()      // step -> the elements changed by hand
    const again = new Map<string, Set<string>>()       // step -> the elements written anew
    const add = (map: Map<string, Set<string>>, step: string, id: string) => map.set(step, (map.get(step) ?? new Set()).add(id))
    for (const wanted of change.elements ?? []) {
        const element = known(wanted.kind, wanted.id)
        if (!element) throw new Error(`no ${wanted.kind} ${wanted.id}`)
        for (const field of ['look', 'description', 'anchors', 'layout'] as const) {
            if (wanted[field] === undefined) continue
            const step = LOOK_FIELDS[kind][wanted.kind][field]
            const values = step ? record[step] as Record<string, unknown> | undefined : undefined
            if (!step || !values || element[field] === undefined) throw new Error(`${element.name} has no ${field} to change`)
            const value = cleanText(wanted[field], `the ${field} of ${element.name}`, 8000)
            // a whole look given back (bun run look --set) has every text: only a changed one counts
            if (sameText(value, element[field]!)) continue
            if (element.library) throw new Error(`${element.name} is played by library:${element.library} - its texts are the library's`)
            values[wanted.id] = field === 'layout' ? {...values[wanted.id] as object, layout: value} : value
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

////////// THE STORY AFTER THE CAST - a music video's story told with the cast as it is now (#542)

// a story written anew for the cast by the language model (bun run story --adapt, tools/story.ts) waits here until it is taken or dropped
export const STORY_PROPOSAL = join('output', 'story-proposal.json')
export type StoryProposal = { story: string, for: string }      // for: the story it was written from - another one now: it is gone
export const storyFingerprint = (story: string) => Bun.hash(story.trim()).toString(16)

/** The proposal for this story, if there is one written from it. */
export function storyProposal(dir: string, story: string | undefined): string | undefined {
    const proposal = readJson<StoryProposal>(join(dir, STORY_PROPOSAL))
    return proposal && story !== undefined && proposal.for === storyFingerprint(story) ? proposal.story : undefined
}

/** The steps a story told anew for the same cast drops: the summary and what is planned from the beats on - the cast, who sings and the looks stay. */
const droppedKeepingCast = (data: Project) => ['summary', 'beats', ...builtOn(['beats'], data)].filter(step => (data as Record<string, unknown>)[step] !== undefined)

/** A name in the story replaced by another, as a whole word: the full name, then each of its words that changed ("Vey" by "Rook"). */
export function renameInStory(story: string, renamed: { from: string, to: string }[]): string {
    const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const replace = (text: string, from: string, to: string) => from && from !== to ? text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(from)}(?![\\p{L}\\p{N}])`, 'gu'), to) : text
    let result = story
    for (const {from, to} of renamed) {
        result = replace(result, from, to)
        const was = from.split(/\s+/), now = to.split(/\s+/)
        if (was.length === now.length) was.forEach((word, i) => { result = replace(result, word, now[i]!) })
    }
    return result
}

/** A music video's story told anew for the cast it has: the text set, the summary and the plan from the beats on gone. */
export function applyStoryKeepingCast(data: Project, text: unknown): { changed: boolean, dropped: string[] } {
    if (data.story === undefined || !data.cast) throw new Error('no story and cast yet')
    if (typeof text !== 'string' || !text.trim()) throw new Error('the story is empty')
    const story = text.replace(/\r\n/g, '\n').trim()
    if (story === data.story.trim()) return {changed: false, dropped: []}
    const dropped = droppedKeepingCast(data)
    data.story = story
    drop(data, dropped)
    return {changed: true, dropped}
}

/** The story with the cast as it is now: by a proposal of the language model (taken here), or by the names that changed. */
export async function writeStoryForCast(target: EditorTarget, how: { proposal?: boolean, renamed?: { from: string, to: string }[] }): Promise<{ changed: boolean, dropped: string[] }> {
    if (target.kind !== 'music') throw new Error('a film\'s screenplay is changed in its script')
    return withProjectLock(target.dir, target.id, () => {
        const data = readJson<Project>(join(target.dir, 'project.json'))
        if (!data?.story) throw new Error('no story yet')
        const text = how.proposal ? storyProposal(target.dir, data.story) : renameInStory(data.story, how.renamed ?? [])
        if (text === undefined) throw new Error('no proposal for this story - have it written again')
        const result = applyStoryKeepingCast(data, text)
        if (result.changed) save(target, data)
        rmSync(join(target.dir, STORY_PROPOSAL), {force: true})
        return result
    })
}

export const dropStoryProposal = (target: EditorTarget) => rmSync(join(target.dir, STORY_PROPOSAL), {force: true})

////////// FROM THE TERMINAL - the same as the pages, as commands (tools/story.ts, cast.ts, look.ts, casting.ts - CLI first, #548)

/** The project or film a command is about, or why there is none. */
export function commandTarget(id: string | undefined, film: boolean): EditorTarget | string {
    if (!id || !validProjectId(id)) return id ? `"${id}" is no project id` : 'No project id given'
    if (film) return filmExists(id) ? {id, kind: 'film', dir: filmDir(id)} : `No film "${id}" in films/`
    return projectExists(id) ? {id, kind: 'music', dir: projectDir(id)} : `No project "${id}" in projects/`
}

/**
 * The command that plans what a change left to plan: up to the stage the project is at, and at least up to the stage of the change
 * (a look written anew is written by --until=look, even where the cast went too) - a planned project all of it. `redo`: steps first.
 */
export function planCommand(target: EditorTarget, change: PlanStage, redo: string[] = []): string {
    const at = stageOf(target)
    const stages: PlanStage[] = ['story', 'cast', 'look', 'plan']
    const until = stages[Math.max(stages.indexOf(change), at ? stages.indexOf(at) : -1)]!
    return `bun ${target.kind === 'film' ? 'film.ts' : 'index.ts'} ${target.id}${redo.length ? ` --redo=${redo.join(',')}` : ''}${until !== 'plan' ? ` --until=${until}` : ''}`
}

////////// WHERE THE PREPRODUCTION STANDS - for bun run status and the workspace alike

export type Preproduction = {
    stage?: PlanStage,          // the last stage the plan has
    next?: PlanStage,           // the one a plan run makes next
    casting: CastingRedo,       // what casting.json says that the project does not have yet, and the --redo for it
    storyProposal: boolean,     // a story told anew for the cast waits to be taken or dropped
    nextCommand?: string,       // the plan run that takes the casting over - only when there is something to take over
}

export async function preproductionOf(target: EditorTarget): Promise<Preproduction> {
    const data = dataOf(target)
    const casting = await castingRedo(target)
    return {
        ...planStateOf(target.kind, data),
        casting,
        storyProposal: target.kind === 'music' && storyProposal(target.dir, (data as Project).story) !== undefined,
        ...(casting.changes.length ? {nextCommand: planCommand(target, 'cast', casting.redo)} : {}),
    }
}
