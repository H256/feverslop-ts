import {existsSync} from 'node:fs'
import {writeJsonFile} from '../../json-file.ts'
import {join} from 'node:path'
import {toSlug} from '../../slug.ts'
import {
    CASTING_FILE,
    castingAfterCastChange,
    type CastEntry,
    copyKey,
    droppedCopies,
    libraryFingerprint,
    readCastingFile,
    resolveCasting,
} from '../../casting.ts'
import {libraryDir, libraryIds} from '../../library.ts'
import {withProjectLock} from '../../lock.ts'
import {builtOn, type Character, type Location, type Project, redoAfter, type StepName} from '../../project.ts'
import {filmBuiltOn, filmRedoAfter, type FilmStepName} from '../../film/store.ts'
import type {FilmCharacter, FilmLocation, FilmProject} from '../../film/types.ts'
import {adaptRefusal, droppedByProposal} from '../../film/adapt.ts'
import type {EditorKind, EditorTarget} from '../project.ts'
import type {CastingRedo, CastView, CastChange, CastResult} from '../../../shared/workspace.ts'
import {
    readJson,
    type Data,
    dataOf,
    save,
    stepNamesOf,
    planStateOf,
    cleanText,
    optionalText,
    drop,
    ELEMENT_STEPS,
    isElementStep,
    remakeElements,
} from './base.ts'

// The preproduction in the workspace (#526): the cast, by hand and from casting.json. See ../preproduction.ts.

////////// A CHANGED casting.json - what the next plan run has to make again (issue #527)

// the steps a library asset stands in for: its texts replace theirs in the run (index.ts castTexts, film.ts fromLibrary)
export const MUSIC_LIBRARY_STEPS: StepName[] = [
    'characterLooks',
    'characterDescriptions',
    'locationLooks',
    'locationDescriptions',
    'locationAnchors',
    'locationLayouts',
]
export const FILM_LIBRARY_STEPS: FilmStepName[] = ['characterLooks', 'characterDescriptions', 'locationLooks', 'locationDescriptions']

/**
 * What a plan run would take over from casting.json that the project does not have yet - a role the library plays now (or in
 * another version of the asset), a role back to "project:" - and the steps planned from the old texts. The run itself only
 * names those (index.ts "changed since the plan was made"): the page asks first and then gives the run this --redo.
 */
export async function castingRedo(target: EditorTarget): Promise<CastingRedo> {
    const data = dataOf(target)
    const raw = data.cast as {characters: {id: string; name: string; voiceOnly?: boolean}[]; locations: {id: string; name: string}[]} | undefined
    if (!raw) return {changes: [], redo: []}
    const cast = {characters: raw.characters.filter(c => !c.voiceOnly), locations: raw.locations}
    const library = await libraryDir()
    let resolved: ReturnType<typeof resolveCasting>
    try {
        resolved = resolveCasting(readCastingFile(target.dir), cast, (kind, id) => libraryIds(library, kind).includes(id))
    } catch {
        return {changes: [], redo: []} // a broken casting.json: the casting page says so, and the run stops on it
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
    const redo = new Set<string>(kind === 'film' ? filmRedoAfter(FILM_LIBRARY_STEPS, data as FilmProject) : redoAfter(MUSIC_LIBRARY_STEPS, data as Project))
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

/** A new id from a name, as the cast step makes them: lowercase, dashes, a number when it is taken. */
export function newId(name: string, taken: Set<string>, fallback: string) {
    const base = toSlug(name) || fallback
    let id = base
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
    taken.add(id)
    return id
}

/** The steps that go when the cast changes. A music video keeps the separated instruments while the instruments heard stay the same: those are no language model, but minutes of demucs. */
export function droppedByCast(kind: EditorKind, before: Data, after: Data): string[] {
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
            canAdd: false,
            builtOn: filmBuiltOn(['cast'], data as FilmProject),
            remakes: [],
            stage,
            // who is in it is the script's: a role comes or goes with the screenplay told anew - where the pipeline wrote it (#589)
            adapt: {refused: adaptRefusal(data as FilmProject), dropped: droppedByProposal(data as FilmProject)},
        }
    }
    const cast = (data as Project).cast!
    return {
        characters: cast.characters.map(c => ({id: c.id, name: c.name, role: c.role, prop: c.prop, group: c.isGroup})),
        locations: cast.locations.map(l => ({id: l.id, name: l.name})),
        canAdd: true,
        stage,
        builtOn: droppedByCast(kind, data, data).filter(step => !isElementStep(kind, step)),
        remakes: droppedByCast(kind, data, data).filter(step => isElementStep(kind, step)),
    }
}

