import {describe, expect, test} from "bun:test";
import {aboveRecommended, pixelSize} from "../comfy/helpers.ts";
import {twoPassSizes} from "../comfy/h3-two-pass.ts";
import {dispatchOrder, resumesJob} from "./render.ts";

test('a job that is queued, running or finished is resumed', () => {
    expect(resumesJob('queued')).toBe(true)
    expect(resumesJob('running')).toBe(true)
    expect(resumesJob('finished')).toBe(true)
})

test('a job already queued on a server gets it before the new renders - it only has to be fetched', () => {
    const waiting = [{id: 'slot-003'}, {id: 'slot-001', pin: '5090'}, {id: 'slot-004'}, {id: 'slot-002', pin: 'radeon'}]
    expect(dispatchOrder(waiting).map(w => w.id)).toEqual(['slot-001', 'slot-002', 'slot-003', 'slot-004'])
})

test('a failed job is queued anew, not resumed', () => {
    expect(resumesJob('failed')).toBe(false)
})

test('a job the server no longer knows is queued anew', () => {
    expect(resumesJob('unknown')).toBe(false)
})

describe('the turbo workflows', () => {
    test('a setting above the recommended size is only noticed - nothing is changed', () => {
        expect(aboveRecommended(1.2, '1344x768')).toBe(true)
        expect(aboveRecommended('1920x1088', '1344x768')).toBe(true)
        expect(aboveRecommended(0.6, '1344x768')).toBe(false)
        expect(aboveRecommended(-1, '1344x768')).toBe(false)
        expect(aboveRecommended(2, undefined)).toBe(false)
    })
    test('the turbo workflows build a graph with the shift and the simple scheduler', async () => {
        for (const name of ['h3-ref2video', 'h3-ref2video-cpu-clip', 'h3-ref2video-film']) {
            const module = await import(`../comfy/workflows/${name}.ts`)
            expect(module.recommendedResolution).toBe('1344x768')
            const {workflow, output} = module.default({prompt: 'p', pictures: ['a.png'], audios: ['d.wav'], song: 's.wav', songStart: 0, frames: 22, duration: 1, seed: 1, resolution: -1, filenamePrefix: 'x'})
            const nodes = Object.values(workflow.build({outputs: {result: output}}).workflow) as { class_type: string, inputs: Record<string, unknown> }[]
            expect(nodes.find(n => n.class_type === 'MiniMaxH3SigmaShift')?.inputs).toMatchObject({shift_video: 12, shift_audio: 3})
            expect(nodes.find(n => n.class_type === 'BasicScheduler')?.inputs).toMatchObject({scheduler: 'simple', steps: 8})
        }
    })
})

describe('the size of a render', () => {
    test("megapixels give the sizes ComfyUI's ResolutionSelector gave - computed here, the same on every server", () => {
        expect(pixelSize(2, 'landscape', 0.4)).toEqual({width: 1920, height: 1088})
        expect(pixelSize(0.5, 'landscape', 0.4)).toEqual({width: 960, height: 544})
        expect(pixelSize(1.2, 'landscape', 0.4)).toEqual({width: 1504, height: 832})
        expect(pixelSize(-1, 'portrait', 0.4)).toEqual({width: 480, height: 864})
        expect(pixelSize('720x1280', 'landscape', 0.4)).toEqual({width: 1280, height: 720})
    })
    test('videoAspect: landscape by default, portrait or any ratio when set - megapixels computed in it, a size kept and turned to it', () => {
        expect(pixelSize(2, '16:9', 0.4)).toEqual(pixelSize(2, 'landscape', 0.4))
        expect(pixelSize(2, '9:16', 0.4)).toEqual({width: 1088, height: 1920})
        expect(pixelSize(1, '2:3', 0.4)).toEqual({width: 832, height: 1248})
        expect(pixelSize(1, '2:1', 0.4)).toEqual({width: 1440, height: 736})
        expect(pixelSize('1920x1088', '9:16', 0.4)).toEqual({width: 1088, height: 1920})
        expect(pixelSize('1920x960', '16:9', 0.4)).toEqual({width: 1920, height: 960})
        expect(pixelSize('1024x1536', '2:3', 0.4)).toEqual({width: 1024, height: 1536})
        expect(pixelSize('1024x768', '1:1', 0.4)).toEqual({width: 1024, height: 768})
    })
    test('the clip workflows render in the aspect they are given', async () => {
        for (const name of ['h3-ref2video', 'h3-ref2video-full', 'h3-ref2video-2pass']) {
            const module = await import(`../comfy/workflows/${name}.ts`)
            const {size} = module.default({prompt: 'p', pictures: ['a.png'], audios: ['d.wav'], song: 's.wav', songStart: 0, frames: 22, duration: 1, seed: 1, resolution: 2, aspect: '9:16', filenamePrefix: 'x'})
            expect(size).toEqual({width: 1088, height: 1920})
        }
        expect(twoPassSizes(2, '9:16')).toEqual({final: {width: 1088, height: 1920}, first: {width: 544, height: 960}})
    })
    test('a clip workflow says the size it renders at - no size node on the server', async () => {
        for (const name of ['h3-ref2video', 'h3-ref2video-full', 'h3-ref2video-2pass']) {
            const module = await import(`../comfy/workflows/${name}.ts`)
            const {workflow, output, size} = module.default({prompt: 'p', pictures: ['a.png'], audios: ['d.wav'], song: 's.wav', songStart: 0, frames: 22, duration: 1, seed: 1, resolution: 1.2, filenamePrefix: 'x'})
            expect(size).toEqual({width: 1504, height: 832})
            const nodes = Object.values(workflow.build({outputs: {result: output}}).workflow) as { class_type: string }[]
            expect(nodes.some(n => n.class_type === 'ResolutionSelector')).toBe(false)
        }
    })
})

