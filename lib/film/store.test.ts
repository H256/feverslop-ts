import {expect, test} from "bun:test";
import {filmStepProblem} from "./store.ts";

test('cached film screenplay rejects malformed dialogue before a later prompt crashes', () => {
    expect(filmStepProblem('screenplay', {title: 'A', language: 'en', scenes: [{id: 's1', setting: 'INT', location: 'Room', time: 'DAY', elements: [{type: 'dialogue', speaker: 'Mara', kind: 'spoken'}]}]})).toContain('screenplay.scenes[0].elements[0].text/type')
})

test('cached film coverage rejects malformed shots with a precise path', () => {
    expect(filmStepProblem('coverage', [{sceneId: 's1', soundscape: 'rain', shots: [{framing: 'close', camera: 'static', action: 'Mara speaks', characters: ['mara'], lines: [], seconds: 3}]}])).toBeUndefined()
    expect(filmStepProblem('coverage', [{sceneId: 's1', soundscape: 'rain', shots: [{framing: 'close', camera: 'static', action: 'Mara speaks', characters: ['mara'], lines: ['bad'], seconds: 3}]}])).toContain('coverage[0].shots[0]')
})

test('cached simple steps require their documented value shape', () => {
    expect(filmStepProblem('summary', {text: 'summary'})).toContain('a string')
    expect(filmStepProblem('scriptNotes', ['ok', 2])).toContain('an array of strings')
})
