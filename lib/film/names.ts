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
