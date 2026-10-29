import {describe, expect, test} from "bun:test";
import type {StoryBeat} from "./project.ts";
import {beatsPrompt, blockingPrompt, musicStretches, type PlanContext, plannerCalls, planPrompt} from "./shot-planner.ts";

const beat = {id: 'beat-01', order: 1, summary: 'Runa walks in.', moments: ['Runa walks in.'], locationId: 'hall', characterIds: ['runa'], intensity: 0.5, weight: 1, kind: 'build', stateAfter: []} as StoryBeat
const context: PlanContext = {
    characters: [{id: 'runa', name: 'Runa', role: 'a girl'}],
    locations: [{id: 'hall', name: 'Hall'}],
    characterDescriptions: {runa: 'A girl in a red coat.'},
    locationDescriptions: {hall: 'A long stone hall with one door on the left.'},
    continuity: 'never',
    slots: [{id: 'slot-001', index: 0, section: 'A', start: 0, end: 8, bars: 4, energy: 0.8, lyrics: []}],
    mapping: [{slotId: 'slot-001', beatId: 'beat-01'}],
    shotCounts: {'beat-01': 6},
    beatSinging: {},
}

describe('the shot planner prompt', () => {
    test('the instructions are the same for every call - which shots and the problems are at the end of the input', () => {
        const first = planPrompt(context, [beat], undefined, undefined, [], {from: 0, to: 4, total: 6, written: []})
        const second = planPrompt(context, [beat], undefined, undefined, ['shot 5: "Bob" is not one of the characters'], {from: 4, to: 6, total: 6, written: [{action: 'x'}], staging: 'A hall.'})
        expect(second.instructions).toBe(first.instructions)
        expect(first.input).toContain('This call writes ONLY shots 1 to 4 of the 6')
        expect(first.input).toContain('Write the STAGING line first.')
        expect(first.input).toContain('no ENDS block')
        expect(second.input).toContain('end with the ENDS block')
        expect(second.input).toEndWith('- shot 5: "Bob" is not one of the characters')
    })
})

describe('asked again: only the calls whose shots have a problem', () => {
    test('the first time every call is asked', () => {
        expect(plannerCalls(10, 4).map(c => [c.from, c.to, c.keep])).toEqual([[0, 4, false], [4, 8, false], [8, 10, false]])
    })
    test('a problem in shot 6 asks the second call again, with only its problem', () => {
        const calls = plannerCalls(10, 4, {issues: [{shot: 5, message: 'shot 6: "Bob" is not one of the characters'}], previousShots: 10})
        expect(calls.map(c => c.keep)).toEqual([true, false, true])
        expect(calls[1]!.problems).toEqual(['shot 6: "Bob" is not one of the characters'])
    })
    test('a problem of the whole beat asks every call again', () => {
        const calls = plannerCalls(10, 4, {issues: [{message: 'shot count: needed 10, got 9'}], previousShots: 9})
        expect(calls.every(c => !c.keep && c.problems.length === 1)).toBe(true)
    })
})

describe('people walk forward, not backwards (#412)', () => {
    const {instructions} = planPrompt(context, [beat], undefined, undefined, [], {from: 0, to: 4, total: 6, written: []})
    test('a walk names its direction to the camera, and only a short one leads away from it with the face visible', () => {
        expect(instructions).toContain('gets the direction of the walk relative to THIS shot')
        expect(instructions).toContain('Nobody walks backwards unless the beat itself says so')
    })
    test('no example or rule tells people to step back', () => {
        expect(instructions).not.toMatch(/steps? back|gives a step back/)
        expect(blockingPrompt(context, beat, undefined, undefined).instructions).not.toMatch(/steps? back/)
    })
    test('layout directions are tied to the first view in the staging and the blocking rules', () => {
        expect(instructions).toContain('is fixed to the camera of its first view')
        expect(blockingPrompt(context, beat, undefined, undefined).instructions).toContain('is fixed to the camera of its first view')
    })
})

describe('the planner sees what the pictures show', () => {
    test('the descriptions of the place and of the people of the beat are in the input', () => {
        const {input} = planPrompt(context, [beat], undefined, undefined, [], {from: 0, to: 4, total: 6, written: []})
        expect(input).toContain('"hall":{"name":"Hall","description":"A long stone hall with one door on the left."}')
        expect(input).toContain('"Runa":"A girl in a red coat."')
    })
    test('the film look is in the input, and the framing follows it - not "everyone the beat has" (#333)', () => {
        const {input, instructions} = planPrompt({...context, filmLook: 'Dark night close-ups by firelight.'}, [beat], undefined, undefined, [], {from: 0, to: 4, total: 6, written: []})
        expect(input).toContain("film look (the director's style - the shot sizes, the camera and the light of the shots follow it): Dark night close-ups by firelight.")
        expect(instructions).toContain('chosen by what the shot is about and by the "film look" in the input')
        expect(instructions).not.toContain('what can show everyone')
        // a project without a look brief plans as before, without the line
        expect(planPrompt(context, [beat], undefined, undefined, [], {from: 0, to: 4, total: 6, written: []}).input).not.toContain('film look')
    })
})

