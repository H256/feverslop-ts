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

describe('assembleFinal with interpolated clips', () => {
    test('clips at 120 fps (x5) become a 60 fps video of the same length, the song under it', async () => {
        const {mkdtempSync} = await import("node:fs")
        const {tmpdir} = await import("node:os")
        const {join} = await import("node:path")
        const {assembleFinal, probeVideo} = await import("./assemble.ts")
        const dir = mkdtempSync(join(tmpdir(), 'fps-'))
        const make = async (args: string[]) => {
            const p = Bun.spawn(['ffmpeg', '-v', 'error', '-y', ...args], {stderr: 'pipe'})
            if (await p.exited !== 0) throw new Error(await new Response(p.stderr).text())
        }
        // two clips of 24 and 48 frames, interpolated x5: 120 and 240 frames at 120 fps (one frame more than needed in the first)
        await make(['-f', 'lavfi', '-i', 'testsrc=size=64x36:rate=120', '-frames:v', '121', '-pix_fmt', 'yuv420p', join(dir, 'a.mp4')])
        await make(['-f', 'lavfi', '-i', 'testsrc=size=64x36:rate=120', '-frames:v', '240', '-pix_fmt', 'yuv420p', join(dir, 'b.mp4')])
        await make(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', join(dir, 'song.wav')])
        const clips = [{id: 'a', frames: 24, frameStart: 0}, {id: 'b', frames: 48, frameStart: 24}] as never
        const target = join(dir, 'out.mp4')
        const result = await assembleFinal({clips, projectDir: dir, songFile: join(dir, 'song.wav'), songAudio: true, target, interpolated: {files: [join(dir, 'a.mp4'), join(dir, 'b.mp4')], multiplier: 5, fps: 60}})
        const info = await probeVideo(target)
        expect(info.fps).toBe(60)
        expect(info.frames).toBe(180)
        expect(result.seconds).toBe(3)
        expect(info.hasAudio).toBe(true)
    })
})
