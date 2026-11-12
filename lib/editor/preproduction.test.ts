import {describe, expect, test} from 'bun:test'
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import type {Project} from '../project.ts'
import type {FilmProject} from '../film/types.ts'
import {filmStage, musicStage, nextStage, parseUntil} from '../stages.ts'
import {
    applyCast,
    applyLook,
    applyStory,
    applyStoryKeepingCast,
    bookView,
    castingRedoOf,
    castView,
    lookView,
    renameInStory,
    writeCast,
} from './preproduction.ts'
import {KEPT_BY_HAND, keepEach} from '../partials.ts'
import {runCommand} from './runs.ts'

const music = {id: 'demo', kind: 'music' as const}
const film = {id: 'demo', kind: 'film' as const}

// a music video planned up to the look: story, cast, singers and the looks are there, no beats yet
const lookStage = (): Project => ({
    story: 'Mara rows out to the lighthouse.',
    summary: 'A rower and a lighthouse.',
    cast: {
        characters: [
            {id: 'mara', name: 'Mara', role: 'the rower', prop: 'a lantern'},
            {
                id: 'ben',
                name: 'Ben',
                role: 'the drummer',
                prop: 'a drum kit',
                propStem: 'drums',
                propCarried: false,
                propPlace: 'deck',
                propInHand: 'drumsticks',
            },
        ],
        locations: [
            {id: 'deck', name: 'The deck'},
            {id: 'tower', name: 'The tower'},
        ],
    },
    instrumentStems: {},
    propActivity: {drums: []},
    singing: {singers: ['mara'], lines: [{line: 0, text: 'row', singers: ['mara']}]},
    lookBrief: 'grainy 16 mm',
    characterLooks: {mara: 'a', ben: 'b'},
    characterDescriptions: {mara: 'a', ben: 'b'},
    locationLooks: {deck: 'd', tower: 't'},
    locationDescriptions: {deck: 'd', tower: 't'},
    locationAnchors: {deck: 'd', tower: 't'},
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
        expect(runCommand(film, {type: 'plan', redo: ['locationViews'], until: 'look'})).toEqual({
            script: 'film.ts',
            args: ['demo', '--redo=locationViews', '--until=look'],
        })
    })

    test('the casting photos: the pictures of a music video planned up to the look, without planning the shots', () => {
        expect(runCommand(music, {type: 'look-pictures'})).toEqual({script: 'index.ts', args: ['demo', '--until=look', '--render=images']})
        expect(runCommand(music, {type: 'pictures', ids: ['mara'], again: true, look: true})).toEqual({
            script: 'index.ts',
            args: ['demo', '--render=images', '--only=mara', '--again', '--until=look'],
        })
        // a film has its pictures from the look on anyway
        expect(runCommand(film, {type: 'pictures', ids: ['hall'], look: true}).args).toEqual(['demo', '--render=images', '--only=hall'])
        expect(() => runCommand(film, {type: 'look-pictures'})).toThrow('a film has its pictures')
    })

    test('only steps of that pipeline and known stages', () => {
        expect(() => runCommand(music, {type: 'plan', redo: ['locationViews']})).toThrow('no such steps')
        expect(() => runCommand(music, {type: 'plan', redo: ['story --render=all']})).toThrow('no such steps')
        expect(() => runCommand(music, {type: 'plan', until: 'plan'})).toThrow('no such stage')
    })

    test('the shots of chosen beats planned again (#762)', () => {
        expect(runCommand(music, {type: 'plan', beats: ['beat-05', 'beat-07']})).toEqual({
            script: 'index.ts',
            args: ['demo', '--redo=shotMoments', '--beats=beat-05,beat-07'],
        })
        expect(runCommand(music, {type: 'plan', redo: ['shotMoments'], beats: ['beat-05']}).args).toEqual(['demo', '--redo=shotMoments', '--beats=beat-05'])
        expect(() => runCommand(music, {type: 'plan', beats: ['beat-05 --render=all']})).toThrow('no such beats')
        expect(() => runCommand(film, {type: 'plan', beats: ['beat-05']})).toThrow('a film plans scenes again')
    })

    test('the shots of chosen scenes of a film planned again (#836)', () => {
        expect(runCommand(film, {type: 'plan', scenes: ['s6', 's7']}).args).toEqual(['demo', '--redo=coverage', '--scenes=s6,s7'])
        expect(runCommand(film, {type: 'plan', redo: ['coverage'], scenes: ['s6']}).args).toEqual(['demo', '--redo=coverage', '--scenes=s6'])
        expect(() => runCommand(film, {type: 'plan', scenes: ['s6 --render=all']})).toThrow('no such scenes')
        expect(() => runCommand(music, {type: 'plan', scenes: ['s6']})).toThrow('a music video plans beats again')
    })

    test("a film's script repaired by a plan run (#836)", () => {
        expect(runCommand(film, {type: 'plan', fixScript: true}).args).toEqual(['demo', '--fix-script'])
        expect(() => runCommand(music, {type: 'plan', fixScript: true})).toThrow('repaired in a film')
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

describe('the cast by hand, saved', () => {
    test('casting.json follows: who left loses the entry, a new role runs as project:', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'cast-saved-'))
        try {
            writeFileSync(join(dir, 'project.json'), JSON.stringify(lookStage()))
            writeFileSync(
                join(dir, 'casting.json'),
                JSON.stringify({characters: {mara: 'library:mara-v2', ben: 'project:ben'}, locations: {deck: 'project:deck', tower: 'project:tower'}}),
            )
            const wanted = change(lookStage())
            wanted.characters = [wanted.characters[0]!, {name: 'Ann', role: 'the keeper'} as (typeof wanted.characters)[number]]
            wanted.locations = [wanted.locations[0]!]
            const result = await writeCast({id: 'demo', dir, kind: 'music'}, wanted)
            expect(result.removed).toEqual(['ben', 'tower'])
            const casting = JSON.parse(readFileSync(join(dir, 'casting.json'), 'utf8'))
            expect(casting).toEqual({
                characters: {mara: 'library:mara-v2', [result.added[0]!]: `project:${result.added[0]}`},
                locations: {deck: 'project:deck'},
            })
        } finally {
            rmSync(dir, {recursive: true, force: true})
        }
    })
})