/** The new cast of a music video: the members kept with what they had and what was changed, the new ones with an id of their own. */
export function musicCast(cast: NonNullable<Project['cast']>, change: CastChange): NonNullable<Project['cast']> {
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
        if (character.propPlace && !locations.some(l => l.id === character.propPlace))
            for (const key of ['propCarried', 'propInHand', 'propPlace'] as const) delete character[key]
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
export function filmCast(cast: NonNullable<FilmProject['cast']>, change: CastChange): NonNullable<FilmProject['cast']> {
    const same = (wanted: {id?: string}[], have: {id: string}[]) => wanted.length === have.length && have.every(h => wanted.some(w => w.id === h.id))
    if (!same(change.characters, cast.characters) || !same(change.locations, cast.locations))
        throw new Error('the script says who is in a film and where it is: change it there - here the names and texts change')
    const characters: FilmCharacter[] = cast.characters.map(old => {
        const wanted = change.characters.find(c => c.id === old.id)!
        const name = cleanText(wanted.name, `the name of ${old.id}`, 200)
        return {
            ...old,
            name,
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
    const ids = (cast: {characters: {id: string}[]; locations: {id: string}[]}) => [...cast.characters, ...cast.locations].map(m => m.id)
    const added = ids(next).filter(id => !ids(data.cast!).includes(id))
    const removed = ids(data.cast!).filter(id => !ids(next).includes(id))
    const members = (cast: {characters: {id: string; name: string}[]; locations: {id: string; name: string}[]}) => [...cast.characters, ...cast.locations]
    const renamed = members(next).flatMap(m => {
        const was = members(data.cast!).find(o => o.id === m.id)
        return was && was.name !== m.name ? [{from: was.name, to: m.name}] : []
    })
    ;(data as {cast: unknown}).cast = next
    const builtOnCast = droppedByCast(kind, before, data)
    if (kind === 'film') {
        // a film's summary is written from its cast, and the look and every look from the summary: all of it goes
        drop(data, builtOnCast)
        return {changed: true, dropped: builtOnCast, remade: [], added, removed, renamed}
    }
    // a music video: the looks of whoever is new or changed are written again, the others stay as they are
    const changedIn = <T extends {id: string}>(was: T[], now: T[]) =>
        now.filter(m => JSON.stringify(m) !== JSON.stringify(was.find(w => w.id === m.id))).map(m => m.id)
    const oldCast = (before as Project).cast!
    const changedCharacters = changedIn(oldCast.characters, next.characters as Character[])
    const changedLocations = changedIn(oldCast.locations, next.locations as Location[])
    const elementSteps = builtOnCast.filter(step => isElementStep(kind, step))
    const dropped = builtOnCast.filter(step => !isElementStep(kind, step))
    drop(data, dropped)
    const remade = [
        ...remakeElements(
            kind,
            data,
            elementSteps.filter(s => ELEMENT_STEPS.music[s]!.kind === 'character'),
            changedCharacters,
        ).map(step => `${step}: ${changedCharacters.join(', ')}`),
        ...remakeElements(
            kind,
            data,
            elementSteps.filter(s => ELEMENT_STEPS.music[s]!.kind === 'location'),
            changedLocations,
        ).map(step => `${step}: ${changedLocations.join(', ')}`),
    ].filter(line => !line.endsWith(': '))
    return {changed: true, dropped, remade, added, removed, renamed}
}

/**
 * New characters join a planned music video (#765): only their own looks and descriptions are written by the next plan run -
 * the story, the beats, the timeline and every shot stay. Who they are in a beat is said with addToBeats (lib/editor/beat-cast.ts).
 */
export function applyCastJoin(data: Project, join: {name: string; role: string}[]): {joined: string[]; remade: string[]} {
    if (!data.cast) throw new Error('no cast yet - plan up to the cast first')
    if (!Array.isArray(join) || !join.length) return {joined: [], remade: []}
    const before = data.cast
    const keep = before.characters.map(c => ({...c, id: c.id, name: c.name, role: c.role ?? ''}))
    const next = musicCast(before, {characters: [...keep, ...join.map(j => ({name: j.name, role: j.role}))], locations: before.locations})
    const joined = next.characters.filter(c => !before.characters.some(o => o.id === c.id)).map(c => c.id)
    data.cast = next
    const steps = Object.entries(ELEMENT_STEPS.music)
        .filter(([, step]) => step.kind === 'character')
        .map(([step]) => step)
    const remade = remakeElements('music', data, steps, joined)
    return {joined, remade}
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
