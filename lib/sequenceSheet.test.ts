import {describe, expect, test} from "bun:test";
import {characterLookSequencePrompt, characterSequencePrompt, EXPRESSIONS, expressionFor, expressionOf, locationSequencePrompt} from "./sequenceSheet.ts";

describe('the expression of a character sheet (#378)', () => {
    test('comes from the words: the same in every run, so the fingerprint stays put', () => {
        const karl = 'A tall man in a grey coat.'
        expect(characterSequencePrompt(karl).prompt).toBe(characterSequencePrompt(karl).prompt)
        expect(characterLookSequencePrompt('his arm is bandaged.').prompt).toBe(characterLookSequencePrompt('his arm is bandaged.').prompt)
        expect(Object.keys(EXPRESSIONS)).toContain(expressionFor(karl))
        expect(Array.from({length: 40}, (_, n) => expressionFor(`character ${n}`))).not.toContain('neutral')
        // different characters still get different ones
        const drawn = new Set(Array.from({length: 40}, (_, n) => expressionFor(`character ${n}`)))
        expect(drawn.size).toBeGreaterThan(5)
    })
    test('a sheet made before keeps the one it was drawn with', () => {
        const {prompt} = characterSequencePrompt('Karl', undefined, 'sad')
        expect(prompt).toContain(`the expression now sad: ${EXPRESSIONS.sad}`)
        expect(expressionOf(prompt)).toBe('sad')
        expect(characterSequencePrompt('Karl', undefined, expressionOf(prompt)).prompt).toBe(prompt)
        expect(expressionOf(characterLookSequencePrompt('soaked.', undefined, 'angry').prompt)).toBe('angry')
        // no sheet yet, or a prompt without one: the words decide
        expect(expressionOf(undefined)).toBeUndefined()
        expect(expressionOf('the expression now sleepy: eyes closed')).toBeUndefined()
        expect(characterSequencePrompt('Karl', undefined, undefined).prompt).toBe(characterSequencePrompt('Karl').prompt)
    })
})

describe('a location sheet keeps its fixtures', () => {
    test('every view, generic or designed, keeps the number and place of what the first frame has', () => {
        const keep = 'Every fixture of the first frame - each light source, door, window, piece of furniture and prop - keeps its number, its place and its look in every view that shows it'
        expect(locationSequencePrompt('A stage').prompt).toContain(keep)
        expect(locationSequencePrompt('A stage', undefined, ['a', 'b', 'c', 'd']).prompt).toContain(keep)
    })
})
