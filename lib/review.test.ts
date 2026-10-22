import {describe, expect, test} from "bun:test";
import {checkShape, reviewed} from "./review.ts";

describe('an edited step keeps its shape', () => {
    test('a list stays a list', () => {
        expect(checkShape([{id: 'beat-01'}], '[{"id": "beat-01", "summary": "x"}]')).toEqual([{id: 'beat-01', summary: 'x'}])
        expect(checkShape([{id: 'beat-01'}], '{"id": "beat-01"}')).toBe('must stay a list with at least one entry')
        expect(checkShape([{id: 'beat-01'}], '[]')).toBe('must stay a list with at least one entry')
    })
    test('an object keeps its fields', () => {
        expect(checkShape({characters: [], locations: []}, '{"characters": [], "locations": [{"id": "a"}]}')).toEqual({characters: [], locations: [{id: 'a'}]})
        expect(checkShape({characters: [], locations: []}, '{"characters": []}')).toBe('the field(s) locations are missing')
    })
    test('broken JSON says why', () => {
        expect(String(checkShape({a: 1}, '{"a": '))).toStartWith('not valid JSON')
    })
})

describe('reviewed with a film', () => {
    test('a cached step and a run without --review are shown and taken as they are - nothing is asked', async () => {
        const {FilmStore} = await import('./film/store.ts')
        const film = new FilmStore('test-film')
        film.data.lookBrief = 'cached look'
        film.save = async () => {}
        const shown: string[] = []
        // generated just now, but no --review
        expect(await reviewed(film, false, 'summary', async () => 'new summary', value => shown.push(value))).toBe('new summary')
        // --review, but taken from project.json: not in film.generated
        expect(await reviewed(film, true, 'lookBrief', async () => film.data.lookBrief!, value => shown.push(value))).toBe('cached look')
        expect(shown).toEqual(['new summary', 'cached look'])
    })
})
