import {describe, expect, test} from "bun:test";
import {accumulatePhases, describeGraph, describeMachine, type Graph, phaseOf} from "./graph.ts";

// a small video graph like the H3 workflows: loaders, a turbo LoRA, a sampler, size and frames through primitive nodes
const graph = (options: { lora?: boolean, prompt?: string, seed?: number, frames?: number, refs?: number, steps?: number } = {}): Graph => {
    const {lora = true, prompt = 'a dwarf sings', seed = 1, frames = 22, refs = 2, steps = 8} = options
    const g: Graph = {
        '1': {class_type: 'UNETLoader', inputs: {unet_name: 'minimax.safetensors', weight_dtype: 'default'}},
        '2': {class_type: 'VAELoader', inputs: {vae_name: 'vae.safetensors'}},
        '3': {class_type: 'PrimitiveInt', inputs: {value: frames}},
        '4': {class_type: 'PrimitiveInt', inputs: {value: 1280}},
        '5': {class_type: 'PrimitiveInt', inputs: {value: 720}},
        '6': {class_type: 'PrimitiveStringMultiline', inputs: {value: prompt}},
        '7': {class_type: 'KSampler', inputs: {model: [lora ? '8' : '1', 0], seed, steps, cfg: 1, sampler_name: 'euler', scheduler: 'simple', positive: ['9', 0]}},
        '9': {class_type: 'MiniMaxH3ReferenceToVideo', inputs: {prompt: ['6', 0], width: ['4', 0], height: ['5', 0], length: ['3', 0]}},
    }
    if (lora) g['8'] = {class_type: 'LoraLoaderModelOnly', inputs: {lora_name: 'turbo.safetensors', strength_model: 0.8, model: ['1', 0]}}
    for (let i = 0; i < refs; i++) {
        g[`2${i}0`] = {class_type: 'LoadImage', inputs: {image: `pictures/c${i}.png`}}
        g['9']!.inputs[`ref_images.ref_image_${i}`] = [`2${i}0`, 0]
    }
    return g
}

describe('describeGraph', () => {
    test('reads the knobs from the graph', () => {
        const {setup} = describeGraph(graph())
        expect(setup.models).toEqual(['unet_name=minimax.safetensors', 'vae_name=vae.safetensors'])
        expect(setup.loras).toEqual([{file: 'turbo.safetensors', strength: 0.8}])
        expect(setup).toMatchObject({steps: [8], cfg: [1], sampler: ['euler'], scheduler: ['simple'], width: 1280, height: 720, pixels: 921600, frames: 22})
    })
    test('the size chosen on the server comes from the megapixels', () => {
        const {setup} = describeGraph({'1': {class_type: 'ResolutionSelector', inputs: {megapixels: 0.4, multiple: 32}}})
        expect(setup).toMatchObject({megapixels: 0.4, pixels: 400000})
    })
    test('the attention backend is found by its input or its node', () => {
        const {setup} = describeGraph({
            '1': {class_type: 'PathchSageAttentionKJ', inputs: {sage_attention: 'auto'}},
        })
        expect(setup.attention).toEqual(['sage_attention=auto', 'PathchSageAttentionKJ'])
    })
})

describe('variant id', () => {
    const variant = (options?: Parameters<typeof graph>[0]) => describeGraph(graph(options)).variant
    test('the same knobs give the same id whatever the job carries', () => {
        expect(variant({prompt: 'another prompt', seed: 99, frames: 39, refs: 4})).toBe(variant())
    })
    test('a changed knob is another variant', () => {
        expect(variant({lora: false})).not.toBe(variant())
        expect(variant({steps: 4})).not.toBe(variant())
    })
})

describe('phases', () => {
    test('node classes map to the phase they spend time in', () => {
        expect(phaseOf('UNETLoader')).toBe('load')
        expect(phaseOf('LoadImage')).toBe('other')
        expect(phaseOf('KSampler')).toBe('sampling')
        expect(phaseOf('VAEDecodeTiled')).toBe('decode')
        expect(phaseOf('VHS_VideoCombine')).toBe('save')
    })
    test('a node runs until the next one starts, the last one until the end', () => {
        const phases = accumulatePhases([
            {classType: 'UNETLoader', at: 0}, {classType: 'VAELoader', at: 4_000},
            {classType: 'KSampler', at: 5_000}, {classType: 'VAEDecode', at: 35_000}, {classType: 'SaveImage', at: 38_000},
        ], 39_000)
        expect(phases).toEqual({load: 5, sampling: 30, decode: 3, save: 1})
    })
})

test('describeMachine names the GPU, its memory and the versions', () => {
    expect(describeMachine({
        system: {comfyui_version: '0.3.60', pytorch_version: '2.8.0', python_version: '3.12.3 (main)'},
        devices: [{name: 'cuda:0 NVIDIA GeForce RTX 4090 : cudaMallocAsync', vram_total: 25757220864}],
    })).toEqual({gpu: 'NVIDIA GeForce RTX 4090', vramGb: 24, versions: 'comfyui 0.3.60, torch 2.8.0, python 3.12.3'})
    expect(describeMachine({})).toEqual({})
})
