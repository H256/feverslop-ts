import {describe, expect, test} from "bun:test";
import type {Character} from "./project.ts";
import {plainText, readTokens, replaceTokens} from "./refs.ts";

const cast: Character[] = [{id: 'der-mann', name: 'Der Mann', role: 'x'}, {id: 'orcs', name: 'Orcs', role: 'y', isGroup: true}]

describe('{Name} tokens', () => {
    test('a token is the character with that name or id, exactly - nothing looser', () => {
        expect(readTokens('{Der Mann} sees {orcs}, {der-mann} turns, {Orc} and {the man} wait', cast)).toEqual({ids: ['der-mann', 'orcs'], unknown: ['Orc', 'the man']})
    })
    test('a plain name is plain text', () => {
        expect(readTokens('Der Mann and the Orcs', cast)).toEqual({ids: [], unknown: []})
    })
    test('replaced by what the caller gives, a token of nobody by its own word', () => {
        expect(replaceTokens('{Der Mann} fights {Orcs} and {a ghost}', cast, c => `<${c.id}>`)).toBe('<der-mann> fights <orcs> and a ghost')
        expect(plainText('{Der Mann} waits.', cast)).toBe('Der Mann waits.')
    })
})
