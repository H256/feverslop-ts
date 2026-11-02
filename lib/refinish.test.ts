import {describe, expect, test} from "bun:test";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import h3LatentUpscale from "../comfy/workflows/h3-latent-upscale.ts";
import h3Refine, {renderFrames} from "../comfy/workflows/h3-refine.ts";
import {finalName, paddedClip, readOptions, targetSize, variantOf, withOriginalSound} from "./refinish.ts";
import {finalLabel} from "./editor/project.ts";

describe('what is asked for', () => {
    test('a preset, and what is said beside it on top', () => {
        expect(readOptions({preset: 'fullhd'})).toMatchObject({upscale: 'refine', size: 'fullhd', fps: 48, finish: true, denoise: 0.2})
        expect(readOptions({preset: 'smooth'})).toMatchObject({upscale: 'none', fps: 48, finish: true})
        expect(readOptions({preset: 'fullhd', upscale: 'latent', fps: '24'})).toMatchObject({upscale: 'latent', fps: 24, finish: true})
    })
    test('one by one', () => {
        expect(readOptions({upscale: 'refine', size: '2x', denoise: '0.3'})).toMatchObject({upscale: 'refine', size: '2x', denoise: 0.3, fps: 24, finish: false})
        expect(readOptions({finish: true})).toMatchObject({upscale: 'none', finish: true})
    })
    test('what cannot be is refused', () => {
        expect(() => readOptions({})).toThrow('nothing to do')
        expect(() => readOptions({preset: 'huge'})).toThrow('--preset')
        expect(() => readOptions({upscale: 'magic'})).toThrow('--upscale')
        expect(() => readOptions({finish: true, size: 'big'})).toThrow('--size')
        expect(() => readOptions({upscale: 'refine', denoise: '0'})).toThrow('--denoise')
        expect(() => readOptions({fps: '12'})).toThrow('--fps')
    })
})

describe('the size', () => {
    test('full HD, the way round the clip is', () => {
        expect(targetSize('fullhd', 1376, 768)).toEqual({width: 1920, height: 1088})
        expect(targetSize('fullhd', 768, 1376)).toEqual({width: 1088, height: 1920})
    })
    test('twice the size and a size of its own, in multiples of 32', () => {
        expect(targetSize('2x', 1376, 768)).toEqual({width: 2752, height: 1536})
        expect(targetSize('2x', 610, 350)).toEqual({width: 1216, height: 704})
        expect(targetSize('1600x900', 1, 1)).toEqual({width: 1600, height: 896})
    })
})

describe('every variant has its own place', () => {
    const base = {size: 'fullhd', model: 'RealESRGAN_x2plus.pth', denoise: 0.2}
    test('so that they can be compared', () => {
        const names = [variantOf({...base, upscale: 'none'}), variantOf({...base, upscale: 'refine'}), variantOf({...base, upscale: 'refine', denoise: 0.3}), variantOf({...base, upscale: 'refine', size: '2x'}), variantOf({...base, upscale: 'latent'}), variantOf({...base, upscale: 'model'})]
        expect(names).toEqual(['original', 'refine-fullhd', 'refine-fullhd-d0.3', 'refine-2x', 'latent-fullhd', 'model-realesrgan-x2plus-fullhd'])
        expect(new Set(names).size).toBe(names.length)
    })
    test('no final video of a variant has the name of an original', () => {
        expect(finalName('demo', 'original')).toBe('demo--original.mp4')
        expect(finalName('demo', 'refine-fullhd')).not.toBe('demo.mp4')
    })
    test('the monitor knows them for what they are', () => {
        expect(finalLabel('demo', 'demo.mp4')).toMatchObject({label: 'Final'})
        expect(finalLabel('demo', 'demo--refine-fullhd.mp4')).toMatchObject({label: 'Refinish refine-fullhd'})
        expect(finalLabel('demo', 'demo--refine-fullhd-48fps-finished.mp4')).toMatchObject({label: 'Refinish refine-fullhd 48 fps finished'})
        expect(finalLabel('demo', 'demo--original-finished.mp4')).toMatchObject({label: 'Refinish finished'})
        expect(finalLabel('demo', 'demo--refine-fullhd-d0.3.mp4')).toMatchObject({label: 'Refinish refine-fullhd-d0.3'})
    })
})

