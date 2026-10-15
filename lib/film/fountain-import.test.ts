import {describe, expect, test} from "bun:test";
import {applyAnnotations, parseFountain} from "./fountain-import.ts";
import {screenplayToFountain} from "./fountain.ts";
import type {Screenplay} from "./types.ts";

const play: Screenplay = {
    title: 'The Bridge', language: 'en',
    scenes: [
        {id: 's1', setting: 'EXT', location: 'The Bridge', time: 'NIGHT', elements: [
            {type: 'action', text: 'Rain on the bridge. Anna waits.'},
            {type: 'dialogue', speaker: 'Anna', text: 'You came.', kind: 'spoken', delivery: 'quietly'},
            {type: 'dialogue', speaker: 'Ben', text: 'I said I would.', kind: 'spoken'},
            {type: 'dialogue', speaker: 'Narrator', text: 'Nobody knew.', kind: 'voiceover'},
            {type: 'dialogue', speaker: 'Ben', text: 'Come on.', kind: 'offscreen'},
        ]},
        {id: 's2', setting: 'INT', location: 'The Hut', time: 'DAY', elements: [
            {type: 'action', text: 'Anna lights a candle.'},
            {type: 'dialogue', speaker: 'Anna', text: 'Tu en avais une.', kind: 'spoken'},
        ]},
    ],
}

describe('parseFountain', () => {
    test('what screenplayToFountain writes is read back: scenes, order, speakers, words and kinds', () => {
        const parsed = parseFountain(screenplayToFountain(play))!
        expect(parsed.title).toBe('The Bridge')
        expect(parsed.language).toBe('en')
        expect(parsed.scenes.map(s => [s.setting, s.location.toLowerCase(), s.time.toLowerCase()])).toEqual([['EXT', 'the bridge', 'night'], ['INT', 'the hut', 'day']])
        const lines = parsed.scenes.flatMap(s => s.elements.flatMap(e => e.type === 'dialogue' ? [[e.speaker.toLowerCase(), e.text, e.kind, e.delivery]] : []))
        expect(lines).toEqual([
            ['anna', 'You came.', 'spoken', 'quietly'],
            ['ben', 'I said I would.', 'spoken', undefined],
            ['narrator', 'Nobody knew.', 'voiceover', undefined],
            ['ben', 'Come on.', 'offscreen', undefined],
            ['anna', 'Tu en avais une.', 'spoken', undefined],
        ])
        expect(parsed.scenes[0]!.elements[0]).toEqual({type: 'action', text: 'Rain on the bridge. Anna waits.'})
    })
    test('a cue with no letter case is forced with @, as the writer does', () => {
        const parsed = parseFountain('INT. HUT - DAY\n\n@安娜\n你来了。\n')!
        expect(parsed.scenes[0]!.elements[0]).toMatchObject({type: 'dialogue', speaker: '安娜', text: '你来了。'})
    })
    test('transitions, notes, boneyard and sections are left out, a wrapped dialogue is one line, (CONT\'D) is not part of the name', () => {
        const parsed = parseFountain('# Act one\n\nINT. HUT - DAY\n\nAnna enters. [[a note]]\n\nCUT TO:\n\n/* gone */\n\nANNA (CONT\'D)\n(whispering)\nIt is\nlate.\n\n> FADE OUT.\n')!
        expect(parsed.scenes[0]!.elements).toEqual([
            {type: 'action', text: 'Anna enters.'},
            {type: 'dialogue', speaker: 'ANNA', text: 'It is late.', kind: 'spoken', delivery: 'whispering'},
        ])
    })
    test('a parenthetical after the words is the translation the script gives of the line', () => {
        const parsed = parseFountain('INT. HUT - DAY\n\nANNA\nTu en avais une.\n(You had one.)\n')!
        expect(parsed.scenes[0]!.elements[0]).toMatchObject({text: 'Tu en avais une.', translation: 'You had one.'})
    })
    test('I/E and a forced heading', () => {
        const parsed = parseFountain('I/E. CAR - DUSK\n\nANNA\nGo.\n\n.THE FIELD - DAWN\n\nBEN\nHere.\n')!
        expect(parsed.scenes.map(s => [s.setting, s.location, s.time])).toEqual([['INT/EXT', 'CAR', 'DUSK'], ['INT', 'THE FIELD', 'DAWN']])
    })
    test('what code cannot read safely is left to the model: free text, dual dialogue, text before the first heading', () => {
        expect(parseFountain('Anna says hello to Ben and they leave.')).toBeUndefined()
        expect(parseFountain('INT. HUT - DAY\n\nANNA ^\nHello.\n\nBEN\nHi.\n')).toBeUndefined()
        expect(parseFountain('Some opening words.\n\nINT. HUT - DAY\n\nANNA\nHello.\n')).toBeUndefined()
        expect(parseFountain('INT. HUT - DAY\n\nAnna sits.\n')).toBeUndefined()
    })
})

describe('applyAnnotations', () => {
    const parsed = parseFountain('INT. HÜTTE - NACHT\n\nAnna tritt ein.\n\nANNA\n(flüsternd)\nKomm.\n\nBEN\nOui.\n')!
    test('place, time, actions and the language and delivery of a line are taken, the words are not', () => {
        const out = applyAnnotations(parsed, {scenes: [{location: 'The Hut', time: 'NIGHT', actions: ['Anna steps in.'], lines: [{language: 'DE', delivery: 'whispering', text: 'changed'}, {language: 'fr'}]}]})
        expect(out.scenes[0]).toMatchObject({location: 'The Hut', time: 'NIGHT'})
        expect(out.scenes[0]!.elements).toEqual([
            {type: 'action', text: 'Anna steps in.'},
            {type: 'dialogue', speaker: 'ANNA', text: 'Komm.', kind: 'spoken', delivery: 'whispering', language: 'de'},
            {type: 'dialogue', speaker: 'BEN', text: 'Oui.', kind: 'spoken', language: 'fr'},
        ])
    })
    test('lists that do not match the scene are not used - the scene stays as it was read', () => {
        const out = applyAnnotations(parsed, {scenes: [{location: 'The Hut', actions: [], lines: [{language: 'de'}]}]})
        expect(out.scenes[0]!.location).toBe('The Hut')
        expect(out.scenes[0]!.elements).toEqual(parsed.scenes[0]!.elements)
    })
    test('an unusable answer changes nothing', () => {
        expect(applyAnnotations(parsed, undefined)).toEqual(parsed)
        expect(applyAnnotations(parsed, 'nope')).toEqual(parsed)
    })
})
