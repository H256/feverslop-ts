import {describe, expect, test} from "bun:test";
import type {AskOptions} from "../llm.ts";
import type {FilmClip} from "./coverage.ts";
import {fitOf, fitOverrides} from "./fit.ts";
import type {FilmStore} from "./store.ts";
import type {FilmCharacter, Shot} from "./types.ts";

const person = (id: string, name: string): FilmCharacter => ({id, name, aliases: [name.toUpperCase()]} as unknown as FilmCharacter)
const vyvian = person('vyvian', 'Vyvian'), emil = person('emil', 'Emil')
const shot = (more: Partial<Shot> = {}): Shot => ({
    framing: 'medium shot', camera: 'the camera is still', characters: ['vyvian', 'emil'], lines: [], seconds: 4,
    view: 'from the seats, looking at the stage', action: 'Vyvian and Emil step off the stage door onto the dusty stage.',
    people: {vyvian: {state: 'at the stage door', frame: 'left'}, emil: {state: 'behind Vyvian'}}, placeView: 1, ...more,
})
const clip = (shots: Shot[] = [shot()]): FilmClip => ({id: 'clip-008', index: 7, sceneId: 's3', opensScene: false, shots, seconds: 4, frameStart: 0, frames: 96} as FilmClip)
const views = [{name: 'from the seats', shows: 'the stage head-on'}, {name: 'in the left wing', shows: 'the bare stage from the side'}]
const store = () => ({data: {}, save: async () => {}}) as unknown as FilmStore
const place = () => ({views, staging: 'A dark theatre stage.'})
const answer = (action: string) => ({shots: [{view: 'in the left wing, looking along the stage', camera: 'the camera is still', action, people: [{id: 'vyvian', state: 'at the stage door', motion: 'steps onto the stage'}]}]})

describe('a clip fitted to the choice made for it (#531)', () => {
    test('only a choice that changes its shots asks: a person in them left out, or another view than planned', () => {
        expect(fitOf(clip(), undefined, [vyvian, emil], views)).toBeUndefined()
        expect(fitOf(clip(), {placeView: 1}, [vyvian, emil], views)).toBeUndefined()
        expect(fitOf(clip(), {without: ['ann']}, [vyvian, emil], views)).toBeUndefined()
        expect(fitOf(clip(), {without: ['emil']}, [vyvian, emil], views)!.without.map(c => c.id)).toEqual(['emil'])
        expect(fitOf(clip(), {placeView: 2}, [vyvian, emil], views)!.view).toEqual(views[1])
    })

    test('the left-out person goes from the shots, the camera follows the chosen view; a name still there is asked about once', async () => {
        const asked: AskOptions[] = []
        const replies = [answer('Vyvian and Emil step onto the stage.'), answer('Vyvian steps off the stage door onto the dusty stage.')]
        const film = store()
        const [fitted] = await fitOverrides(film, [clip()], {'clip-008': {placeView: 2, without: ['emil']}}, [vyvian, emil], place, async options => { asked.push(options); return replies.shift()! })
        expect(asked).toHaveLength(2)
        expect(asked[1]!.input).toContain('shot 1 still names Emil')
        expect(asked[0]!.input).toContain('in the left wing - the bare stage from the side')
        const s = fitted!.shots[0]!
        expect(s.characters).toEqual(['vyvian'])
        expect(s.action).toBe('Vyvian steps off the stage door onto the dusty stage.')
        expect(s.view).toBe('in the left wing, looking along the stage')
        expect(s.people).toEqual({vyvian: {state: 'at the stage door', frame: 'left', motion: 'steps onto the stage'}})
        expect(s.placeView).toBe(2)
        // the same choice again: kept, not asked
        await fitOverrides(film, [clip()], {'clip-008': {placeView: 2, without: ['emil']}}, [vyvian, emil], place, async options => { asked.push(options); return answer('') })
        expect(asked).toHaveLength(2)
    })

    test('a question that fails leaves the clip as planned, and the next run asks again', async () => {
        const film = store()
        const [kept] = await fitOverrides(film, [clip()], {'clip-008': {without: ['emil']}}, [vyvian, emil], place, async () => ({shots: []}))
        expect(kept).toEqual(clip())
        expect((film.data as {clipFits?: unknown}).clipFits).toBeUndefined()
    })
})