describe('the cast by hand', () => {
    test('a renamed role keeps its id and what else it had; only its looks are written again, the separated instruments stay', () => {
        const data = lookStage()
        const wanted = change(data)
        wanted.characters[0] = {...wanted.characters[0]!, name: 'Lena', role: "the keeper's daughter"}
        const result = applyCast('music', data, wanted)
        expect(result).toEqual({
            changed: true,
            dropped: ['singing'],
            added: [],
            removed: [],
            renamed: [{from: 'Mara', to: 'Lena'}],
            remade: ['characterLooks: mara', 'characterDescriptions: mara'],
        })
        expect(data.cast!.characters[0]).toEqual({id: 'mara', name: 'Lena', role: "the keeper's daughter", prop: 'a lantern'})
        expect(data.cast!.characters[1]!.propStem).toBe('drums')
        // Ben keeps his look and description - the run takes them as they are and asks only for Mara's
        expect(data.characterLooks).toBeUndefined()
        expect(data.partials!.characterLooks).toEqual({ben: {fingerprint: KEPT_BY_HAND, value: 'b'}})
        expect(data.partials!.characterDescriptions).toEqual({ben: {fingerprint: KEPT_BY_HAND, value: 'b'}})
        // no place changed: the places keep their texts as they are
        expect(data.locationLooks).toEqual({deck: 'd', tower: 't'})
        expect(data.locationLayouts).toBeDefined()
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
        expect(applyCast('music', data, change(data))).toEqual({changed: false, dropped: [], remade: [], added: [], removed: [], renamed: []})
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
            summary: 's',
            characterLooks: {ana: 'x'},
            coverage: [],
            subtitles: {},
        }
        const wanted = {
            characters: [{id: 'ana', name: 'Anna', role: 'r', appearance: 'tall', voice: 'v'}],
            locations: [{id: 'hall', name: 'Hall', description: 'd'}],
        }
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
        const view = bookView('film', {
            screenplay: {
                title: 'T',
                language: 'en',
                scenes: [{id: 's1', setting: 'INT', location: 'HALL', time: 'DAY', elements: [{type: 'action', text: 'Ana waits.'}]}],
            },
        })
        expect(view.editable).toBe(false)
        expect(view.text).toContain('Ana waits.')
        expect(view.scriptNotes).toBeUndefined()
        expect(bookView('music', {}).editable).toBe(false)
        // what the script contradicts itself in, and the repairs made: for the page to offer --fix-script (#836)
        const noted = bookView('film', {scriptNotes: ['Ana is in two places'], scriptFixes: [{scene: 's1', before: 'a', after: 'b'}]})
        expect([noted.scriptNotes, noted.scriptFixes]).toEqual([['Ana is in two places'], 1])
    })
})

