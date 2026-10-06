import slugify from "slugify";
import {languageName} from "../config.ts";
import type {DialogueKind, FilmCast, FilmCharacter, FilmLocation, Scene, Screenplay, ScreenplayElement} from "./types.ts";

// What the LLM answers for a screenplay - checked and turned into a Screenplay. Models are loose with enums and
// empty fields, so everything is normalized here and a script that can't be used is rejected with the reason.
type RawScreenplay = { scenes?: { setting?: string, location?: string, time?: string, elements?: Record<string, unknown>[] }[] }

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

/** Gives characters and locations unique ids and checks every speaker and place of the screenplay against them. */
export function toCast(raw: { characters?: Partial<FilmCharacter>[], locations?: Partial<FilmLocation>[] }, screenplay: Screenplay): FilmCast {
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
