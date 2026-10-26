import {describe, expect, test} from "bun:test";
import {CONTEXT_SETTLE, FPS, maxClipFor} from "./frames.ts";

describe('maxClipFor', () => {
    const max = 10 - 17 / FPS

    test('stays as it is without context frames or without continuing clips', () => {
        expect(maxClipFor(max, 0, 'always')).toBe(max)
        expect(maxClipFor(max, 22, 'never')).toBe(max)
    })

    test('makes room for the frames a continuing clip is rendered longer at its head', () => {
        for (const frames of [22, 39]) {
            const planned = maxClipFor(max, frames, 'auto')
            expect(planned).toBeCloseTo(max - (frames + CONTEXT_SETTLE) / FPS, 3)
            // planned + head still within the limit the video model renders
            expect(planned + (frames + CONTEXT_SETTLE) / FPS).toBeLessThanOrEqual(max + 1e-3)
        }
    })
})