describe('an answer kept by hand', () => {
    test('the run takes it whatever it would ask now, and asks for the others', async () => {
        const data = {partials: {characterLooks: {ben: {fingerprint: KEPT_BY_HAND, value: 'kept look'}}}}
        const asked: string[] = []
        const ask = (key: string) =>
            keepEach(
                data,
                async () => {},
                'characterLooks',
                key,
                {prompt: 'anything'},
                async () => {
                    asked.push(key)
                    return `new ${key}`
                },
            )
        expect(await ask('ben')).toBe('kept look')
        expect(await ask('mara')).toBe('new mara')
        expect(asked).toEqual(['mara'])
    })
})

describe('the look by hand', () => {
    // planned up to the shots: a floor plan per beat and the shots are built on the looks
    const planned = (): Project => ({...lookStage(), beats: [], blocking: {}, shotMoments: {}})

    test('what the page shows: the texts of everyone and every place, what goes with them', () => {
        const view = lookView('music', planned())
        expect(view.lookBrief).toBe('grainy 16 mm')
        expect(view.characters.map(c => [c.id, c.look, c.description])).toEqual([
            ['mara', 'a', 'a'],
            ['ben', 'b', 'b'],
        ])
        expect(view.locations[0]).toMatchObject({id: 'deck', look: 'd', description: 'd', anchors: 'd', layout: 'l'})
        expect(view.builtOn).toEqual(['blocking', 'shotMoments'])
        expect(view.briefBuiltOn).toContain('characterLooks')
    })

    test('a changed look: its description is written again for that one only, the others keep theirs, the shot plan goes', () => {
        const data = planned()
        const result = applyLook('music', data, {elements: [{kind: 'character', id: 'mara', look: 'a red coat'}]})
        expect(result).toEqual({changed: true, remade: ['characterDescriptions: mara'], dropped: ['blocking', 'shotMoments']})
        expect(data.characterLooks).toEqual({mara: 'a red coat', ben: 'b'})
        expect(data.characterDescriptions).toBeUndefined()
        expect(data.partials!.characterDescriptions).toEqual({ben: {fingerprint: KEPT_BY_HAND, value: 'b'}})
        expect(data.locationDescriptions).toBeDefined()
    })

    test('a look and its description changed together: both kept as written, nothing written again', () => {
        const data = planned()
        const result = applyLook('music', data, {elements: [{kind: 'character', id: 'mara', look: 'a red coat', description: 'in a red coat'}]})
        expect(result.remade).toEqual([])
        expect(data.characterDescriptions).toEqual({mara: 'in a red coat', ben: 'b'})
    })

    test('a place written anew: its look and everything written from it, for that place only; a floor plan changed by hand keeps its views', () => {
        const data = planned()
        const result = applyLook('music', data, {again: [{kind: 'location', id: 'tower'}], elements: [{kind: 'location', id: 'deck', layout: 'a long deck'}]})
        expect(result.remade).toEqual(['locationLooks: tower', 'locationDescriptions: tower', 'locationAnchors: tower', 'locationLayouts: tower'])
        expect(data.partials!.locationLayouts!.deck).toEqual({fingerprint: KEPT_BY_HAND, value: {layout: 'a long deck', views: []}})
        expect(data.partials!.locationLooks).toEqual({deck: {fingerprint: KEPT_BY_HAND, value: 'd'}})
    })

    test('the look of the whole changed: every look goes; a role played by the library is not changed here', () => {
        const data = planned()
        expect(applyLook('music', data, {lookBrief: 'grainy 16 mm '}).changed).toBe(false)
        const result = applyLook('music', data, {lookBrief: 'clean digital, cold light'})
        expect(result.dropped).toContain('characterLooks')
        expect(data.characterLooks).toBeUndefined()
        const library = {...planned(), castingCopies: {'character:ben': {library: 'ben-v2', fingerprint: 'f'}}}
        expect(() => applyLook('music', library, {elements: [{kind: 'character', id: 'ben', look: 'x'}]})).toThrow('played by library:ben-v2')
        expect(() => applyLook('music', library, {elements: [{kind: 'character', id: 'nobody', look: 'x'}]})).toThrow('no character nobody')
    })
})

