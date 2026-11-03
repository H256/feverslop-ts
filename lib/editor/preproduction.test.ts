import {describe, expect, test} from "bun:test";
import type {Project} from "../project.ts";
import type {FilmProject} from "../film/types.ts";
import {filmStage, musicStage, nextStage, parseUntil} from "../stages.ts";
import {applyCast, applyStory, bookView, castingRedoOf, castView} from "./preproduction.ts";
import {runCommand} from "./runs.ts";

const music = {id: 'demo', kind: 'music' as const}
const film = {id: 'demo', kind: 'film' as const}

// a music video planned up to the look: story, cast, singers and the looks are there, no beats yet
const lookStage = (): Project => ({
    story: 'Mara rows out to the lighthouse.', summary: 'A rower and a lighthouse.',
    cast: {
        characters: [
            {id: 'mara', name: 'Mara', role: 'the rower', prop: 'a lantern'},
            {id: 'ben', name: 'Ben', role: 'the drummer', prop: 'a drum kit', propStem: 'drums', propCarried: false, propPlace: 'deck', propInHand: 'drumsticks'},
        ],
        locations: [{id: 'deck', name: 'The deck'}, {id: 'tower', name: 'The tower'}],
    },
    instrumentStems: {}, propActivity: {drums: []},
    singing: {singers: ['mara'], lines: [{line: 0, text: 'row', singers: ['mara']}]},
    lookBrief: 'grainy 16 mm',
    characterLooks: {mara: 'a', ben: 'b'}, characterDescriptions: {mara: 'a', ben: 'b'},
    locationLooks: {deck: 'd', tower: 't'}, locationDescriptions: {deck: 'd', tower: 't'}, locationAnchors: {deck: 'd', tower: 't'},
    locationLayouts: {deck: {layout: 'l', views: []}, tower: {layout: 'l', views: []}},
    partials: {characterLooks: {mara: {fingerprint: 'x', value: 'a'}}},
})
const change = (data: Project) => ({
    characters: data.cast!.characters.map(c => ({id: c.id, name: c.name, role: c.role, prop: c.prop})),
    locations: data.cast!.locations.map(l => ({id: l.id, name: l.name})),
})

describe('the stages of the plan', () => {
    test('a music video: the last stage it has, and the one after it', () => {
        expect(musicStage({})).toBeUndefined()
        expect(musicStage({story: 's'})).toBe('story')
        expect(musicStage({story: 's', cast: {characters: [], locations: []}})).toBe('cast')
        expect(musicStage(lookStage())).toBe('look')
        // a plan made with --legacy-moments has no shots of its own: its beats on the clips are the plan
        expect(musicStage({...lookStage(), mapping: []})).toBe('plan')
        expect([undefined, 'story', 'cast', 'look', 'plan'].map(s => nextStage(s as never))).toEqual(['story', 'cast', 'look', 'plan', undefined])
    })

    test('a film: the screenplay is its book, the props end its look', () => {
        expect(filmStage({screenplay: {title: 't', language: 'en', scenes: []}})).toBe('story')
        expect(filmStage({screenplay: {title: 't', language: 'en', scenes: []}, cast: {characters: [], locations: []}, props: []})).toBe('look')
        expect(filmStage({coverage: []})).toBe('plan')
    })

    test('--until takes a stage before the shots, nothing else', () => {
        expect(parseUntil('')).toBeUndefined()
        expect(parseUntil('cast')).toBe('cast')
        expect(() => parseUntil('plan')).toThrow('--until: unknown "plan"')
    })
})

