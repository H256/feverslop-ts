import {describe, expect, test} from "bun:test";
import {characterLookPrompt, locationLookPrompt} from "./prompts.ts";
import {pictureProp} from "./prop-check.ts";
import {castProp} from "./shot-planner.ts";

const drummer = {id: 'brynn', name: 'Brynn', role: 'drummer', prop: 'drum kit', propCarried: false as const, propInHand: 'drumsticks', propPlace: 'stage'}
const guitarist = {id: 'kaelen', name: 'Kaelen', role: 'guitarist', prop: 'electric guitar'}
const stage = [{id: 'stage', name: 'The stage'}]

describe('props in the pictures', () => {
    test('a carried prop is shown the way it is held while used, with no weapon parts asked for', () => {
        const {input} = characterLookPrompt('look', guitarist)
        expect(input).toContain('"electric guitar": show exactly that object, held or worn the way the character holds it while using it')
        expect(input).not.toContain('blade')
        expect(input).toContain('"prop":"electric guitar"')
    })
    test('a prop that stands in a place is not in the character picture - only what is held of it', () => {
        const {input} = characterLookPrompt('look', drummer)
        expect(input).toContain('which stands in a place and is not in this picture: they hold only "drumsticks"')
        expect(input).toContain('"inHand":"drumsticks"')
        expect(input).not.toContain('"prop":')
        expect(pictureProp(drummer)).toBe('drumsticks')
        expect(pictureProp(guitarist)).toBe('electric guitar')
    })
    test('the place shows what stands in it and none of the carried props', () => {
        const {input} = locationLookPrompt('look', 'story', 'The stage', ['electric guitar'], ['drum kit'])
        expect(input).toContain('the place shows none of them, not even lying around, hanging or leaning somewhere: "electric guitar"')
        expect(input).toContain('These objects stand in the place, ready to be used - each one exactly once, complete, at one fixed spot where it is clearly seen (a musical instrument with all the parts a player uses')
        expect(input).toContain('a stool behind it): "drum kit"')
    })
    test('the planner reads a standing prop as used where it stands', () => {
        expect(castProp(drummer, stage)).toBe('drum kit (stands in The stage and is used there, with drumsticks in the hands - never carried)')
        expect(castProp(guitarist, stage)).toBe('electric guitar')
    })
})