describe('the clip keeps its length and its sound', () => {
    const framesOf = (file: string) => Number(Bun.spawnSync(['ffprobe', '-v', 'error', '-count_frames', '-select_streams', 'v', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file]).stdout.toString().trim())
    const hasSound = (file: string) => Bun.spawnSync(['ffprobe', '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file]).stdout.toString().includes('audio')
    test('filled up for the model, cut back after, with the sound of the original', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'refinish-'))
        try {
            const original = join(dir, 'clip.mp4')
            Bun.spawnSync(['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440', '-frames:v', '53', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', original])
            expect(framesOf(original)).toBe(53)
            const padded = join(dir, 'padded.mp4')
            await paddedClip(original, padded, 3)
            expect(framesOf(padded)).toBe(56)
            expect(hasSound(padded)).toBe(false)
            const target = join(dir, 'target.mp4')
            await withOriginalSound(padded, original, 53, true, target)
            expect(framesOf(target)).toBe(53)
            expect(hasSound(target)).toBe(true)
        } finally {
            rmSync(dir, {recursive: true, force: true})
        }
    })
})

describe('the latent upscale job', () => {
    const types = (result: { workflow: unknown }) => Object.values((result.workflow as { _nodes: Record<string, { class_type: string }> })._nodes).map(n => n.class_type)
    test('encoded, upscaled, decoded: nothing sampled, no text encoder, no model', () => {
        const nodes = types(h3LatentUpscale({video: 'clip.mp4', size: {width: 1920, height: 1088}, filenamePrefix: 'x'}))
        expect(nodes).toEqual(expect.arrayContaining(['VAEEncodeTiled', 'MinimaxH3LatentUpscaler3D', 'VAEDecode', 'VHS_VideoCombine']))
        for (const absent of ['SamplerCustomAdvanced', 'CLIPLoader', 'UNETLoader']) expect(nodes).not.toContain(absent)
    })
})

describe('the refine job', () => {
    const job = {prompt: 'p', pictures: ['a.png'], video: 'clip.mp4', frames: 56, size: {width: 1920, height: 1088}, denoise: 0.2, seed: 1, filenamePrefix: 'x'}
    const nodes = (result: { workflow: unknown }) => Object.values((result.workflow as { _nodes: Record<string, { class_type: string, inputs: Record<string, unknown> }> })._nodes)
    const of = (result: { workflow: unknown }, type: string) => nodes(result).filter(n => n.class_type === type)
    test('the second pass on the frames of the clip, at the size asked for', () => {
        const result = h3Refine(job)
        expect(result.size).toEqual(job.size)
        expect(of(result, 'SamplerCustomAdvanced')).toHaveLength(1)
        expect(of(result, 'VAEEncodeTiled')).toHaveLength(1)
        expect(of(result, 'BasicScheduler')[0]!.inputs).toMatchObject({scheduler: 'beta', steps: 4, denoise: 0.2})
        expect(of(result, 'MinimaxH3LatentUpscaler3D')[0]!.inputs).toMatchObject({'mode.width': 1920, 'mode.height': 1088})
        expect(of(result, 'VHS_LoadVideo')[0]!.inputs.video).toBe('clip.mp4')
        expect(of(result, 'CLIPLoader')[0]!.inputs.device).toBe('cpu')
    })
    test('nothing is decoded as sound: the clip keeps its own', () => {
        expect(of(h3Refine(job), 'VAEDecodeAudio')).toHaveLength(0)
        expect(of(h3Refine(job), 'VHS_VideoCombine')[0]!.inputs.audio).toBeUndefined()
    })
    test('a music video has its song as a guide and its tracks, a film none', () => {
        const music = h3Refine({...job, audios: ['vocals.wav'], song: 'song.wav', songStart: 3, duration: 2})
        expect(of(music, 'MiniMaxH3AddGuide')).toHaveLength(1)
        expect(of(music, 'TrimAudioDuration')).toHaveLength(2)
        expect(of(h3Refine(job), 'MiniMaxH3AddGuide')).toHaveLength(0)
    })
    test('lengths the model takes', () => {
        expect(renderFrames(158)).toBe(158)
        expect(renderFrames(159)).toBe(175)
    })
})
