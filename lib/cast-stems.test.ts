import {describe, expect, test} from 'bun:test'
import {castStemsPrompt, giveLayers, stemQuestion, withStems} from './cast-stems.ts'

// tides-of-eternal-flame-261113: the guitarist has no layer, the bassist and the drummer have theirs (#1085)
const cast = [
    {name: 'Lira', prop: ''},
    {name: 'Kael', role: 'guitarist', prop: 'white flying-v electric guitar'},
    {name: 'Thorne', role: 'bassist', prop: 'bass guitar', propStem: 'bass'},
    {name: 'Veyra', role: 'drummer', prop: 'obsidian drum kit', propStem: 'drums'},
]

describe('stemQuestion - who carries something and has no layer, in a cast where somebody plays', () => {
    test('the guitarist is asked, the players and the one with nothing are not', () => {
        const {players, candidates} = stemQuestion(cast)
        expect(players.map(p => p.name)).toEqual(['Thorne', 'Veyra'])
        expect(candidates).toEqual([{name: 'Kael', role: 'guitarist', prop: 'white flying-v electric guitar'}])
    })

    test('a cast with no player asks nobody: a microphone is no band', () => {
        expect(
            stemQuestion([
                {name: 'Lyra', prop: 'microphone on a stand'},
                {name: 'Old man', prop: 'a walking stick'},
            ]).candidates,
        ).toEqual([])
    })

    test('a layer that is not one of the five is no layer', () => {
        expect(
            stemQuestion([
                {name: 'A', prop: 'a harp', propStem: 'harp'},
                {name: 'B', prop: 'bass guitar', propStem: 'bass'},
            ]).candidates,
        ).toEqual([{name: 'A', role: '', prop: 'a harp'}])
    })
})

describe('withStems - the answer is taken for those who were asked', () => {
    const asked = [{name: 'Kael'}]

    test('the guitarist gets the layer', () => {
        const out = withStems(cast, [{name: 'Kael', propStem: 'guitar'}], asked)
        expect(out.find(c => c.name === 'Kael')?.propStem).toBe('guitar')
        // nobody else is touched
        expect(out.find(c => c.name === 'Thorne')?.propStem).toBe('bass')
        expect(out.find(c => c.name === 'Lira')).toEqual({name: 'Lira', prop: ''})
    })

    test('an empty layer, an unknown one, or a name nobody asked about changes nothing', () => {
        expect(withStems(cast, [{name: 'Kael', propStem: ''}], asked)).toEqual(cast)
        expect(withStems(cast, [{name: 'Kael', propStem: 'kazoo'}], asked)).toEqual(cast)
        expect(withStems(cast, [{name: 'Lira', propStem: 'guitar'}], asked)).toEqual(cast)
    })

    test('a layer that was set stays, whatever the answer says', () => {
        const out = withStems(cast, [{name: 'Thorne', propStem: 'guitar'}], [{name: 'Thorne'}])
        expect(out.find(c => c.name === 'Thorne')?.propStem).toBe('bass')
    })
})

describe('castStemsPrompt', () => {
    test('names the players with their layers and the characters asked, and the five layers', () => {
        const {players, candidates} = stemQuestion(cast)
        const {input, schema} = castStemsPrompt(players, candidates)
        expect(input).toContain('"Thorne"')
        expect(input).toContain('white flying-v electric guitar')
        expect(input).toContain('"role":"guitarist"')
        expect(input).toContain('a microphone, a sword, a lantern')
        expect(JSON.stringify(schema)).toContain('"enum":["","drums","bass","other","guitar","piano"]')
    })
})

describe('giveLayers - the repair of a planned project (#1085)', () => {
    const project = () => ({
        cast: {characters: cast.map((c, i) => ({...c, id: c.name.toLowerCase(), ...(i === 1 ? {} : {})}))},
        characterLooks: {kael: 'a look'},
        beats: [{id: 'beat-01'}],
        timeline: {slots: []},
        instrumentStems: {},
        propActivity: {bass: []},
        shotMoments: {'beat-01': {shots: []}},
        shotViews: {'beat-01': 'a view'},
    })

    test('the layer is written, what is built on it goes, the looks and the beats stay', () => {
        const data = project()
        const {given, dropped} = giveLayers(data, [{name: 'Kael'}], [{name: 'Kael', propStem: 'guitar'}])
        expect(given).toEqual([{id: 'kael', name: 'Kael', propStem: 'guitar'}])
        expect(dropped).toEqual(['instrumentStems', 'propActivity', 'shotMoments', 'shotViews'])
        expect(data.cast.characters.find(c => c.id === 'kael')?.propStem).toBe('guitar')
        expect(Object.keys(data).sort()).toEqual(['beats', 'cast', 'characterLooks', 'timeline'])
    })

    test('only what is there is dropped, and nothing when no layer is given', () => {
        const data: Record<string, unknown> & {cast: ReturnType<typeof project>['cast']} = {cast: project().cast, beats: []}
        expect(giveLayers(data, [{name: 'Kael'}], [{name: 'Kael', propStem: 'guitar'}]).dropped).toEqual([])
        const untouched = project()
        expect(giveLayers(untouched, [{name: 'Kael'}], [{name: 'Kael', propStem: ''}])).toEqual({given: [], dropped: []})
        expect(Object.keys(untouched)).toContain('shotMoments')
    })
})
