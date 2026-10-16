import {askJson} from "./llm.ts";
import type {Character} from "./project.ts";

// Who a sentence of the LLM is about is not guessed from its words: the beats and the shot planner write every character
// as {Name} - in braces, exactly as in the cast - and the code reads the braces. A name written without them is plain
// text; a token that is no character of the cast is a problem of the answer.

const TOKEN = /\{([^{}\n]{1,80})\}/g

/** The character a token means: its name or its id, exactly, ignoring case - nothing looser. */
export function tokenCharacter(characters: Character[], token: string): Character | undefined {
    const wanted = token.trim().toLowerCase()
    return characters.find(c => c.name.toLowerCase() === wanted || c.id.toLowerCase() === wanted)
}

/** The tokens of a text, in order: the characters they mean and the ones that mean nobody. */
export function readTokens(text: string, characters: Character[]): { ids: string[], unknown: string[] } {
    const ids: string[] = []
    const unknown: string[] = []
    for (const [, token] of text.matchAll(TOKEN)) {
        const character = tokenCharacter(characters, token!)
        if (character) {
            if (!ids.includes(character.id)) ids.push(character.id)
        } else if (!unknown.includes(token!)) unknown.push(token!)
    }
    return {ids, unknown}
}

/** Every token replaced: by what `replace` gives for its character, or - for a token that means nobody - by its own text. */
export function replaceTokens(text: string, characters: Character[], replace: (character: Character) => string): string {
    return text.replace(TOKEN, (whole, token: string) => {
        const character = tokenCharacter(characters, token)
        return character ? replace(character) : token
    })
}

/** The text with the plain names of its characters, without braces - for whatever a person reads (the gallery, the log). */
export const plainText = (text: string, characters: Character[]) => replaceTokens(text, characters, c => c.name)

/**
 * Tokens that mean nobody of the cast ({Aldric} for "Aldric Thorne"): the LLM is asked once which character each one
 * means - it knows, the code does not guess - and those tokens are written as the character's name; a token it maps to
 * nobody loses its braces. Returns the texts with the tokens replaced, and what was mapped.
 */
export async function resolveUnknownTokens(texts: string[], characters: Character[]): Promise<{ texts: string[], mapped: Record<string, string | null> }> {
    const unknown = [...new Set(texts.flatMap(t => readTokens(t, characters).unknown))]
    if (!unknown.length) return {texts, mapped: {}}
    const answer = await askJson<{ tokens?: { token?: unknown, id?: unknown }[] }>({
        input: `These names in braces were written for characters of a music video, but they are not spelled like any character of the cast (a short form, a nickname, another language). For each, say which character of the cast it means - or null if it is none of them (an extra, a crowd, a thing).
Answer only with JSON: {"tokens": [{"token": "<as given, without braces>", "id": "<character id or null>"}]}
---
tokens: ${JSON.stringify(unknown)}
cast: ${JSON.stringify(characters.map(c => ({id: c.id, name: c.name, role: c.role})))}`,
        instructions: 'You match names to the characters of a cast. Answer only with JSON.',
    })
    const mapped: Record<string, string | null> = Object.fromEntries(unknown.map(token => [token, null]))
    for (const entry of answer.tokens ?? []) {
        const character = characters.find(c => c.id === entry.id)
        if (typeof entry.token === 'string' && entry.token in mapped) mapped[entry.token] = character ? character.name : null
    }
    // exact token strings only - "{Aldric}" becomes "{Aldric Thorne}", nothing else in the text is touched
    const fixed = texts.map(text => text.replace(TOKEN, (whole, token: string) => token in mapped ? (mapped[token] ? `{${mapped[token]}}` : token) : whole))
    return {texts: fixed, mapped}
}
