import {describe, expect, test} from "bun:test";
import {mkdtempSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {WorkflowResult} from "../comfy/helpers.ts";
import {loadProjectConfig, stepsProblem} from "./config.ts";
import {clipSpec, specId} from "./render-spec.ts";
import {stepOptions} from "./render.ts";

// videoSteps / videoRefineSteps in config.json: what the workflows sample with, and that a change makes a clip stale

type Node = { class_type: string, inputs: Record<string, unknown> }
const schedulers = async (name: string, opts: object) => {
    const result: WorkflowResult = (await import(`../comfy/workflows/${name}.ts`)).default({
        prompt: 'p', pictures: ['fs/a.png'], audios: ['fs/drums.wav'], song: 'fs/song.wav', songStart: 0, frames: 73, duration: 3, seed: 1, resolution: -1, filenamePrefix: 'fs/x', ...opts,
    })
    const nodes = Object.values(result.workflow.build({outputs: {result: result.output}}).workflow as Record<string, Node>)
    return nodes.filter(n => n.class_type === 'BasicScheduler').map(n => ({steps: n.inputs.steps, denoise: n.inputs.denoise}))
}

describe('the steps of the workflows', () => {
    test('without them every workflow samples as it always did', async () => {
        expect(await schedulers('h3-ref2video', {})).toEqual([{steps: 8, denoise: 1}])
        expect(await schedulers('h3-ref2video-full', {})).toEqual([{steps: 20, denoise: 1}])
        expect(await schedulers('h3-ref2video-2pass', {})).toEqual([{steps: 20, denoise: 1}, {steps: 4, denoise: 0.2}])
        expect(await schedulers('h3-ref2video-prism-2pass', {})).toEqual([{steps: 4, denoise: 1}, {steps: 2, denoise: 0.2}])
    })
    test('steps is the one pass of a single-pass workflow', async () => {
        expect(await schedulers('h3-ref2video', {steps: 6})).toEqual([{steps: 6, denoise: 1}])
        expect(await schedulers('h3-ref2video-full', {steps: 12})).toEqual([{steps: 12, denoise: 1}])
    })
    test('steps is pass 1 and refineSteps pass 2 of a two-pass workflow, the denoise stays', async () => {
        expect(await schedulers('h3-ref2video-prism-2pass', {steps: 3})).toEqual([{steps: 3, denoise: 1}, {steps: 2, denoise: 0.2}])
        expect(await schedulers('h3-ref2video-prism-2pass', {refineSteps: 3})).toEqual([{steps: 4, denoise: 1}, {steps: 3, denoise: 0.2}])
        expect(await schedulers('h3-ref2video-prism-2pass', {steps: 3, refineSteps: 2})).toEqual([{steps: 3, denoise: 1}, {steps: 2, denoise: 0.2}])
        expect(await schedulers('h3-ref2video-2pass', {steps: 10, refineSteps: 2})).toEqual([{steps: 10, denoise: 1}, {steps: 2, denoise: 0.2}])
    })
    test('a preview keeps its own steps', async () => {
        expect(await schedulers('h3-ref2video', {steps: 6, preview: {scale: 0.25, steps: 2}})).toEqual([{steps: 2, denoise: 1}])
    })
    test('-1 gives the workflow nothing to override', () => {
        expect(stepOptions({videoSteps: -1, videoRefineSteps: -1})).toEqual({})
        expect(stepOptions({videoSteps: 3, videoRefineSteps: -1})).toEqual({steps: 3})
        expect(stepOptions({videoSteps: -1, videoRefineSteps: 2})).toEqual({refineSteps: 2})
    })
})

describe('the settings', () => {
    test('-1 or a whole number from 1', () => {
        for (const ok of [-1, 1, 3, 20]) expect(stepsProblem('videoSteps', ok)).toBeUndefined()
        for (const wrong of [0, -2, 2.5, '4', null]) expect(stepsProblem('videoSteps', wrong)).toContain('videoSteps must be -1')
    })
    test('config.json is checked as the other settings are', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'steps-'))
        expect(await loadProjectConfig(dir)).toMatchObject({videoSteps: -1, videoRefineSteps: -1})
        writeFileSync(join(dir, 'config.json'), JSON.stringify({videoSteps: 3, videoRefineSteps: 2}))
        expect(await loadProjectConfig(dir)).toMatchObject({videoSteps: 3, videoRefineSteps: 2})
        writeFileSync(join(dir, 'config.json'), JSON.stringify({videoRefineSteps: 0}))
        await expect(loadProjectConfig(dir)).rejects.toThrow('videoRefineSteps must be -1')
    })
})

describe('what a change makes stale', () => {
    const dir = mkdtempSync(join(tmpdir(), 'steps-spec-'))
    const clip = {id: 'slot-001', prompt: 'p', frames: 100, assets: {pictures: [], audio: []}}
    const video = {videoWorkflow: 'vid', videoResolution: -1}
    const id = (config: object) => specId(clipSpec(clip, dir, {...video, ...config}))
    test('the default leaves the id as it was, another value changes it', () => {
        const base = id({})
        expect(id({videoSteps: -1, videoRefineSteps: -1})).toBe(base)
        expect(id({videoSteps: 3})).not.toBe(base)
        expect(id({videoRefineSteps: 3})).not.toBe(base)
        expect(id({videoSteps: 3})).not.toBe(id({videoRefineSteps: 3}))
        expect(id({videoSteps: 3, videoRefineSteps: 2})).not.toBe(id({videoSteps: 3}))
    })
})
