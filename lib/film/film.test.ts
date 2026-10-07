import {describe, expect, test} from "bun:test";
import {MAX_CLIP_SEC, packClips, splitLongShot, speakingSeconds, toCoverage} from "./coverage.ts";
import {collapseEmptyScene, maxShotsFor} from "./shot-checks.ts";
import {characterOf, locationOf, missingDialogue, speechSeconds, toCast, toScreenplay} from "./screenplay.ts";
import {screenplayToFountain} from "./fountain.ts";
import type {FilmCast, Scene, SceneCoverage, Screenplay} from "./types.ts";

const raw = {
    scenes: [
        {
            setting: 'EXT.', location: 'EXT. The Bridge', time: 'night', elements: [
                {type: 'action', text: 'Rain on the bridge. Anna waits.'},
                {type: 'dialogue', speaker: 'ANNA', text: 'You came.', kind: 'spoken', delivery: 'quietly'},
                {type: 'dialogue', speaker: 'BEN', text: 'I said I would.', kind: 'weird'},
            ],
        },
        {
            setting: 'INT', location: 'The Hut', time: '', shot: 'CLOSE UP - ANNA', elements: [
                {type: 'action', text: 'Anna lights a candle.'},
                {type: 'dialogue', speaker: 'ANNA', text: 'Tu en avais une. Tu la laissas pourrir en silence. Tu portas le poids jusqu\'à ce qu\'il écrase tes poumons. Je fais seulement pause dans la décadence.', kind: 'spoken', language: 'fr'},
            ],
        },
    ],
}
const screenplay = toScreenplay(raw, {title: 'T', language: 'en'})
const cast: FilmCast = toCast({
    characters: [{name: 'Anna', aliases: ['ANNA'], voice: 'a low voice'}, {name: 'Ben', aliases: ['BEN'], voice: 'a young voice'}],
    locations: [{name: 'The Bridge', aliases: ['The Bridge']}, {name: 'The Hut', aliases: ['The Hut']}],
}, screenplay)

describe('screenplay', () => {
    test('normalizes headings, settings, kinds and shot headings', () => {
        const [bridge, hut] = screenplay.scenes as [Scene, Scene]
        expect(bridge.setting).toBe('EXT')
        expect(bridge.location).toBe('The Bridge')
        expect(hut.time).toBe('DAY')
        expect(hut.shot).toBe('CLOSE UP - ANNA')
        expect(bridge.shot).toBeUndefined()
        expect(bridge.elements.filter(e => e.type === 'dialogue').map(e => e.kind)).toEqual(['spoken', 'spoken'])
    })
    test('a screenplay without scenes or a scene without content is rejected', () => {
        expect(() => toScreenplay({}, {title: 'T', language: 'en'})).toThrow()
        expect(() => toScreenplay({scenes: [{location: 'X', elements: []}]}, {title: 'T', language: 'en'})).toThrow()
    })
    test('finds dialogue the structuring changed', () => {
        expect(missingDialogue(screenplay, 'ANNA\nYou came.\nBEN\nI said I would.\nTu en avais une. Tu la laissas pourrir en silence. Tu portas le poids jusqu\'à ce qu\'il écrase tes poumons. Je fais seulement pause dans la décadence.')).toEqual([])
        expect(missingDialogue(screenplay, 'ANNA\nYou came!\nBEN\nI told you.')).toContain('I said I would.')
    })
    test('resolves speakers and places through aliases, case-insensitive', () => {
        expect(characterOf(cast, 'anna')?.id).toBe('anna')
        expect(locationOf(cast, 'the hut')?.id).toBe('the-hut')
        expect(characterOf(cast, 'nobody')).toBeUndefined()
    })
    test('a speaker that is not in the cast is rejected', () => {
        expect(() => toCast({characters: [{name: 'Anna', aliases: ['ANNA']}], locations: [{name: 'The Bridge'}, {name: 'The Hut'}]}, screenplay)).toThrow(/BEN/)
    })
    test('speaking time grows with the words, in any script', () => {
        expect(speechSeconds('one two three four five six')).toBeGreaterThan(speechSeconds('one two'))
        expect(speechSeconds('今日は雨が降っています')).toBeGreaterThan(speechSeconds('はい'))
    })
    test('fountain export has the lines and the parenthetical', () => {
        const fountain = screenplayToFountain(screenplay)
        expect(fountain).toContain('ANNA')
        expect(fountain).toContain('(quietly)')
        expect(fountain).toContain('You came.')
    })
})

