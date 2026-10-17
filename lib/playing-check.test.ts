import {describe, expect, test} from "bun:test";
import type {AskOptions} from "./llm.ts";
import {playingCases, playingIssues} from "./playing-check.ts";
import type {ShotPlan} from "./project.ts";

const characters = [{id: 'kael', name: 'Kael'}, {id: 'mara', name: 'Mara'}, {id: 'elara', name: 'Elara'}]
const props = [{characterId: 'kael', prop: 'guitar', activePerShot: [true, false]}, {characterId: 'mara', prop: 'drum kit', activePerShot: [true, true]}]
const shots: ShotPlan[] = [
    {action: 'x', people: {
        kael: {motion: 'steps forward', playing: true, plays: 'strums hard downstrokes'},
        mara: {motion: 'holds pose', playing: true, plays: 'both wrists locked overhead, sticks held rigid'},
        elara: {motion: 'sings', singing: true},
    }},
    {action: 'y', people: {kael: {motion: 'turns'}, mara: {playing: true}}},
]

describe('playingCases', () => {
    test('every heard player with a phrase - not the unheard, not a bare "yes", not who has no instrument', () => {
        expect(playingCases(shots, props, characters)).toEqual([
            {shot: 0, name: 'Kael', prop: 'guitar', plays: 'strums hard downstrokes', motion: 'steps forward'},
            {shot: 0, name: 'Mara', prop: 'drum kit', plays: 'both wrists locked overhead, sticks held rigid', motion: 'holds pose'},
        ])
    })
    test('without instrument activity there is nothing to check', () => {
        expect(playingCases(shots, undefined, characters)).toEqual([])
    })
})

describe('playingIssues', () => {
    const asked: AskOptions[] = []
    const answering = (playing: unknown[]) => async <T>(options: AskOptions) => {
        asked.push(options)
        return {playing} as T
    }
    const cases = playingCases(shots, props, characters)
    test('a "no" is a problem of its shot, with the phrase and what to write instead', async () => {
        const issues = await playingIssues(cases, answering([true, false]))
        expect(issues).toEqual([{shot: 0, message: expect.stringContaining('shot 1: Mara\'s drum kit is heard through this shot, but "both wrists locked overhead, sticks held rigid" with "holds pose" does not play it')}])
        expect(issues[0]!.message).toContain("playing: what Mara's hands do to play the drum kit all through the shot")
    })
    test('one call for the beat, thinking off, the phrases as data', async () => {
        asked.length = 0
        await playingIssues(cases, answering([true, true]))
        expect(asked).toHaveLength(1)
        expect(asked[0]!.reasoning).toBe('none')
        expect(asked[0]!.input).toContain('"hands":"strums hard downstrokes"')
    })
    test('nothing to check asks nothing; an answer that is not a clear "no" is no problem', async () => {
        asked.length = 0
        expect(await playingIssues([], answering([]))).toEqual([])
        expect(asked).toHaveLength(0)
        expect(await playingIssues(cases, answering([]))).toEqual([])
    })
})
