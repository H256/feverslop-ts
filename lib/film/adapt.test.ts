import {describe, expect, test} from "bun:test";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {FilmProject, Screenplay} from "./types.ts";
import {adaptProblems, adaptRefusal, castWith, checkRoleChange, droppedByProposal, parseAddedRole, readAdaptAnswer, type ScreenplayProposal, screenplayFingerprint} from "./adapt.ts";
import {applyScreenplayProposal, bookView, castView, readBook, SCREENPLAY_PROPOSAL, writeScreenplayProposal} from "../editor/preproduction.ts";
import {KEPT_BY_HAND} from "../partials.ts";
import {runCommand} from "../editor/runs.ts";
import {writeJsonFile} from "../json-file.ts";

// a film of the pipeline's own (idea mode), planned up to the shots: Ana and Bo in the hall, then in the yard
const play = (lines: [string, string][][]): Screenplay => ({
    title: 'T', language: 'en',
    scenes: lines.map((scene, n) => ({
        id: `s${n + 1}`, setting: 'INT', location: n ? 'YARD' : 'HALL', time: 'NIGHT',
        elements: [{type: 'action', text: 'Wind.'}, ...scene.map(([speaker, text]) => ({type: 'dialogue' as const, speaker, text, kind: 'spoken' as const}))],
    })),
})
const film = (): FilmProject => ({
    brief: {mode: 'idea', title: 'T', language: 'en', logline: 'l', genre: 'g', tone: 't', setting: 's'},
    outline: {characters: [{name: 'Ana', role: 'r', appearance: 'a', voice: 'v'}, {name: 'Bo', role: 'r', appearance: 'b', voice: 'v'}], scenes: [{heading: 'INT. HALL - NIGHT', characters: ['Ana', 'Bo'], summary: 's', purpose: 'p', seconds: 20}]},
    screenplay: play([[['ANA', 'Is it late?'], ['BO', 'Very.']], [['ANA', 'Come.']]]),
    cast: {
        characters: [
            {id: 'ana', name: 'Ana', aliases: ['Ana', 'ANA'], role: 'r', appearance: 'a', voice: 'v', states: [{id: 'wet', name: 'wet', change: 'soaked', from: 2}]},
            {id: 'bo', name: 'Bo', aliases: ['Bo', 'BO'], role: 'r', appearance: 'b', voice: 'v'},
        ],
        locations: [{id: 'hall', name: 'Hall', aliases: ['HALL'], description: 'd'}, {id: 'yard', name: 'Yard', aliases: ['YARD'], description: 'y'}],
    },
    summary: 's', lookBrief: 'grainy', scriptNotes: [], scriptFixes: [],
    characterLooks: {'ana': 'ana look', 'ana--wet': 'ana wet look', 'bo': 'bo look'},
    characterDescriptions: {'ana': 'ana desc', 'ana--wet': 'ana wet desc', 'bo': 'bo desc'},
    locationLooks: {hall: 'h', yard: 'y'}, locationDescriptions: {hall: 'h', yard: 'y'},
    locationViews: {hall: [{name: 'front', shows: 'the door'}]},
    props: [], coverage: [], subtitles: {},
    castingCopies: {'character:bo': {library: 'bo-lib', fingerprint: 'f'}},
})
const kai = {name: 'Kai', role: 'the night porter'}

