import {describe, expect, test} from "bun:test";
import {framesOnGrid} from "./assemble.ts";

describe('framesOnGrid', () => {
    test('a clip at the target frame rate keeps its frames', () => {
        expect(framesOnGrid({frames: 96, fps: 24})).toBe(96)
    })
    test('a 12 fps clip fills twice as many frames of the 24 fps grid', () => {
        expect(framesOnGrid({frames: 48, fps: 12})).toBe(96)
    })
    test('a higher frame rate is counted down to the grid', () => {
        expect(framesOnGrid({frames: 192, fps: 48})).toBe(96)
    })
})
