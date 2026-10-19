import {describe, expect, test} from "bun:test";
import {characterLookPrompt, locationLookPrompt, propInUsePrompt} from "./prompts.ts";
import {pictureProp} from "./prop-check.ts";
import {castProp} from "./shot-planner.ts";

const drummer = {id: 'brynn', name: 'Brynn', role: 'drummer', prop: 'drum kit', propCarried: false as const, propInHand: 'drumsticks', propPlace: 'stage'}
const guitarist = {id: 'kaelen', name: 'Kaelen', role: 'guitarist', prop: 'electric guitar'}
const stage = [{id: 'stage', name: 'The stage'}]

describe('props in the pictures', () => {
    test('a carried prop is shown in use, the hands named at work on it, with no weapon parts asked for', () => {
        const {input} = characterLookPrompt('look', guitarist)
        expect(input).toContain('"electric guitar": show exactly that object')
        expect(input).toContain('It is in use in the picture: held in the position it has while it is used, and say where each of the hands is on it, at work - never resting, hanging down')
        expect(input).not.toContain('blade')
        expect(input).toContain('"prop":"electric guitar"')
    })
    test('a character without hands is given none - the look, the check and the planner use what it has', () => {
        const donut = {id: 'glaze', name: 'Glaze', role: 'a talking donut, the bassist', prop: 'bass guitar', hands: 'sprinkle-covered arms'}
        expect(characterLookPrompt('look', donut).input).toContain('say where each of the sprinkle-covered arms is on it, at work')
        expect(propInUsePrompt('look', 'bass guitar', 'sprinkle-covered arms').instructions).toContain("with the character's sprinkle-covered arms on it")
        expect(castProp(donut, stage)).toBe('bass guitar (held and used with the sprinkle-covered arms)')
        expect(castProp({...drummer, hands: 'tentacles'}, stage)).toBe('drum kit (stands in The stage and is used there, with drumsticks in the tentacles - never carried)')
        // a person: nothing changes
        expect(castProp(guitarist, stage)).toBe('electric guitar')
    })
    test('the check of a finished look asks the LLM whether the prop is in use - true or false and why', () => {
        const options = propInUsePrompt('A bass guitar rests against her waist.', 'bass guitar')
        expect(options.input).toBe('A bass guitar rests against her waist.')
        expect(options.instructions).toContain('Does the picture show "bass guitar" in use')
        expect(options.schema).toMatchObject({required: ['inUse', 'why']})
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