describe('a plan run from the page', () => {
    test('up to a stage, with the steps a change asks to plan again', () => {
        expect(runCommand(music, {type: 'plan'})).toEqual({script: 'index.ts', args: ['demo']})
        expect(runCommand(music, {type: 'plan', until: 'cast'})).toEqual({script: 'index.ts', args: ['demo', '--until=cast']})
        expect(runCommand(film, {type: 'plan', redo: ['locationViews'], until: 'look'})).toEqual({script: 'film.ts', args: ['demo', '--redo=locationViews', '--until=look']})
    })

    test('the casting photos: the pictures of a music video planned up to the look, without planning the shots', () => {
        expect(runCommand(music, {type: 'look-pictures'})).toEqual({script: 'index.ts', args: ['demo', '--until=look', '--render=images']})
        expect(runCommand(music, {type: 'pictures', ids: ['mara'], again: true, look: true})).toEqual({script: 'index.ts', args: ['demo', '--render=images', '--only=mara', '--again', '--until=look']})
        // a film has its pictures from the look on anyway
        expect(runCommand(film, {type: 'pictures', ids: ['hall'], look: true}).args).toEqual(['demo', '--render=images', '--only=hall'])
        expect(() => runCommand(film, {type: 'look-pictures'})).toThrow('a film has its pictures')
    })

    test('only steps of that pipeline and known stages', () => {
        expect(() => runCommand(music, {type: 'plan', redo: ['locationViews']})).toThrow('no such steps')
        expect(() => runCommand(music, {type: 'plan', redo: ['story --render=all']})).toThrow('no such steps')
        expect(() => runCommand(music, {type: 'plan', until: 'plan'})).toThrow('no such stage')
    })
})

describe('casting.json changed after the plan - what Plan now plans again', () => {
    const entry = {kind: 'character' as const, id: 'mara', libraryId: 'mara-v2'}
    test('a role the library plays now: what was planned from the old looks, not the looks themselves', () => {
        const data = {...lookStage(), beats: [], timeline: {} as Project['timeline'], mapping: [], blocking: {}, shotMoments: {}}
        expect(castingRedoOf('music', data, [entry], () => 'f1')).toEqual({changes: ['mara is played by library:mara-v2'], redo: ['blocking']})
    })

    test('nothing new in casting.json, or nothing planned from it yet: no --redo', () => {
        const data = {...lookStage(), castingCopies: {'character:mara': {library: 'mara-v2', fingerprint: 'f1'}}}
        expect(castingRedoOf('music', data, [entry], () => 'f1')).toEqual({changes: [], redo: []})
        // the asset changed in the library since it was copied
        expect(castingRedoOf('music', data, [entry], () => 'f2').changes).toEqual(['mara is played by library:mara-v2'])
        // planned up to the look: nothing reads the looks yet
        expect(castingRedoOf('music', lookStage(), [entry], () => 'f1').redo).toEqual([])
    })

    test('a role back to its own: its look is made anew, and everything after it', () => {
        const data = {...lookStage(), castingCopies: {'location:deck': {library: 'old-deck', fingerprint: 'f'}}}
        expect(castingRedoOf('music', data, [], () => 'f')).toEqual({changes: ['deck is made by the project again'], redo: ['locationLooks']})
    })

    test('a film: the views of the places are planned from the place looks', () => {
        const data: FilmProject = {locationLooks: {}, locationViews: {}, coverage: []}
        expect(castingRedoOf('film', data, [{kind: 'location', id: 'hall', libraryId: 'hall'}], () => 'f').redo).toEqual(['locationViews'])
    })
})

