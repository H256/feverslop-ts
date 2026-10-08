import slugify from "slugify";
import {languageName} from "../config.ts";
import type {DialogueKind, FilmCast, FilmCharacter, FilmCharacterState, FilmLocation, Scene, Screenplay, ScreenplayElement} from "./types.ts";

// What the LLM answers for a screenplay - checked and turned into a Screenplay. Models are loose with enums and
// empty fields, so everything is normalized here and a script that can't be used is rejected with the reason.
type RawScreenplay = { scenes?: { setting?: string, location?: string, time?: string, shot?: string, elements?: Record<string, unknown>[] }[] }

const SETTINGS = ['INT', 'EXT', 'INT/EXT'] as const
const KINDS: DialogueKind[] = ['spoken', 'offscreen', 'voiceover']
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''

export function toScreenplay(raw: RawScreenplay, meta: { title: string, language: string }): Screenplay {
    if (!Array.isArray(raw?.scenes) || !raw.scenes.length) throw new Error('the screenplay has no scenes')
    const scenes: Scene[] = raw.scenes.map((scene, i) => {
        const setting = text(scene.setting).toUpperCase().replace(/\.$/, '')
        const elements: ScreenplayElement[] = (Array.isArray(scene.elements) ? scene.elements : []).flatMap((element): ScreenplayElement[] => {
            if (element.type === 'dialogue') {
                const speaker = text(element.speaker)
                const line = text(element.text)
                if (!speaker || !line) return []
                const kind = KINDS.find(k => k === text(element.kind).toLowerCase()) ?? 'spoken'
                const language = text(element.language).toLowerCase()
                return [{
                    type: 'dialogue', speaker, text: line, kind,
                    ...(text(element.delivery) ? {delivery: text(element.delivery)} : {}),
                    ...(text(element.translation) ? {translation: text(element.translation)} : {}),
                    ...(language && language !== meta.language && languageName(language) ? {language} : {}),
                }]
            }
            return text(element.text) ? [{type: 'action', text: text(element.text)}] : []
        })
        if (!elements.length) throw new Error(`scene ${i + 1} (${text(scene.location) || 'no location'}) has no action or dialogue`)
        return {
            id: `s${i + 1}`,
            setting: SETTINGS.find(s => s === setting) ?? 'INT',
            location: text(scene.location).replace(/^(INT\/EXT|INT|EXT)\.?\s+/i, '') || 'UNKNOWN',
            time: text(scene.time) || 'DAY',
            ...(text(scene.shot) ? {shot: text(scene.shot)} : {}),
            elements,
        }
    })
    return {title: meta.title, language: meta.language, scenes}
}

const letters = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/**
 * The dialogue lines of a screenplay that aren't in the source, word for word (case, spacing and punctuation aside) -
 * a screenplay that is adopted keeps its dialogue exactly, and the LLM that structures it must not reword a line.
 */
