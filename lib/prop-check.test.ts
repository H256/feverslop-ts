import {expect, test} from "bun:test";
import {propMissing, propNoun, propNouns} from "./prop-check.ts";

test('the noun of a prop is the last word of its first phrase', () => {
    expect(propNoun('a long-shafted war hammer with a black iron head')).toBe('hammer')
    expect(propNoun('an electric guitar')).toBe('guitar')
    expect(propNoun('a hand torch')).toBe('torch')
    expect(propNoun("a forge-master's war hammer, silver runes along the haft")).toBe('hammer')
    expect(propNoun('a pair of drumsticks')).toBe('drumstick')
    expect(propNoun('')).toBeUndefined()
})

test('a look that names the prop passes, also as part of a longer word and in the plural', () => {
    expect(propMissing('She grips a long war hammer with a black iron head.', 'a war hammer with a black head')).toBe(false)
    expect(propMissing('She carries a huge warhammer.', 'a hammer')).toBe(false)
    expect(propMissing('Two torches hang from her belt.', 'a hand torch')).toBe(false)
})

test('a prop styled after another thing may be named by that thing', () => {
    expect(propNouns('a compact mace-style hammer with a studded spherical iron head')).toEqual(['hammer', 'mace'])
    expect(propMissing('Right hand grips a compact mace with a studded spherical iron head on a short dark haft.', 'a compact mace-style hammer with a studded spherical iron head')).toBe(false)
    expect(propNouns('a long-shafted war hammer')).toEqual(['hammer'])
})

test('a look without the prop is reported', () => {
    expect(propMissing('A small young woman in a pale silk robe, no armor, no weapon, hands open.', 'a hammer')).toBe(true)
})

test('no prop noun means nothing to report', () => {
    expect(propMissing('anything', '')).toBe(false)
})