describe('the cast by hand', () => {
    test('a renamed role keeps its id and what else it had; what is built on the cast goes, the separated instruments stay', () => {
        const data = lookStage()
        const wanted = change(data)
        wanted.characters[0] = {...wanted.characters[0]!, name: 'Lena', role: 'the keeper\'s daughter'}
        const result = applyCast('music', data, wanted)
        expect(result).toEqual({changed: true, dropped: ['singing', 'characterLooks', 'locationLooks', 'characterDescriptions', 'locationDescriptions', 'locationAnchors', 'locationLayouts'], added: [], removed: []})
        expect(data.cast!.characters[0]).toEqual({id: 'mara', name: 'Lena', role: 'the keeper\'s daughter', prop: 'a lantern'})
        expect(data.cast!.characters[1]!.propStem).toBe('drums')
        expect(data.characterLooks).toBeUndefined()
        expect(data.partials).toBeUndefined()
        expect(data.lookBrief).toBe('grainy 16 mm')
        expect(data.instrumentStems).toBeDefined()
        expect(data.story).toBe('Mara rows out to the lighthouse.')
    })

    test('someone new, someone gone, a place gone: new ids, and a prop that stood in the place is carried', () => {
        const data = lookStage()
        const wanted = change(data)
        wanted.characters = [wanted.characters[1]!, {name: 'Old Keeper', role: 'keeps the light'} as never]
        wanted.locations = [wanted.locations[1]!, {name: 'The tower'} as never]
        const result = applyCast('music', data, wanted)
        expect(result.added).toEqual(['old-keeper', 'the-tower'])
        expect(result.removed).toEqual(['mara', 'deck'])
        expect(data.cast!.characters[0]).toEqual({id: 'ben', name: 'Ben', role: 'the drummer', prop: 'a drum kit', propStem: 'drums'})
        expect(data.cast!.characters[1]).toEqual({id: 'old-keeper', name: 'Old Keeper', role: 'keeps the light'})
    })

    test('a prop taken away takes the instrument with it: the stems are separated again', () => {
        const data = lookStage()
        const wanted = change(data)
        wanted.characters[1] = {...wanted.characters[1]!, prop: ''}
        const result = applyCast('music', data, wanted)
        expect(data.cast!.characters[1]).toEqual({id: 'ben', name: 'Ben', role: 'the drummer'})
        expect(result.dropped).toContain('instrumentStems')
        expect(result.dropped).toContain('propActivity')
    })

    test('the same cast changes nothing; a cast without a place, a name or a role is refused', () => {
        const data = lookStage()
        expect(applyCast('music', data, change(data))).toEqual({changed: false, dropped: [], added: [], removed: []})
        expect(data.characterLooks).toBeDefined()
        expect(() => applyCast('music', data, {...change(data), locations: []})).toThrow('at least one place')
        expect(() => applyCast('music', data, {...change(data), characters: [{name: ' ', role: 'x'}]})).toThrow('the name of character 1 is empty')
        expect(() => applyCast('music', data, {...change(data), characters: [{id: 'nobody', name: 'X', role: 'x'}]})).toThrow('no character nobody')
    })

    test('a film: names and texts change, nobody comes or goes, a new name is one the script may use', () => {
        const data: FilmProject = {
            cast: {
                characters: [{id: 'ana', name: 'Ana', aliases: ['ANA'], role: 'r', appearance: 'a', voice: 'v'}],
                locations: [{id: 'hall', name: 'Hall', aliases: ['HALL'], description: 'd'}],
            },
            summary: 's', characterLooks: {ana: 'x'}, coverage: [], subtitles: {},
        }
        const wanted = {characters: [{id: 'ana', name: 'Anna', role: 'r', appearance: 'tall', voice: 'v'}], locations: [{id: 'hall', name: 'Hall', description: 'd'}]}
        const result = applyCast('film', data, wanted)
        expect(result.dropped).toEqual(['summary', 'characterLooks', 'coverage'])
        expect(data.cast!.characters[0]!.aliases).toEqual(['ANA', 'Anna'])
        expect(data.subtitles).toBeDefined()
        expect(() => applyCast('film', data, {...wanted, characters: []})).toThrow('the script says who is in a film')
    })

    test('what the page shows: a music video can grow, a film cannot', () => {
        expect(castView('music', lookStage())!.canAdd).toBe(true)
        expect(castView('music', lookStage())!.builtOn).not.toContain('instrumentStems')
        expect(castView('film', {cast: {characters: [], locations: []}})!.canAdd).toBe(false)
        expect(castView('music', {})).toBeUndefined()
    })
})

describe('the story by hand', () => {
    test('a changed story: everything built on it goes, the song analysis stays', () => {
        const data = {...lookStage(), music: {} as Project['music']}
        const result = applyStory(data, 'Lena rows out.\r\n')
        expect(result.changed).toBe(true)
        expect(result.dropped[0]).toBe('instrumentStems')
        expect(result.dropped).toContain('summary')
        expect(result.dropped).toContain('cast')
        expect(data.story).toBe('Lena rows out.')
        expect(data.cast).toBeUndefined()
        expect(data.music).toBeDefined()
        expect(applyStory(data, ' Lena rows out. ').changed).toBe(false)
        expect(() => applyStory(data, '  ')).toThrow('the story is empty')
    })

    test('a film shows its screenplay as a script reads, and does not change it here', () => {
        const view = bookView('film', {screenplay: {title: 'T', language: 'en', scenes: [{id: 's1', setting: 'INT', location: 'HALL', time: 'DAY', elements: [{type: 'action', text: 'Ana waits.'}]}]}})
        expect(view.editable).toBe(false)
        expect(view.text).toContain('Ana waits.')
        expect(bookView('music', {}).editable).toBe(false)
    })
})