export function missingDialogue(screenplay: Screenplay, source: string) {
    const normalized = letters(source)
    return screenplay.scenes.flatMap(scene => scene.elements)
        .filter(element => element.type === 'dialogue' && !normalized.includes(letters(element.text)))
        .map(element => (element as Extract<ScreenplayElement, { type: 'dialogue' }>).text)
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu

/** Seconds to speak a line - a rough 2.2 words per second (4 characters in scripts without word spaces) plus a breath. Measured on rendered clips: the model speaks lines of emotional drama slowly. */
export function speechSeconds(line: string) {
    const cjk = line.match(CJK)?.length ?? 0
    const words = line.replace(CJK, ' ').split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length
    return cjk / 4 + words / 2.2 + 0.5
}

/** A rough running time: every spoken line takes its time, every action about 3 seconds - a guess to compare with the target, nothing more. */
export function estimateSeconds(screenplay: Screenplay) {
    return Math.round(screenplay.scenes.reduce((sum, scene) => sum + scene.elements.reduce((s, element) =>
        s + (element.type === 'dialogue' ? speechSeconds(element.text) : Math.max(2, element.text.split(/\s+/).length / 5)), 0), 0))
}

const key = (value: string) => value.toLocaleLowerCase().replace(/\s+/g, ' ').trim()
const toId = (name: string) => slugify(name, {lower: true, strict: true}) || 'x'

// the other looks of a character: at most two, each with a name and what is different
function statesOf(c: { voiceOnly?: boolean, states?: { name?: string, change?: string, from?: unknown }[] }): { states?: FilmCharacterState[] } {
    if (c.voiceOnly === true || !Array.isArray(c.states)) return {}
    const taken = new Set<string>()
    const states = c.states.filter(s => text(s?.name) && text(s?.change)).slice(0, 2).map((s): FilmCharacterState => {
        let id = toId(text(s.name))
        for (let n = 2; taken.has(id); n++) id = `${toId(text(s.name))}-${n}`
        taken.add(id)
        const from = Number(s.from)
        return {id, name: text(s.name), change: text(s.change), ...(Number.isInteger(from) && from > 1 ? {from} : {})}
    })
    return states.length ? {states} : {}
}

export type ScriptEdit = { scene?: unknown, element?: unknown, text?: unknown, time?: unknown }

/**
 * Applies the repair the language model proposes for a script that contradicts itself - and only that kind: a new text for an ACTION line,
 * or a new time of day for a scene. Dialogue is never touched, no scene or line is added or dropped. What does not fit (an unknown scene,
 * a dialogue line, an empty text) is left out and reported.
 */
export function applyScriptFixes(screenplay: Screenplay, edits: unknown): { screenplay: Screenplay, applied: { scene: string, before: string, after: string }[], rejected: string[] } {
    const applied: { scene: string, before: string, after: string }[] = []
    const rejected: string[] = []
    const scenes = screenplay.scenes.map(scene => ({...scene, elements: [...scene.elements]}))
    for (const edit of Array.isArray(edits) ? edits as ScriptEdit[] : []) {
        const scene = scenes.find(s => s.id === text(edit?.scene))
        if (!scene) { rejected.push(`no scene "${text(edit?.scene)}"`); continue }
        if (text(edit.time)) {
            applied.push({scene: scene.id, before: `time: ${scene.time}`, after: `time: ${text(edit.time).toUpperCase()}`})
            scene.time = text(edit.time).toUpperCase()
        }
        if (edit.element === undefined && !text(edit.text)) continue
        const n = Number(edit.element)
        const element = scene.elements[n]
        if (!Number.isInteger(n) || !element || element.type !== 'action') { rejected.push(`${scene.id}: element ${String(edit.element)} is not an action line`); continue }
        if (!text(edit.text)) { rejected.push(`${scene.id}: empty text`); continue }
        applied.push({scene: scene.id, before: element.text, after: text(edit.text)})
        scene.elements[n] = {type: 'action', text: text(edit.text)}
    }
    return {screenplay: {...screenplay, scenes}, applied, rejected}
}

type RawCast = { characters?: RawCharacter[], locations?: Partial<FilmLocation>[] }

/**
 * An answer of the cast step that is asked again fixes what was left out - and sometimes leaves out what the first one had (a voice, a place). The
 * union of both, by name: what the new answer says wins, what only the earlier one has is kept.
 */
export function mergeRawCasts(earlier: RawCast, later: RawCast): RawCast {
    const merge = <T extends { name?: string }>(a: T[] | undefined, b: T[] | undefined) => {
        const names = new Set((b ?? []).map(x => (x.name ?? '').trim().toLowerCase()))
        return [...(b ?? []), ...(a ?? []).filter(x => !names.has((x.name ?? '').trim().toLowerCase()))]
    }
    return {characters: merge(earlier.characters, later.characters), locations: merge(earlier.locations, later.locations)}
}

/** Gives characters and locations unique ids and checks every speaker and place of the screenplay against them. */
export type RawCharacter = Omit<Partial<FilmCharacter>, 'states'> & { states?: { name?: string, change?: string, from?: unknown }[] }
export function toCast(raw: { characters?: RawCharacter[], locations?: Partial<FilmLocation>[] }, screenplay: Screenplay): FilmCast {
    const unique = (base: string, taken: Set<string>) => {
        let id = base
        for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
        taken.add(id)
        return id
    }
    const characterIds = new Set<string>()
    const characters: FilmCharacter[] = (raw.characters ?? []).filter(c => text(c.name)).map(c => ({
        id: unique(toId(text(c.name)), characterIds),
        name: text(c.name),
        aliases: [...new Set([text(c.name), ...(Array.isArray(c.aliases) ? c.aliases.map(text) : [])].filter(Boolean))],
        role: text(c.role),
        appearance: text(c.appearance),
        voice: text(c.voice),
        ...(c.voiceOnly === true ? {voiceOnly: true} : {}),
        ...statesOf(c),
    }))
    const locationIds = new Set<string>()
    const locations: FilmLocation[] = (raw.locations ?? []).filter(l => text(l.name)).map(l => ({
        id: unique(toId(text(l.name)), locationIds),
        name: text(l.name),
        aliases: [...new Set([text(l.name), ...(Array.isArray(l.aliases) ? l.aliases.map(text) : [])].filter(Boolean))],
        description: text(l.description),
    }))
    if (!characters.length) throw new Error('the cast has no characters')
    if (!locations.length) throw new Error('the cast has no locations')

    const unknownSpeakers = unresolved(screenplay, characters, locations)
    if (unknownSpeakers.length) throw new Error(`not in the cast: ${unknownSpeakers.join('; ')}`)
    return {characters, locations}
}

export const characterOf = (cast: FilmCast, speaker: string) => cast.characters.find(c => c.aliases.some(alias => key(alias) === key(speaker)))
export const locationOf = (cast: FilmCast, location: string) => cast.locations.find(l => l.aliases.some(alias => key(alias) === key(location)))

function unresolved(screenplay: Screenplay, characters: FilmCharacter[], locations: FilmLocation[]) {
    const cast = {characters, locations}
    const speakers = new Set(screenplay.scenes.flatMap(s => s.elements).flatMap(e => e.type === 'dialogue' ? [e.speaker] : []))
    const places = new Set(screenplay.scenes.map(s => s.location))
    return [
        ...[...speakers].filter(s => !characterOf(cast, s)).map(s => `speaker "${s}"`),
        ...[...places].filter(l => !locationOf(cast, l)).map(l => `location "${l}"`),
    ]
}
