import {describe, expect, test} from "bun:test";
import {shotCuts, shotPieces} from "./interpolate.ts";

const scores = (frames: number, hits: Record<number, number>) => Array.from({length: frames}, (_, i) => hits[i] ?? 0.01)

describe('shotCuts - the cuts as the picture has them, the plan only says where to look', () => {
    test('a planned cut moves to the frame the picture cuts on (slot-018: planned 96, cut at 91)', () => {
        expect(shotCuts(192, [0, 3.994], scores(192, {91: 0.42, 1: 0.14, 28: 0.08}))).toEqual([0, 91])
    })
    test('no clear change near the planned time: the cut stays where the plan has it', () => {
        expect(shotCuts(192, [0, 4], scores(192, {90: 0.1}))).toEqual([0, 96])
    })
    test('a cut the plan does not have counts when it is clearly one - a fast movement does not', () => {
        expect(shotCuts(192, [0], scores(192, {150: 0.5, 40: 0.15}))).toEqual([0, 150])
    })
    test('a shot that starts after the frames the final video uses is no cut', () => {
        expect(shotCuts(48, [0, 3], scores(72, {})).length).toBe(1)
    })
})

describe('shotPieces', () => {
    test('the cuts give pieces back to back over the frames the final video uses', () => {
        expect(shotPieces(192, [0, 91])).toEqual([{start: 0, frames: 91}, {start: 91, frames: 101}])
        expect(shotPieces(100, [])).toEqual([{start: 0, frames: 100}])
    })
})
