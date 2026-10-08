import type {FilmCharacter} from "./types.ts";

// A character the text of a clip names without giving the video model their picture is drawn from the name alone - a stranger.
// Matching is on the names the cast itself holds (name and every cue the script uses), nothing else.

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const namesOf = (character: FilmCharacter) => [...new Set([character.name, ...character.aliases].map(n => n.trim()).filter(n => n.length > 1))]

/** Does the text name this character? */
export const mentions = (text: string, character: FilmCharacter) =>
    namesOf(character).some(name => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, 'iu').test(text))

/** The text without the sentences that name any of these characters. */
export function withoutSentencesNaming(text: string, characters: FilmCharacter[]) {
    if (!characters.length) return text
    return [...new Intl.Segmenter(undefined, {granularity: 'sentence'}).segment(text)]
        .map(s => s.segment)
        .filter(sentence => !characters.some(c => mentions(sentence, c)))
        .join('').trim()
}

/**
 * The ids of the characters the script has named by the end of scene `index`: in the action lines, as the speaker of a line or in what is spoken.
 * A character the script has not brought in yet is not in the picture - the planner (who also reads the look brief, where everyone stands) puts the
 * cast into an establishing shot of an empty place. Matching is on the names the cast holds, nothing else.
 */
export function namedByScene(scenes: { elements: ({ type: 'action', text: string } | { type: 'dialogue', speaker: string, text: string })[] }[], characters: FilmCharacter[], index: number) {
    const text = scenes.slice(0, index + 1).flatMap(scene => scene.elements.map(e => e.type === 'action' ? e.text : `${e.speaker}. ${e.text}`)).join(' ')
    return new Set(characters.filter(c => mentions(text, c)).map(c => c.id))
}