describe('coverage', () => {
    const bridge = screenplay.scenes[0]!
    const hut = screenplay.scenes[1]!
    const shot = (extra: Record<string, unknown>) => ({framing: 'wide', camera: 'the camera drifts', characters: ['Anna'], action: 'Anna waits.', seconds: 4, ...extra})

    test('every dialogue line must be in exactly one shot, in order', () => {
        expect(() => toCoverage({soundscape: 's', shots: [shot({lines: [1]})]}, bridge, cast)).toThrow()
        expect(() => toCoverage({soundscape: 's', shots: [shot({lines: [2, 1]})]}, bridge, cast)).toThrow()
        const {coverage} = toCoverage({soundscape: 's', people: true, shots: [shot({lines: [1]}), shot({characters: ['Ben'], lines: [2]})]}, bridge, cast)
        expect(coverage.shots.map(s => s.lines)).toEqual([[0], [1]])
    })
    test('whoever speaks on screen is in the shot, an unknown name is a problem', () => {
        const {coverage} = toCoverage({soundscape: 's', people: true, shots: [shot({characters: [], lines: [1, 2]})]}, bridge, cast)
        expect(coverage.shots[0]!.characters.sort()).toEqual(['anna', 'ben'])
        expect(() => toCoverage({soundscape: 's', shots: [shot({characters: ['Zed'], lines: [1, 2]})]}, bridge, cast)).toThrow(/Zed/)
    })
    test('a shot is never shorter than its lines, and deliveries line up with the lines', () => {
        const {coverage} = toCoverage({soundscape: 's', people: true, shots: [shot({lines: [1, 2], seconds: 2, deliveries: ['calm', 'tired']})]}, bridge, cast)
        const s = coverage.shots[0]!
        expect(s.seconds).toBeGreaterThanOrEqual(Math.floor(speakingSeconds(bridge, [0, 1]) * 100) / 100)
        expect(s.deliveries).toEqual(['calm', 'tired'])
    })
    test('a line too long for a clip is split at sentence ends and the parts are the line', () => {
        const long = shot({lines: [1], characters: ['Anna'], seconds: 8})
        const {coverage} = toCoverage({soundscape: 's', people: true, shots: [long]}, hut, cast)
        const parts = splitLongShot(hut, {...coverage.shots[0]!, seconds: 14})
        expect(parts.length).toBeGreaterThan(1)
        expect(parts.every(p => p.seconds <= 10)).toBe(true)
        expect(parts.slice(1).every(p => p.continues)).toBe(true)
        const line = hut.elements.find(e => e.type === 'dialogue')!
        expect(parts.map(p => p.texts?.[0] ?? '').join(' ')).toBe(line.type === 'dialogue' ? line.text : '')
    })
    test('short shots are not split', () => {
        const {coverage} = toCoverage({soundscape: 's', people: true, shots: [shot({lines: [1, 2]})]}, bridge, cast)
        expect(splitLongShot(bridge, coverage.shots[0]!)).toHaveLength(1)
    })
    test('clips never span two scenes and never exceed the limit', () => {
        const plans: SceneCoverage[] = [
            toCoverage({soundscape: 's', people: true, shots: [shot({lines: [1], seconds: 8}), shot({characters: ['Ben'], lines: [2], seconds: 8})]}, bridge, cast).coverage,
            toCoverage({soundscape: 's', people: true, shots: [shot({lines: [1], seconds: 8})]}, hut, cast).coverage,
        ]
        const clips = packClips(screenplay, plans, 'auto')
        expect(clips.every(c => c.seconds <= MAX_CLIP_SEC + 0.5)).toBe(true)
        expect(new Set(clips.map(c => c.sceneId))).toEqual(new Set(['s1', 's2']))
        expect(clips[0]!.opensScene).toBe(true)
        expect(clips.map(c => c.index)).toEqual(clips.map((_, i) => i + 1))
        // frames of the clips follow each other without gaps
        clips.reduce((frame, c) => { expect(c.frameStart).toBe(frame); return frame + c.frames }, 0)
    })
    test('continuity "scene" chains every clip but the first of a scene, "never" none', () => {
        const plan = toCoverage({soundscape: 's', people: true, shots: [shot({lines: [1], seconds: 8}), shot({characters: ['Ben'], lines: [2], seconds: 8})]}, bridge, cast).coverage
        const hutPlan = toCoverage({soundscape: 's', people: true, shots: [shot({lines: [1], seconds: 8})]}, hut, cast).coverage
        const chained = packClips(screenplay, [plan, hutPlan], 'scene')
        expect(chained.filter(c => c.startsFrom).map(c => c.id)).toContain('clip-002')
        expect(chained.find(c => c.sceneId === 's2' && c.opensScene)!.startsFrom).toBeUndefined()
        expect(packClips(screenplay, [plan, hutPlan], 'never').some(c => c.startsFrom)).toBe(false)
    })
})

describe('shot checks', () => {
    const empty: Screenplay = toScreenplay({scenes: [{setting: 'EXT', location: 'The Field', time: 'DAY', elements: [{type: 'action', text: 'Wind. Grass.'}, {type: 'action', text: 'Clouds pass.'}]}]}, {title: 'E', language: 'en'})
    const scene = empty.scenes[0]!
    const mk = (seconds: number) => ({framing: 'wide', camera: 'c', characters: [], action: 'a', lines: [], seconds})
    test('a scene without people and dialogue collapses to one shot', () => {
        const {shots} = collapseEmptyScene([mk(3), mk(4), mk(5)], scene, false)
        expect(shots).toHaveLength(1)
        expect(shots[0]!.seconds).toBeLessThanOrEqual(8)
    })
    test('a scene with people is not collapsed', () => {
        expect(collapseEmptyScene([mk(3), mk(4)], scene, true).shots).toHaveLength(2)
    })
    test('the most shots come from the structure of the script', () => {
        expect(maxShotsFor(scene)).toBe(2)
        expect(maxShotsFor(screenplay.scenes[0]!)).toBeGreaterThanOrEqual(2)
    })
})