describe('a film\'s role added or taken out (#589)', () => {
    test('a script of the user\'s own is never told anew: changed there, planned again', () => {
        expect(adaptRefusal(film())).toBeUndefined()
        expect(adaptRefusal({...film(), brief: {...film().brief!, mode: 'screenplay'}})).toContain('the screenplay is yours (input/screenplay.txt)')
        expect(adaptRefusal({brief: film().brief})).toContain('plan up to the cast first')
        const view = castView('film', {...film(), brief: {...film().brief!, mode: 'screenplay'}})!
        expect(view.canAdd).toBe(false)
        expect(view.adapt!.refused).toContain('add or take out the role in that script')
    })

    test('the change: "Name: role", someone of the cast to take out, nobody twice', () => {
        expect(parseAddedRole(' Kai :  the night  porter ')).toEqual(kai)
        expect(parseAddedRole('Kai')).toContain('--add takes "Name: who they are in the story"')
        const cast = film().cast!
        expect(checkRoleChange(cast, {add: [kai], remove: ['bo']})).toBeUndefined()
        expect(checkRoleChange(cast, {add: [], remove: []})).toContain('nothing to change')
        expect(checkRoleChange(cast, {add: [], remove: ['cleo']})).toContain('no character cleo')
        expect(checkRoleChange(cast, {add: [{name: 'ANA', role: 'r'}], remove: []})).toBe('ANA is in the cast already')
        expect(checkRoleChange(cast, {add: [kai, kai], remove: []})).toBe('a new name is given twice')
        expect(checkRoleChange(cast, {add: [], remove: ['ana', 'bo']})).toBe('nobody would be left on screen')
    })

    test('a screenplay told anew is checked: same scenes and places, nobody gone speaks or is named, who is new is in it', () => {
        const before = film().screenplay!, cast = film().cast!
        const good = play([[['ANA', 'Is it late?'], ['KAI', 'Very.']], [['ANA', 'Come.']]])
        expect(adaptProblems(before, good, cast, {added: [kai], removed: ['bo']})).toEqual([])
        const wrong = play([[['BO', 'Very.'], ['CLEO', 'Hm.']]])
        wrong.scenes[0]!.location = 'CELLAR'
        expect(adaptProblems(before, wrong, cast, {added: [kai], removed: ['bo']})).toEqual([
            'the screenplay has 1 scenes instead of 2 - keep every scene',
            'scene 1 is at "CELLAR", a place the film does not have',
            '"BO" speaks, but Bo leaves the film',
            '"CLEO" speaks, but is nobody of the cast - a new character\'s cue is their name',
            'Kai is in no scene - give them a part',
            '"Bo" is still in the screenplay, but Bo leaves the film',
        ])
    })

    test('the answer read: the screenplay, and the new characters with a look and a voice', () => {
        const raw = {characters: [{name: 'kai', appearance: 'tall, grey coat', voice: 'a low voice'}], scenes: [{setting: 'INT', location: 'HALL', time: 'NIGHT', elements: [{type: 'dialogue', speaker: 'KAI', text: 'Hm.'}]}]}
        const answer = readAdaptAnswer(raw, {title: 'T', language: 'en'}, [kai])
        expect(answer.characters).toEqual([{name: 'Kai', role: 'the night porter', appearance: 'tall, grey coat', voice: 'a low voice'}])
        expect(answer.screenplay.scenes[0]!.elements[0]).toMatchObject({speaker: 'KAI', text: 'Hm.', kind: 'spoken'})
        expect(() => readAdaptAnswer({...raw, characters: []}, {title: 'T', language: 'en'}, [kai])).toThrow('no appearance or voice of Kai')
    })

    test('the cast with the proposal: who stays keeps the id and everything, who is new gets one', () => {
        const {cast, added} = castWith(film().cast!, {added: [{...kai, appearance: 'tall', voice: 'low'}, {name: 'Ana', role: 'another Ana', appearance: 'x', voice: 'y'}], removed: ['ana']})
        expect(added).toEqual(['kai', 'ana-2'])
        expect(cast.characters.map(c => c.id)).toEqual(['bo', 'kai', 'ana-2'])
        expect(cast.characters[0]).toEqual(film().cast!.characters[1]!)
        expect(cast.characters[1]).toEqual({id: 'kai', name: 'Kai', aliases: ['Kai'], role: 'the night porter', appearance: 'tall', voice: 'low'})
    })

    test('taken: the screenplay and cast are new, the looks of who stays and the places stay, what is read from the script goes', () => {
        const data = film()
        const proposal: ScreenplayProposal = {screenplay: play([[['ANA', 'Late?'], ['KAI', 'Very.']], [['ANA', 'Come.']]]), added: [{...kai, appearance: 'tall', voice: 'low'}], removed: ['bo'], for: screenplayFingerprint(data)}
        expect(bookView('film', data).keptByCast).toEqual(['summary', 'props', 'coverage', 'scriptNotes', 'scriptFixes', 'subtitles'])
        const result = applyScreenplayProposal(data, proposal)
        expect(result).toEqual({changed: true, dropped: ['summary', 'props', 'coverage', 'scriptNotes', 'scriptFixes', 'subtitles'], remade: ['characterLooks: kai', 'characterDescriptions: kai'], added: ['kai'], removed: ['bo']})
        expect(data.screenplay).toEqual(proposal.screenplay)
        expect(data.cast!.characters.map(c => c.id)).toEqual(['ana', 'kai'])
        for (const step of ['summary', 'props', 'coverage', 'scriptNotes', 'scriptFixes', 'subtitles', 'characterLooks', 'characterDescriptions'] as const) expect(data[step]).toBeUndefined()
        // Ana's looks (her wet one too) are kept by hand for the next run, Bo's are gone; the look of the film and the places stay
        expect(data.partials!.characterLooks).toEqual({'ana': {fingerprint: KEPT_BY_HAND, value: 'ana look'}, 'ana--wet': {fingerprint: KEPT_BY_HAND, value: 'ana wet look'}})
        expect(Object.keys(data.partials!.characterDescriptions!)).toEqual(['ana', 'ana--wet'])
        expect([data.lookBrief, data.locationLooks, data.locationViews]).toEqual([film().lookBrief, film().locationLooks, film().locationViews])
        // the idea's outline has the cast as it is now - a --redo=screenplay writes it for them; Bo's library copy is gone
        expect(data.outline!.characters.map(c => c.name)).toEqual(['Ana', 'Kai'])
        expect(data.outline!.scenes[0]!.characters).toEqual(['Ana'])
        expect(data.castingCopies).toBeUndefined()
        expect(droppedByProposal(data)).toEqual([])
    })

    test('from the terminal and the page alike: the proposal next to the screenplay, written for this screenplay only', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'film-adapt-'))
        try {
            const target = {id: 'demo', kind: 'film' as const, dir}
            writeJsonFile(join(dir, 'project.json'), film())
            const answers = [
                // first an answer that keeps Bo in, then one that is right: asked again with what was wrong
                {characters: [{name: 'Kai', appearance: 'tall', voice: 'low'}], scenes: play([[['BO', 'Very.'], ['KAI', 'Hm.']], [['ANA', 'Come.']]]).scenes},
                {characters: [{name: 'Kai', appearance: 'tall', voice: 'low'}], scenes: play([[['ANA', 'Late?'], ['KAI', 'Very.']], [['ANA', 'Come.']]]).scenes},
            ]
            const asked: string[] = []
            const told: string[][] = []
            const proposal = await writeScreenplayProposal(target, {add: [kai], remove: ['bo']}, async options => { asked.push(options.input); return answers.shift() }, problems => told.push(problems))
            expect(told).toEqual([['"BO" speaks, but Bo leaves the film', '"Bo" is still in the screenplay, but Bo leaves the film']])
            expect(asked[1]).toContain('"BO" speaks, but Bo leaves the film')
            expect(asked[0]).toContain('Characters who leave the film')
            expect(proposal.added.map(c => c.name)).toEqual(['Kai'])
            const book = readBook(target)
            expect(book.proposal).toContain('KAI')
            expect(book.proposalCast).toEqual({added: ['Kai'], removed: ['Bo']})
            // another screenplay now: the proposal was not written for it
            writeJsonFile(join(dir, 'project.json'), {...film(), screenplay: play([[['ANA', 'Other.']], [['BO', 'Lines.']]])})
            expect(readBook(target).proposal).toBeUndefined()
            expect(SCREENPLAY_PROPOSAL).toBe(join('output', 'screenplay-proposal.json'))
        } finally {
            rmSync(dir, {recursive: true, force: true})
        }
    })

    test('the page starts the command, with every role one argument', () => {
        const film = {id: 'demo', kind: 'film' as const}
        expect(runCommand(film, {type: 'adapt-story', add: [kai], remove: ['bo']})).toEqual({script: 'tools/story.ts', args: ['demo', '--film', '--adapt', '--add=Kai: the night porter', '--remove=bo']})
        expect(() => runCommand(film, {type: 'adapt-story'})).toThrow('no role to add or take out')
        expect(() => runCommand(film, {type: 'adapt-story', add: [{name: 'Kai: x', role: 'r'}]})).toThrow('a role added has a name')
        expect(() => runCommand(film, {type: 'adapt-story', remove: ['../x']})).toThrow('no such characters')
        expect(runCommand({id: 'demo', kind: 'music'}, {type: 'adapt-story'})).toEqual({script: 'tools/story.ts', args: ['demo', '--adapt']})
    })
})