describe('the story after the cast', () => {
    test('the new names put in as whole words: the full name and each word of it that changed', () => {
        const story = 'Mara Vey rows out. Vey is tired; Maram waits. Mara waves.'
        expect(renameInStory(story, [{from: 'Mara Vey', to: 'Lena Rook'}])).toBe('Lena Rook rows out. Rook is tired; Maram waits. Lena waves.')
    })

    test('a story told anew for the same cast: the summary and the plan from the beats on go, cast and looks stay', () => {
        const data: Project = {...lookStage(), beats: [], timeline: {} as Project['timeline'], mapping: [], shotMoments: {}}
        const result = applyStoryKeepingCast(data, 'Lena rows out.')
        expect(result.dropped).toEqual(['summary', 'beats', 'mapping', 'shotMoments'])
        expect(data.cast).toBeDefined()
        expect(data.characterLooks).toBeDefined()
        expect(data.timeline).toBeDefined()
        expect(bookView('music', data).keptByCast).toEqual([])
    })
})

describe('the look of a film', () => {
    // two characters, one with another look (wounded); a place with its designed views; the shots of the scenes after them
    const film = (): FilmProject => ({
        cast: {
            characters: [
                {
                    id: 'ana',
                    name: 'Ana',
                    aliases: ['ANA'],
                    role: 'r',
                    appearance: 'a',
                    voice: 'v',
                    states: [{id: 'wounded', name: 'wounded', change: 'a bandaged arm'}],
                },
                {id: 'bo', name: 'Bo', aliases: ['BO'], role: 'r', appearance: 'b', voice: 'v'},
                {id: 'narrator', name: 'Narrator', aliases: [], role: 'r', appearance: '', voice: 'v', voiceOnly: true},
            ],
            locations: [
                {id: 'hall', name: 'Hall', aliases: ['HALL'], description: 'd'},
                {id: 'yard', name: 'Yard', aliases: [], description: 'y'},
            ],
        },
        summary: 's',
        lookBrief: 'grainy',
        characterLooks: {ana: 'ana look', 'ana--wounded': 'ana wounded look', bo: 'bo look'},
        characterDescriptions: {ana: 'ana desc', 'ana--wounded': 'ana wounded desc', bo: 'bo desc'},
        locationLooks: {hall: 'hall look', yard: 'yard look'},
        locationDescriptions: {hall: 'hall desc', yard: 'yard desc'},
        locationViews: {hall: [{name: 'front', shows: 'the door'}], yard: [{name: 'front', shows: 'the gate'}]},
        props: [],
        coverage: [],
    })

    test('what the page shows: every look of a character, never a voice, the places without background or floor plan', () => {
        const view = lookView('film', film())
        expect(view.characters.map(c => [c.id, c.name, c.look, c.description])).toEqual([
            ['ana', 'Ana', 'ana look', 'ana desc'],
            ['ana--wounded', 'Ana (wounded)', 'ana wounded look', 'ana wounded desc'],
            ['bo', 'Bo', 'bo look', 'bo desc'],
        ])
        expect(view.locations[0]).toEqual({
            kind: 'location',
            id: 'hall',
            name: 'Hall',
            library: undefined,
            look: 'hall look',
            description: 'hall desc',
            anchors: undefined,
            layout: undefined,
        })
        expect(view.builtOn).toEqual(['coverage'])
    })

    test('a character written anew: its looks and their descriptions, its other looks too - everyone else is kept', () => {
        const data = film()
        const result = applyLook('film', data, {again: [{kind: 'character', id: 'ana'}]})
        // a film's shots are planned against the descriptions of the cast and the places (#731): a description written anew drops them
        expect(result).toEqual({changed: true, remade: ['characterLooks: ana', 'characterDescriptions: ana'], dropped: ['coverage']})
        expect(data.coverage).toBeUndefined()
        expect(data.partials!.characterLooks).toEqual({bo: {fingerprint: KEPT_BY_HAND, value: 'bo look'}})
        expect(data.partials!.characterDescriptions).toEqual({bo: {fingerprint: KEPT_BY_HAND, value: 'bo desc'}})
        expect(data.locationViews).toBeDefined()
    })

    test("another look of a character changed by hand: its description written again, the character's own look kept", () => {
        const data = film()
        const result = applyLook('film', data, {elements: [{kind: 'character', id: 'ana--wounded', look: 'a bandaged arm and a torn sleeve'}]})
        expect(result.remade).toEqual(['characterDescriptions: ana--wounded'])
        expect(data.characterLooks!['ana--wounded']).toBe('a bandaged arm and a torn sleeve')
        expect(Object.keys(data.partials!.characterDescriptions!)).toEqual(['ana', 'bo'])
    })

    test("a place's look changed: its description and its views written again, the other place keeps both", () => {
        const data = film()
        const result = applyLook('film', data, {elements: [{kind: 'location', id: 'hall', look: 'a hall in candle light'}]})
        expect(result.remade).toEqual(['locationDescriptions: hall', 'locationViews: hall'])
        expect(data.partials!.locationViews).toEqual({yard: {fingerprint: KEPT_BY_HAND, value: [{name: 'front', shows: 'the gate'}]}})
        expect(() => applyLook('film', film(), {elements: [{kind: 'location', id: 'hall', anchors: 'x'}]})).toThrow('Hall has no anchors to change')
    })
})

