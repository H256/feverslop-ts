import {existsSync, readFileSync, renameSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import slugify from "slugify";
import {type CastEntry, copyKey, droppedCopies, libraryFingerprint, readCastingFile, resolveCasting} from "../casting.ts";
import {libraryDir, libraryIds} from "../library.ts";
import {withProjectLock} from "../lock.ts";
import {dropPartials} from "../partials.ts";
import {builtOn, type Character, type Location, type Project, redoAfter, STEP_NAMES, type StepName} from "../project.ts";
import {filmStage, musicStage, type PlanStage, nextStage} from "../stages.ts";
import {screenplayToText} from "../film/fountain.ts";
import {FILM_STEP_NAMES, filmBuiltOn, filmRedoAfter, type FilmStepName} from "../film/store.ts";
import type {FilmCharacter, FilmLocation, FilmProject} from "../film/types.ts";
import type {EditorKind, EditorTarget} from "./project.ts";

// The preproduction in the workspace (issue #526): the book, the cast and the look are looked at and changed before the shots
// are planned and long before anything is rendered. What is changed here is put into project.json as the pipeline would have
// written it, and every step built on it goes - the next plan run makes those again from it (the language model only). Nothing
// is rendered: pictures and clips made before stay, and are stale once the plan has new prompts for them.

const readJson = <T>(file: string): T | undefined => existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as T : undefined
type Data = Project | FilmProject

const dataOf = (target: EditorTarget): Data => readJson<Data>(join(target.dir, 'project.json')) ?? {}

/** project.json written as the pipeline writes it: next to it first, so a crash mid-write never leaves half of it. */
function save(target: EditorTarget, data: Data) {
    const file = join(target.dir, 'project.json')
    const partial = `${file}.${process.pid}.partial`
    writeFileSync(partial, JSON.stringify(data, null, 2))
    renameSync(partial, file)
}

/** The steps of this kind of project, in the order of the pipeline - what a --redo from the page may name. */
export const stepNamesOf = (kind: EditorKind): readonly string[] => kind === 'film' ? FILM_STEP_NAMES : STEP_NAMES

/** How far the plan of a project is: the last stage it has, and the one a plan run makes next. */
export function planStateOf(kind: EditorKind, data: Data): { stage?: PlanStage, next?: PlanStage } {
    const stage = kind === 'film' ? filmStage(data as FilmProject) : musicStage(data as Project)
    return {stage, next: nextStage(stage)}
}

////////// A CHANGED casting.json - what the next plan run has to make again (issue #527)

// the steps a library asset stands in for: its texts replace theirs in the run (index.ts castTexts, film.ts fromLibrary)
const MUSIC_LIBRARY_STEPS: StepName[] = ['characterLooks', 'characterDescriptions', 'locationLooks', 'locationDescriptions', 'locationAnchors', 'locationLayouts']
const FILM_LIBRARY_STEPS: FilmStepName[] = ['characterLooks', 'characterDescriptions', 'locationLooks', 'locationDescriptions']

export type CastingRedo = {
    changes: string[],          // what casting.json says now that the project does not have yet, in words
    redo: string[],             // the --redo that makes what was planned from the old texts again; none: nothing was planned from them
}

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
export type CastMember = {
    id: string, name: string,
    role?: string,              // characters: who they are in the story
    prop?: string,              // music video characters: the thing they carry or play
    appearance?: string,        // film characters: what they look like, as the script says it
    voice?: string,             // film characters: how they sound
    voiceOnly?: boolean,        // film characters: never on screen
    description?: string,       // film places
    group?: boolean,            // music video: a group character - shown, its members are not changed here
}
export type CastView = {
    characters: CastMember[],
    locations: CastMember[],
    canAdd: boolean,            // a music video's cast comes from its story and can grow; a film's is the script's
    builtOn: string[],          // the steps that go when the cast is changed: planned again by the next plan run
    stage?: PlanStage,
}
export type CastChange = { characters: (Partial<CastMember> & { name: string })[], locations: (Partial<CastMember> & { name: string })[] }
export type CastResult = { changed: boolean, dropped: string[], added: string[], removed: string[] }

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
            canAdd: false, builtOn: filmBuiltOn(['cast'], data as FilmProject), stage,
        }
    }
    const cast = (data as Project).cast!
    return {
        characters: cast.characters.map(c => ({id: c.id, name: c.name, role: c.role, prop: c.prop, group: c.isGroup})),
        locations: cast.locations.map(l => ({id: l.id, name: l.name})),
        canAdd: true, builtOn: droppedByCast(kind, data, data), stage,
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

/**
 * The change put into the project data, in place: the new cast, and every step built on the old one gone - for a music video
 * also who sings which line (the singers are asked again; with a changed Singers page the hand-made choice goes too).
 */
export function applyCast(kind: EditorKind, data: Data, change: CastChange): CastResult {
    if (!data.cast) throw new Error('no cast yet - plan up to the cast first')
    if (!Array.isArray(change?.characters) || !Array.isArray(change?.locations)) throw new Error('characters and places are needed')
    const before = structuredClone(data)
    const next = kind === 'film' ? filmCast((data as FilmProject).cast!, change) : musicCast((data as Project).cast!, change)
    if (JSON.stringify(next) === JSON.stringify(data.cast)) return {changed: false, dropped: [], added: [], removed: []}
    const ids = (cast: { characters: { id: string }[], locations: { id: string }[] }) => [...cast.characters, ...cast.locations].map(m => m.id)
    const added = ids(next).filter(id => !ids(data.cast!).includes(id))
    const removed = ids(data.cast!).filter(id => !ids(next).includes(id))
    ;(data as { cast: unknown }).cast = next
    const dropped = droppedByCast(kind, before, data)
    drop(data, dropped)
    return {changed: true, dropped, added, removed}
}

export const readCast = (target: EditorTarget): CastView | undefined => castView(target.kind, dataOf(target))

export async function writeCast(target: EditorTarget, change: CastChange): Promise<CastResult> {
    return withProjectLock(target.dir, target.id, () => {
        const data = readJson<Data>(join(target.dir, 'project.json'))
        if (!data) throw new Error('no project.json yet - plan up to the cast first')
        const result = applyCast(target.kind, data, change)
        if (result.changed) save(target, data)
        return result
    })
}

////////// THE BOOK - the story of a music video, the screenplay of a film

export type BookView = {
    text?: string,              // the story; a film: its screenplay as a script reads
    editable: boolean,          // a music video's story is one text; a film's screenplay is changed in its script or in project.json
    builtOn: string[],          // the steps that go when it is changed
    stage?: PlanStage,
    next?: PlanStage,
}

export function bookView(kind: EditorKind, data: Data): BookView {
    const state = planStateOf(kind, data)
    if (kind === 'film') {
        const screenplay = (data as FilmProject).screenplay
        return {text: screenplay && screenplayToText(screenplay), editable: false, builtOn: [], ...state}
    }
    const story = (data as Project).story
    return {text: story, editable: story !== undefined, builtOn: builtOn(['story'], data as Project), ...state}
}

export const readBook = (target: EditorTarget): BookView => bookView(target.kind, dataOf(target))

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
