import {toSlug} from "../slug.ts";
import type {Brief, FilmCast, FilmCharacter, FilmProject, Screenplay} from "./types.ts";
import {characterOf, locationOf, toScreenplay} from "./screenplay.ts";
import {screenplayToText} from "./fountain.ts";
import {filmBuiltOn, type FilmStepName} from "./store.ts";

// A role added to a film or taken out of it (#589). A film's cast is read from its screenplay, so the screenplay is told anew for
// the changed cast - only where the pipeline wrote it itself (idea mode). A screenplay that is the user's (screenplay mode) is
// checked against its source line for line: there the script is changed by its writer, and the run plans again from it.
// The new screenplay is a proposal next to the old one (output/screenplay-proposal.json, tools/story.ts --film --adapt), taken or
// dropped. Taken, the characters who stay keep their id, their looks and their pictures; the new ones get theirs from the next run.

export type AddedRole = { name: string, role: string }
export type RoleChange = { add: AddedRole[], remove: string[] }
// a new character as the proposal has them: what the cast step would have written of them
export type ProposedCharacter = { name: string, role: string, appearance: string, voice: string }
export type ScreenplayProposal = {
    screenplay: Screenplay,
    added: ProposedCharacter[],
    removed: string[],              // character ids
    for: string,                    // the screenplay and cast it was written from - another one now: it is gone
}

/** The version of a screenplay with its cast a proposal is for. */
export const screenplayFingerprint = (data: Pick<FilmProject, 'screenplay' | 'cast'>) => Bun.hash(JSON.stringify([data.screenplay, data.cast?.characters.map(c => c.id)])).toString(16)

/** Why a film cannot have a role added or taken out by a screenplay told anew - or nothing when it can. */
export function adaptRefusal(data: FilmProject): string | undefined {
    if (data.brief?.mode === 'screenplay') return 'the screenplay is yours (input/screenplay.txt), and the run checks that none of its lines changes: add or take out the role in that script, then plan again - the changed script redoes the screenplay and what is built on it'
    if (!data.screenplay || !data.cast) return 'no screenplay and cast yet - plan up to the cast first'
    return undefined
}

const clean = (value: unknown) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
const key = (value: string) => value.toLocaleLowerCase().replace(/\s+/g, ' ').trim()

/** "Name: role" as --add gives it. */
export function parseAddedRole(value: string): AddedRole | string {
    const at = value.indexOf(':')
    const name = clean(at < 0 ? value : value.slice(0, at)), role = clean(at < 0 ? '' : value.slice(at + 1))
    if (!name || !role) return `--add takes "Name: who they are in the story", not "${value}"`
    if (name.length > 80 || role.length > 600) return `"${value}" is too long - a name and a sentence or two`
    return {name, role}
}

/** The change checked against the cast: who goes is in it, who comes is not, and somebody is left who is seen. */
export function checkRoleChange(cast: FilmCast, change: RoleChange): string | undefined {
    if (!change.add.length && !change.remove.length) return 'nothing to change - name a role to add (--add="Name: role") or one to take out (--remove=<character id>)'
    for (const id of change.remove) if (!cast.characters.some(c => c.id === id)) return `no character ${id} - the cast has ${cast.characters.map(c => c.id).join(', ')}`
    for (const added of change.add) {
        if (characterOf(cast, added.name) && !change.remove.includes(characterOf(cast, added.name)!.id)) return `${added.name} is in the cast already`
    }
    if (new Set(change.add.map(a => key(a.name))).size < change.add.length) return 'a new name is given twice'
    const left = cast.characters.filter(c => !change.remove.includes(c.id))
    if (!left.some(c => !c.voiceOnly) && !change.add.length) return 'nobody would be left on screen'
    return undefined
}

const ids = (cast: FilmCast, removed: string[]) => cast.characters.filter(c => !removed.includes(c.id))

/**
 * What is wrong with a screenplay told anew: scenes or places that changed, a line spoken by someone gone or by nobody of the cast,
 * a new character who is in no scene. Empty when it can be taken.
 */