describe('the look given back whole (bun run look --set)', () => {
    test('texts with line breaks given back as they were change nothing; a changed one is kept with its paragraphs', () => {
        const data: Project = {
            ...lookStage(),
            lookBrief: 'grainy 16 mm.\n\nCold light.',
            locationLayouts: {deck: {layout: 'a long deck\nwith a rail', views: []}, tower: {layout: 'l', views: []}},
        }
        const whole = {
            lookBrief: 'grainy 16 mm.\r\n\r\nCold light.',
            elements: [{kind: 'location' as const, id: 'deck', layout: 'a long deck\r\nwith a rail', look: 'd'}],
        }
        expect(applyLook('music', data, whole)).toEqual({changed: false, dropped: [], remade: []})
        expect(applyLook('music', data, {lookBrief: 'grainy 16 mm.\n\nWarm light.'}).changed).toBe(true)
        expect(data.lookBrief).toBe('grainy 16 mm.\n\nWarm light.')
    })

    test('a role played by the library given back unchanged is no change', () => {
        const data = {...lookStage(), castingCopies: {'character:ben': {library: 'ben-v2', fingerprint: 'f'}}}
        expect(applyLook('music', data, {elements: [{kind: 'character', id: 'ben', look: 'b', description: 'b'}]}).changed).toBe(false)
    })
})
