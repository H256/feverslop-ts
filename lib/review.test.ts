import {describe, expect, test} from "bun:test";
import {checkShape} from "./review.ts";

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
