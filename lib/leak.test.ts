import {describe, expect, test} from "bun:test";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {backdropSeconds, hasFlatBackdrop} from "./leak.ts";

const WIDTH = 96, HEIGHT = 54

// a frame whose pixels come from a function of (x, y)
function frame(pixel: (x: number, y: number) => [number, number, number]): Uint8Array {
    const out = new Uint8Array(WIDTH * HEIGHT * 3)
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) out.set(pixel(x, y), (y * WIDTH + x) * 3)
    return out
}

describe('hasFlatBackdrop', () => {
    test('a flat grey band along the top is a studio backdrop', () => {
        expect(hasFlatBackdrop(frame(() => [96, 98, 94]))).toBe(true)
    })

    test('a helmet or some hair in the band does not hide the backdrop', () => {
        expect(hasFlatBackdrop(frame((x, y) => y < 8 && x > 80 ? [200, 160, 40] : [100, 100, 96]))).toBe(true)
    })

    test('a dark cave with texture is not one', () => {
        expect(hasFlatBackdrop(frame((x, y) => {
            const v = 20 + ((x * 37 + y * 91) % 60)
            return [v, v * 0.8, v * 0.5]
        }))).toBe(false)
    })

    test('a dark flat set stays below the brightness of a lit backdrop', () => {
        expect(hasFlatBackdrop(frame(() => [30, 30, 30]))).toBe(false)
    })

    test('a bright flat sky is not one', () => {
        expect(hasFlatBackdrop(frame(() => [230, 232, 235]))).toBe(false)
    })

    test('a flat but coloured area (a lit wall of ore) is not one', () => {
        expect(hasFlatBackdrop(frame(() => [150, 90, 30]))).toBe(false)
    })

    test('grey lower down in the picture only does not count', () => {
        expect(hasFlatBackdrop(frame((_, y) => y < 12 ? [25, 20, 15] : [100, 100, 100]))).toBe(false)
    })
})

describe('backdropSeconds', () => {
    test.skipIf(!Bun.which('ffmpeg'))('finds the seconds of a video that sit on a grey backdrop', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'leak-'))
        try {
            const file = join(dir, 'clip.mp4')
            // 2 s of a dark cave colour, then 2 s of flat grey
            const proc = Bun.spawn(['ffmpeg', '-v', 'error', '-y',
                '-f', 'lavfi', '-i', 'color=c=0x181410:s=320x180:r=8:d=2',
                '-f', 'lavfi', '-i', 'color=c=0x606260:s=320x180:r=8:d=2',
                '-filter_complex', '[0:v][1:v]concat=n=2:v=1[v]', '-map', '[v]', '-pix_fmt', 'yuv420p', file])
            expect(await proc.exited).toBe(0)
            const seconds = await backdropSeconds(file)
            expect(seconds.length).toBeGreaterThan(0)
            expect(Math.min(...seconds)).toBeGreaterThanOrEqual(1.75)
            expect(Math.max(...seconds)).toBeLessThanOrEqual(4)
        } finally {
            rmSync(dir, {recursive: true, force: true})
        }
    })
})