export function adaptProblems(before: Screenplay, after: Screenplay, cast: FilmCast, change: { added: { name: string }[], removed: string[] }): string[] {
    const problems: string[] = []
    if (after.scenes.length !== before.scenes.length) problems.push(`the screenplay has ${after.scenes.length} scenes instead of ${before.scenes.length} - keep every scene`)
    after.scenes.forEach((scene, n) => {
        const was = before.scenes[n]
        if (!was) return
        const place = locationOf(cast, scene.location)
        if (!place) problems.push(`scene ${n + 1} is at "${scene.location}", a place the film does not have`)
        else if (place.id !== locationOf(cast, was.location)?.id) problems.push(`scene ${n + 1} is at "${scene.location}" instead of "${was.location}" - keep the places`)
    })
    const removed = cast.characters.filter(c => change.removed.includes(c.id))
    const staying = {characters: ids(cast, change.removed), locations: cast.locations}
    const speakers = new Set(after.scenes.flatMap(s => s.elements).flatMap(e => e.type === 'dialogue' ? [e.speaker] : []))
    for (const speaker of speakers) {
        const gone = removed.find(c => c.aliases.some(a => key(a) === key(speaker)))
        if (gone) problems.push(`"${speaker}" speaks, but ${gone.name} leaves the film`)
        else if (!characterOf(staying, speaker) && !change.added.some(a => key(a.name) === key(speaker))) problems.push(`"${speaker}" speaks, but is nobody of the cast - a new character's cue is their name`)
    }
    const text = screenplayToText(after).toLocaleLowerCase()
    for (const added of change.added) if (!text.includes(added.name.toLocaleLowerCase())) problems.push(`${added.name} is in no scene - give them a part`)
    for (const gone of removed) {
        if (change.added.some(a => key(a.name) === key(gone.name))) continue      // the same name for someone new: it stays in the script
        const named = [gone.name, ...gone.aliases].filter(a => a.length >= 2).find(a => new RegExp(`(?<![\\p{L}\\p{N}])${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu').test(text))
        if (named) problems.push(`"${named}" is still in the screenplay, but ${gone.name} leaves the film`)
    }
    return problems
}

/** The language model's answer read: the screenplay, and the new characters as it describes them. */
export function readAdaptAnswer(raw: unknown, meta: { title: string, language: string }, added: AddedRole[]): { screenplay: Screenplay, characters: ProposedCharacter[] } {
    const answer = (raw ?? {}) as { characters?: unknown, scenes?: unknown }
    const screenplay = toScreenplay(answer as Parameters<typeof toScreenplay>[0], meta)
    const given = Array.isArray(answer.characters) ? answer.characters as Record<string, unknown>[] : []
    const characters = added.map(wanted => {
        const of = given.find(c => key(clean(c?.name)) === key(wanted.name))
        const appearance = clean(of?.appearance), voice = clean(of?.voice)
        if (!appearance || !voice) throw new Error(`the answer has no appearance or voice of ${wanted.name}`)
        return {name: wanted.name, role: wanted.role, appearance, voice}
    })
    return {screenplay, characters}
}

/** The language model's question for a screenplay told anew, from the film's data. */
export const adaptInput = (data: FilmProject, change: RoleChange) => ({
    screenplay: data.screenplay!, brief: data.brief as Brief,
    cast: {
        staying: ids(data.cast!, change.remove),
        added: change.add,
        removed: data.cast!.characters.filter(c => change.remove.includes(c.id)),
    },
})

const newId = (name: string, taken: Set<string>) => {
    const base = toSlug(name) || 'character'
    let id = base
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
    taken.add(id)
    return id
}

/** The cast with the proposal: who goes is gone, who stays keeps everything, who is new gets an id of their own. */
export function castWith(cast: FilmCast, proposal: Pick<ScreenplayProposal, 'added' | 'removed'>): { cast: FilmCast, added: string[] } {
    const taken = new Set(cast.characters.map(c => c.id))
    const added: FilmCharacter[] = proposal.added.map(c => ({id: newId(c.name, taken), name: c.name, aliases: [c.name], role: c.role, appearance: c.appearance, voice: c.voice}))
    return {cast: {characters: [...ids(cast, proposal.removed), ...added], locations: cast.locations}, added: added.map(c => c.id)}
}

// what a screenplay told anew for a changed cast leaves to plan again: what is read from the script (the summary, the props, the
// shots, the script notes and repairs, the subtitles) - the cast, the look and the places stay, as do the looks of who stays
const KEPT: FilmStepName[] = ['brief', 'outline', 'screenplay', 'cast', 'lookBrief', 'characterLooks', 'characterDescriptions', 'locationLooks', 'locationDescriptions', 'locationViews']

/** The steps a proposal taken drops as a whole: the steps built on the screenplay, but for those that stay. */
export const droppedByProposal = (data: FilmProject): FilmStepName[] => filmBuiltOn(['screenplay'], data).filter(step => !KEPT.includes(step))

/** The outline of an idea with the cast as it is now: who is gone is out of its characters and scenes, who is new is in. */
export function outlineWith(outline: NonNullable<FilmProject['outline']>, removed: FilmCharacter[], added: ProposedCharacter[]): NonNullable<FilmProject['outline']> {
    const gone = (name: string) => removed.some(c => [c.name, ...c.aliases].some(a => key(a) === key(name)))
    return {
        ...outline,
        characters: [...outline.characters.filter(c => !gone(c.name)), ...added],
        scenes: outline.scenes.map(s => ({...s, characters: s.characters.filter(name => !gone(name))})),
    }
}
