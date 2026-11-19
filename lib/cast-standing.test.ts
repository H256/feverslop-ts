import {describe, expect, test} from 'bun:test'
import {castStandingPrompt, giveStanding, holdersOf, withStanding} from './cast-standing.ts'

// zz-stille-261118: the cast step had the drum kit and the piano player's keys carried - the clips put the keys in his hands
type Entry = {name: string; role?: string; prop?: string; propCarried?: boolean; propInHand?: string; propPlace?: string}
const cast: Entry[] = [
    {name: 'Elias', role: 'Vocalist and keys player', prop: 'keys'},
    {name: 'Julian', role: 'Guitarist', prop: 'guitar', propCarried: false, propInHand: 'pick', propPlace: 'Stage'},
    {name: 'Mateo', role: 'Drummer', prop: 'drum kit'},
    {name: 'Ann', role: 'Fan'},
]

describe('whether a prop is carried, asked once more', () => {
    test('everybody with a prop is asked, nobody without', () => {
        expect(holdersOf(cast).map(h => h.name)).toEqual(['Elias', 'Julian', 'Mateo'])
    })

    test('the answer wins both ways; who it leaves out keeps the cast step', () => {
        const after = withStanding(cast, [
            {name: 'Elias', carried: false, inHand: '', place: 'Stage'},
            {name: 'Julian', carried: true, inHand: 'pick', place: 'Stage'},
        ])
        expect(after[0]).toEqual({name: 'Elias', role: 'Vocalist and keys player', prop: 'keys', propCarried: false, propPlace: 'Stage'})
        // a carried prop has no place and nothing else in the hands
        expect(after[1]).toEqual({name: 'Julian', role: 'Guitarist', prop: 'guitar', propCarried: true})
        expect(after[2]).toBe(cast[2])
        expect(after[3]).toBe(cast[3])
    })

    test('a standing prop with sticks in the hand and no single place', () => {
        const [, , mateo] = withStanding(cast, [{name: 'Mateo', carried: false, inHand: ' drumsticks ', place: ''}])
        expect(mateo).toEqual({name: 'Mateo', role: 'Drummer', prop: 'drum kit', propCarried: false, propInHand: 'drumsticks'})
    })

    test('one short call: the holders and the places as data, thinking off', () => {
        const prompt = castStandingPrompt(holdersOf(cast), ['Stage', 'Dressing room'])
        expect(prompt.reasoning).toBe('none')
        expect(prompt.input).toContain('{"name":"Mateo","role":"Drummer","prop":"drum kit"}')
        expect(prompt.input).toContain('["Stage","Dressing room"]')
    })
})

describe('the answer written into a planned project', () => {
    const planned = () => ({
        cast: {
            characters: [
                {id: 'elias', name: 'Elias', role: 'keys player', prop: 'keys'},
                {id: 'julian', name: 'Julian', role: 'Guitarist', prop: 'guitar'},
            ],
            locations: [
                {id: 'stage', name: 'Stage'},
                {id: 'dressing-room', name: 'Dressing room'},
            ],
        },
        locationLayouts: {stage: {layout: 'x'}},
        shotMoments: {},
        characterLooks: {elias: 'a man'},
    })

    test('a prop that stands gets its place by id; the places and shots built on it go, the pictures stay', () => {
        const data: Record<string, unknown> & ReturnType<typeof planned> = planned()
        const {changed, dropped} = giveStanding(data, [
            {name: 'Elias', carried: false, inHand: '', place: 'Stage'},
            {name: 'Julian', carried: true, inHand: '', place: ''},
        ])
        expect(changed).toEqual([{id: 'elias', name: 'Elias', prop: 'keys', stands: true}])
        expect(data.cast.characters[0] as object).toEqual({
            id: 'elias',
            name: 'Elias',
            role: 'keys player',
            prop: 'keys',
            propCarried: false,
            propPlace: 'stage',
        })
        expect(dropped).toEqual(['locationLayouts', 'shotMoments'])
        expect(data.characterLooks).toEqual({elias: 'a man'})
    })

    test('an answer that changes nothing drops nothing', () => {
        const data = planned()
        expect(giveStanding(data, [{name: 'Julian', carried: true, inHand: '', place: ''}])).toEqual({changed: [], dropped: []})
        expect(data.locationLayouts).toBeDefined()
    })
})
