import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {existsSync, mkdirSync, mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import h3Ref2Video from "../comfy/workflows/h3-ref2video.ts";
import h3Ref2VideoFilm from "../comfy/workflows/h3-ref2video-film.ts";
import h3Ref2Video2Pass from "../comfy/workflows/h3-ref2video-2pass.ts";
import {scaledSize} from "../comfy/helpers.ts";
import {previewSources, probeVideo} from "./assemble.ts";
import {parseRetake, planRetake, retakeFrames, retakePrompt, shotsIn, spliceVideo} from "./retake.ts";

const lengths = (frames: number) => 5 + 17 * Math.ceil(Math.max(0, frames - 5) / 17)

describe('what a part of a clip is', () => {
    test('seconds or a shot', () => {
        expect(parseRetake('slot-007:3.2-5.0')).toEqual({clip: 'slot-007', seconds: [3.2, 5]})
        expect(parseRetake('clip-012:shot2')).toEqual({clip: 'clip-012', shot: 2})
    })
    test('anything else is refused', () => {
        for (const wrong of ['slot-007', 'slot-007:3', 'slot-007:shot', '../x:1-2', 'slot-007:1-2 --again']) expect(() => parseRetake(wrong)).toThrow('--retake')
    })
    test('in frames, where the picture cuts', () => {
        expect(retakeFrames({clip: 'c', seconds: [1, 2]}, 100, [])).toEqual({first: 24, end: 48})
        expect(retakeFrames({clip: 'c', shot: 1}, 100, [40, 70])).toEqual({first: 0, end: 40})
        expect(retakeFrames({clip: 'c', shot: 2}, 100, [40, 70])).toEqual({first: 40, end: 70})
        expect(retakeFrames({clip: 'c', shot: 3}, 100, [40, 70])).toEqual({first: 70, end: 100})
    })
    test('never more than the file has, and never nothing', () => {
        expect(retakeFrames({clip: 'c', seconds: [1, 99]}, 100, [])).toEqual({first: 24, end: 100})
        expect(() => retakeFrames({clip: 'c', seconds: [50, 60]}, 100, [])).toThrow('no frames')
        expect(() => retakeFrames({clip: 'c', shot: 4}, 100, [40, 70])).toThrow('has 3 shot')
    })
})

describe('how the job is laid out', () => {
    test('frames before it, the part, and a guide to the frame after it - in a length the model takes', () => {
        const plan = planRetake({first: 60, end: 100}, 180, 22, lengths)
        expect(plan).toMatchObject({lead: 22, singleStart: false, frames: 40, endAt: 62})
        expect((plan.render - 5) % 17).toBe(0)
        expect(plan.render).toBeGreaterThanOrEqual(63)
    })
    test('too little before it for a batch: the one frame before it; at the start of the clip: nothing', () => {
        expect(planRetake({first: 3, end: 40}, 180, 22, lengths)).toMatchObject({lead: 0, singleStart: true})
        expect(planRetake({first: 0, end: 40}, 180, 22, lengths)).toMatchObject({lead: 0, singleStart: false})
    })
    test('fewer frames than wanted before it: the largest batch there is room for', () => {
        expect(planRetake({first: 10, end: 40}, 180, 22, lengths).lead).toBe(5)
    })
    test('up to the end of the file: no guide after it', () => {
        expect(planRetake({first: 60, end: 180}, 180, 22, lengths).endAt).toBeUndefined()
    })
})

describe('the prompt of a part', () => {
    const prompt = 'subject_definitions:\nthe place.\n[Shot 1] one. [Shot 2] At 00:03.000 two. [Shot 3] At 00:05.000 three.'
    test('what comes before the shots, and the shots it touches', () => {
        expect(retakePrompt(prompt, [2])).toBe('subject_definitions:\nthe place.\n[Shot 2] At 00:03.000 two. ')
        expect(retakePrompt(prompt, [1, 3])).toBe('subject_definitions:\nthe place.\n[Shot 1] one. [Shot 3] At 00:05.000 three.')
    })
    test('a prompt without labels, or no shot found, stays as it is', () => {
        expect(retakePrompt('a clip', [1])).toBe('a clip')
        expect(retakePrompt(prompt, [9])).toBe(prompt)
    })
    test('which shots a part touches', () => {
        expect(shotsIn({first: 0, end: 10}, [40, 70])).toEqual([1])
        expect(shotsIn({first: 30, end: 50}, [40, 70])).toEqual([1, 2])
        expect(shotsIn({first: 70, end: 100}, [40, 70])).toEqual([3])
    })
})

describe('the jobs', () => {
    const music = {prompt: 'p', pictures: ['a.png'], audios: ['vocals.wav'], song: 'song.wav', songStart: 0, frames: 22, duration: 1, seed: 1, resolution: '1344x768' as const, filenamePrefix: 'x'}
    const film = {prompt: 'p', pictures: ['a.png'], frames: 22, seed: 1, resolution: '1344x768' as const, filenamePrefix: 'x'}
    const nodes = (result: { workflow: unknown }) => {
        const built = result.workflow as { workflow?: Record<string, { class_type: string, inputs: Record<string, unknown> }>, _nodes?: Record<string, { class_type: string, inputs: Record<string, unknown> }> }
        return Object.values(built._nodes ?? built.workflow ?? {})
    }
    const of = (result: { workflow: unknown }, type: string) => nodes(result).filter(n => n.class_type === type)

    test('a preview: fewer steps and a fraction of the pixels; without it a render is what it was', () => {
        const full = h3Ref2Video(music)
        const preview = h3Ref2Video({...music, preview: {scale: 0.25, steps: 4}})
        expect(of(full, 'BasicScheduler')[0]!.inputs.steps).toBe(8)
        expect(of(preview, 'BasicScheduler')[0]!.inputs.steps).toBe(4)
        expect(preview.size).toEqual({width: 672, height: 384})
        expect(full.size).toEqual({width: 1344, height: 768})
        expect(h3Ref2VideoFilm({...film, preview: {scale: 0.25, steps: 4}}).size).toEqual({width: 672, height: 384})
    })
    test('a two-pass preview is its first pass', () => {
        const full = h3Ref2Video2Pass(music)
        const preview = h3Ref2Video2Pass({...music, preview: {scale: 0.25, steps: 4}})
        expect(of(full, 'SamplerCustomAdvanced')).toHaveLength(2)
        expect(of(preview, 'SamplerCustomAdvanced')).toHaveLength(1)
        expect(of(preview, 'MinimaxH3LatentUpscaler3D')).toHaveLength(0)
        expect(preview.size).toEqual({width: 672, height: 384})
    })
    test('a part: guided to the frame after it, in every kind of workflow', () => {
        const guideAt = (result: { workflow: unknown }) => of(result, 'MiniMaxH3AddGuide').map(n => n.inputs.frame_idx).filter(at => at !== 0)
        expect(guideAt(h3Ref2Video({...music, endFrame: {image: 'after.png', at: 40}}))).toEqual([40])
        expect(guideAt(h3Ref2VideoFilm({...film, endFrame: {image: 'after.png', at: 40}}))).toEqual([40])
        // each pass has its own latent, so each has the guide
        expect(guideAt(h3Ref2Video2Pass({...music, endFrame: {image: 'after.png', at: 40}}))).toEqual([40, 40])
        expect(guideAt(h3Ref2Video(music))).toEqual([])
    })
    test('sizes scale on the area, in multiples of 32', () => {
        expect(scaledSize({width: 1920, height: 1088}, 0.25)).toEqual({width: 960, height: 544})
        expect(scaledSize({width: 1920, height: 1088}, 1)).toEqual({width: 1920, height: 1088})
    })
})

describe('joining the part in', () => {
    let dir: string
    const make = async (name: string, color: string, frames: number) => {
        const file = join(dir, name)
        const proc = Bun.spawn(['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i', `color=${color}:s=64x36:r=24`, '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-frames:v', String(frames), '-t', String(frames / 24), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file], {stdout: 'ignore', stderr: 'ignore'})
        expect(await proc.exited).toBe(0)
        return file
    }
    // the brightness of a frame: which of the videos it comes from
    const brightness = async (file: string, frame: number) => {
        const proc = Bun.spawn(['ffmpeg', '-v', 'error', '-i', file, '-vf', `select=eq(n\\,${frame}),scale=1:1,format=gray`, '-frames:v', '1', '-f', 'rawvideo', '-'], {stdout: 'pipe', stderr: 'ignore'})
        const bytes = new Uint8Array(await new Response(proc.stdout).arrayBuffer())
        await proc.exited
        return bytes[0]!
    }
    beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'retake-')) })
    afterAll(() => rmSync(dir, {recursive: true, force: true}))

    test('the head and tail of the old clip, the new frames between them, as many frames as before, with sound', async () => {
        const original = await make('original.mp4', 'black', 48)
        // white: 22 frames before the part (to be left out) would show as white too - so they are told apart by where they land
        const rendered = await make('rendered.mp4', 'white', 39)
        const target = join(dir, 'spliced.mp4')
        await spliceVideo({original, rendered, plan: {first: 12, end: 24, lead: 22, frames: 12}, width: 64, height: 36, target})
        const info = await probeVideo(target)
        expect(info.frames).toBe(48)
        expect(info.hasAudio).toBe(true)
        expect(await brightness(target, 11)).toBeLessThan(40)
        expect(await brightness(target, 12)).toBeGreaterThan(200)
        expect(await brightness(target, 23)).toBeGreaterThan(200)
        expect(await brightness(target, 24)).toBeLessThan(40)
    })
    test('from the start of the clip', async () => {
        const original = await make('original2.mp4', 'black', 24)
        const rendered = await make('rendered2.mp4', 'white', 22)
        const target = join(dir, 'spliced2.mp4')
        await spliceVideo({original, rendered, plan: {first: 0, end: 12, lead: 0, frames: 12}, width: 64, height: 36, target})
        expect((await probeVideo(target)).frames).toBe(24)
        expect(await brightness(target, 0)).toBeGreaterThan(200)
        expect(await brightness(target, 12)).toBeLessThan(40)
    })
    test('a preview video has a file for every clip: its preview, else its render, else a gap of its length', async () => {
        const project = join(dir, 'project')
        mkdirSync(join(project, 'previews'), {recursive: true})
        mkdirSync(join(project, 'videos'), {recursive: true})
        await Bun.write(join(project, 'previews', 'slot-001.mp4'), Bun.file(await make('p.mp4', 'white', 24)))
        await Bun.write(join(project, 'videos', 'slot-002.mp4'), Bun.file(await make('v.mp4', 'gray', 24)))
        const files = await previewSources(project, [{id: 'slot-001', frames: 24}, {id: 'slot-002', frames: 24}, {id: 'slot-003', frames: 36}])
        expect(files[0]).toBe(join(project, 'previews', 'slot-001.mp4'))
        expect(files[1]).toBe(join(project, 'videos', 'slot-002.mp4'))
        expect(existsSync(files[2]!)).toBe(true)
        const gap = await probeVideo(files[2]!)
        expect(gap).toMatchObject({width: 64, height: 36, frames: 36, hasAudio: true})
    })
})