describe('the two-pass workflow', () => {
    test('the final size is the one every workflow computes, pass 1 renders half its width and height', () => {
        expect(twoPassSizes(-1)).toEqual({final: {width: 1920, height: 1088}, first: {width: 960, height: 544}})
        expect(twoPassSizes(1.2)).toEqual({final: pixelSize(1.2, 'landscape', 0.4), first: {width: 768, height: 416}})
        expect(twoPassSizes('1920x1088')).toEqual({final: {width: 1920, height: 1088}, first: {width: 960, height: 544}})
    })
    test('base model for 20 steps, the latent x2, then 2 turbo steps at denoise 0.2 - the guides set again on the large latent', async () => {
        const module = await import('../comfy/workflows/h3-ref2video-2pass.ts')
        const {workflow, output} = module.default({prompt: 'p', pictures: ['a.png'], audios: ['d.wav'], song: 's.wav', startFrame: 'f.png', songStart: 0, frames: 22, duration: 1, seed: 1, resolution: -1, filenamePrefix: 'x'})
        const nodes = Object.values(workflow.build({outputs: {result: output}}).workflow) as { class_type: string, inputs: Record<string, unknown> }[]
        expect(nodes.filter(n => n.class_type === 'BasicScheduler').map(n => n.inputs)).toMatchObject([{steps: 20, denoise: 1}, {steps: 2, denoise: 0.2}])
        expect(nodes.find(n => n.class_type === 'MinimaxH3LatentUpscaler3D')?.inputs).toMatchObject({mode: 'target dimensions', 'mode.width': 1920, 'mode.height': 1088})
        expect(nodes.filter(n => n.class_type === 'MiniMaxH3AddGuide')).toHaveLength(4)
        expect(nodes.filter(n => n.class_type === 'SamplerCustomAdvanced')).toHaveLength(2)
    })
})

describe('context frames in the clip workflows', () => {
    test('a start clip is loaded as a frame batch and locked to frame 0, in both passes of the two-pass workflow', async () => {
        for (const [name, guides] of [['h3-ref2video', 1], ['h3-ref2video-2pass', 2]] as const) {
            const module = await import(`../comfy/workflows/${name}.ts`)
            const {workflow, output} = module.default({prompt: 'p', pictures: ['a.png'], audios: ['d.wav'], song: 's.wav', startClip: 'tail.mp4', songStart: 0, frames: 39, duration: 2, seed: 1, resolution: 1.2, filenamePrefix: 'x'})
            const nodes = workflow.build({outputs: {result: output}}).workflow as Record<string, { class_type: string, inputs: Record<string, unknown> }>
            const load = Object.entries(nodes).find(([, n]) => n.class_type === 'VHS_LoadVideo')!
            expect(load[1].inputs.video).toBe('tail.mp4')
            const imageGuides = Object.values(nodes).filter(n => n.class_type === 'MiniMaxH3AddGuide' && Array.isArray(n.inputs.image) && (n.inputs.image as unknown[])[0] === load[0])
            expect(imageGuides).toHaveLength(guides)
            expect(Object.values(nodes).some(n => n.class_type === 'LoadImage' && n.inputs.image === 'tail.mp4')).toBe(false)
        }
    })
})