describe('the fixed layout of the place', () => {
    test('a place with a layout gives it to the planner; a place without one gives only its description', () => {
        const withLayout = planPrompt({...context, locationLayouts: {hall: {layout: 'The door is on the left, the hearth at the back.', views: []}}}, [beat], undefined, undefined, [], {from: 0, to: 4, total: 6, written: []})
        expect(withLayout.input).toContain('"layout":"The door is on the left, the hearth at the back."')
        const without = planPrompt(context, [beat], undefined, undefined, [], {from: 0, to: 4, total: 6, written: []})
        expect(without.input).not.toContain('"layout"')
        expect(withLayout.instructions).toBe(without.instructions)
    })
})

describe('the example shot', () => {
    test('one complete shot in the answer format instead of weak/strong pairs', () => {
        const {instructions} = planPrompt(context, [beat], undefined, undefined, [], {from: 0, to: 4, total: 6, written: []})
        expect(instructions).not.toContain('Weak:')
        expect(instructions).toContain('One shot as it should be written')
        for (const field of ['framing:', 'size:', 'camera:', 'view:', 'hold:', 'risky:', 'characters:', 'action:', 'person: Kara |', 'rest:']) expect(instructions.split('One shot as it should be written')[1]).toContain(field)
    })
})

describe('blocking first, then the shots', () => {
    test('the blocking call: the same instructions for every beat, the beat before and its ends in the input', () => {
        const first = blockingPrompt(context, beat, undefined, undefined)
        const second = blockingPrompt(context, {...beat, id: 'beat-02'}, {beatId: 'beat-01', staging: 'A hall.', ends: {Runa: 'stands at the door'}}, undefined)
        expect(second.instructions).toBe(first.instructions)
        expect(first.input).toContain('This is the first beat of the video.')
        expect(second.input).toContain('"ends":{"Runa":"stands at the door"}')
        expect(first.reasoning).toBe('low')
    })
    test('a shot call with a blocking writes neither the staging nor the ends', () => {
        const blocking = {staging: 'A hall, the door on the left.', starts: {Runa: 'stands at the door'}, ends: {Runa: 'sits by the fire'}}
        const {input} = planPrompt(context, [beat], undefined, undefined, [], {from: 4, to: 6, total: 6, written: [], blocking})
        expect(input).toContain('Blocking of this beat - fixed, keep to it:')
        expect(input).toContain('write no STAGING line and no ENDS block')
        expect(input).toContain('the last shot of the beat leaves everybody where the blocking ends them')
    })
})

describe('the music of a beat in the planner prompt', () => {
    test('per shot, who sings and whose instrument is heard - by name', () => {
        const withMusic: PlanContext = {
            ...context,
            characters: [...context.characters, {id: 'kai', name: 'Kai', role: 'guitarist', prop: 'guitar', propStem: 'guitar'}],
            shotCounts: {'beat-01': 2},
            beatProps: {'beat-01': [{characterId: 'kai', prop: 'guitar', activePerShot: [true, false]}]},
            beatSinging: {'beat-01': {singerIds: ['runa', 'kai'], singingPerShot: [true, true], singersPerShot: [['runa'], ['runa', 'kai']]}},
        }
        const {input} = planPrompt(withMusic, [{...beat, characterIds: ['runa', 'kai']}], undefined, undefined, [], {from: 0, to: 2, total: 2, written: []})
        expect(input).toContain('"music":[{"shot":1,"sings":["Runa"],"plays":["Kai"]},{"shot":2,"sings":["Runa","Kai"],"plays":[]}]')
        expect(input).not.toContain('activePerShot')
    })
})

describe('musicStretches - the music along the way for the beats', () => {
    // 60 s at 120 bpm: a bar every 2 s, quiet first half, loud second half
    const music = {durationSec: 60, downbeats: Array.from({length: 30}, (_, i) => i * 2), barEnergy: Array.from({length: 30}, (_, i) => i < 15 ? 0.2 : 0.8)}
    test('one line per stretch with its time and mean loudness', () => {
        expect(musicStretches(music, 2)).toEqual(['0:00-0:30 loudness 0.20', '0:30-1:00 loudness 0.80'])
    })
    test('whose instrument is heard over most of a stretch', () => {
        const players = [{name: 'Kael', prop: 'guitar', ranges: [{start: 0, end: 60}]}, {name: 'Mara', prop: 'drum kit', ranges: [{start: 25, end: 60}]}]
        expect(musicStretches(music, 3, players)).toEqual([
            "0:00-0:20 loudness 0.20 · heard: Kael's guitar",
            "0:20-0:40 loudness 0.50 · heard: Kael's guitar, Mara's drum kit",
            "0:40-1:00 loudness 0.80 · heard: Kael's guitar, Mara's drum kit",
        ])
        expect(musicStretches(music, 1, [{name: 'Kael', prop: 'guitar', ranges: [{start: 0, end: 5}]}])[0]).toContain('heard: none of the instruments')
    })
    test('the beats prompt carries them and the rules that follow them', () => {
        const args = {durationSec: 60, beatCount: 2, characters: [{id: 'kael', name: 'Kael', role: 'guitarist'}], locations: [{id: 'hall', name: 'Hall'}], lyrics: '', story: 'They play.', performance: ''}
        const input = beatsPrompt({...args, stretches: musicStretches(music, 2, [{name: 'Kael', prop: 'guitar', ranges: [{start: 0, end: 60}]}])}).input
        expect(input).toContain("0:30-1:00 loudness 0.80 · heard: Kael's guitar")
        expect(input).toContain('the last beats are a last surge, not an aftermath')
        expect(input).toContain('nobody lowers, rests, sets down or silences an instrument that is still heard')
        expect(beatsPrompt(args).input).not.toContain('The music along the way')
    })
})
