import {describe, expect, test} from "bun:test";
import {aboveRecommended} from "../comfy/helpers.ts";
import {resumesJob} from "./render.ts";

test('a job that is queued, running or finished is resumed', () => {
    expect(resumesJob('queued')).toBe(true)
    expect(resumesJob('running')).toBe(true)
    expect(resumesJob('finished')).toBe(true)
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
