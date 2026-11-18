import {describe, expect, test} from 'bun:test'
import {parseFact} from './beats.ts'

// tides-261115: "{Kael} holds his guitar at his side, not playing" went on into every later clip of Kael
describe('a fact of a beat as the planner wrote it', () => {
    test('a fact of the place and one on a character are kept, with what they end', () => {
        expect(parseFact({fact: 'the gate is broken', kind: 'place', ends: []})).toEqual({fact: 'the gate is broken', place: true})
        expect(parseFact({fact: "{Kael}'s cloak is mended", kind: 'on them', ends: ["{Kael}'s cloak is torn"]})).toEqual({
            fact: "{Kael}'s cloak is mended",
            place: false,
            ends: ["{Kael}'s cloak is torn"],
        })
    })
    test('where someone is, what they do and a sound are not kept - what they end still ends', () => {
        expect(parseFact({fact: '{Kael} holds his guitar at his side', kind: 'doing', ends: []})).toEqual({fact: '', place: false})
        expect(parseFact({fact: '{Sera} stands between them', kind: 'where', ends: ['{Sera} stands at the back']})).toEqual({
            fact: '',
            place: false,
            ends: ['{Sera} stands at the back'],
        })
        expect(parseFact({fact: 'the kit rings on', kind: 'sound', ends: []}).fact).toBe('')
    })
    test('a fact from before the kinds says "place" itself; a plain string is read as written', () => {
        expect(parseFact({fact: 'the fire is out', place: true})).toEqual({fact: 'the fire is out', place: true})
        expect(parseFact('the fire is out')).toEqual({fact: 'the fire is out', place: false})
    })
})
