import {expect, test} from 'bun:test'
import {describeRejection} from './comfy-rejection.ts'

test('a node that is not installed is named', () => {
    const body = JSON.stringify({error: {type: 'missing_node_type', message: "Node 'MinimaxH3LatentUpscaler3D' not found. The custom node may not be installed.", details: "Node ID '#12'", extra_info: {node_id: '12', class_type: 'MinimaxH3LatentUpscaler3D'}}, node_errors: {}})
    expect(describeRejection('gpu1', body)).toBe('ComfyUI gpu1 rejected the workflow - node not installed: MinimaxH3LatentUpscaler3D')
})

test('a model the loader does not list is named, with its input and node', () => {
    const body = JSON.stringify({
        error: {type: 'prompt_outputs_failed_validation', message: 'Prompt outputs failed validation', details: '', extra_info: {}},
        node_errors: {'7': {errors: [{type: 'value_not_in_list', message: 'Value not in list', details: "model_name: 'x.safetensors' not in ['a.safetensors', 'b.safetensors']", extra_info: {input_name: 'model_name', received_value: 'x.safetensors'}}], class_type: 'UpscaleModelLoader'}},
    })
    expect(describeRejection('gpu1', body)).toBe('ComfyUI gpu1 rejected the workflow - model not on the server: x.safetensors (model_name of UpscaleModelLoader)')
})

test('nodes and models come first, other problems after them, and the first 200 characters hold the names', () => {
    const body = JSON.stringify({
        error: {type: 'prompt_outputs_failed_validation', message: 'Prompt outputs failed validation', details: '', extra_info: {}},
        node_errors: {
            '3': {errors: [{type: 'missing_node_type', message: 'x', extra_info: {class_type: 'VRAMCleanup'}}], class_type: 'VRAMCleanup'},
            '7': {errors: [{type: 'value_not_in_list', message: 'Value not in list', extra_info: {input_name: 'ckpt_name', received_value: 'm.safetensors'}}], class_type: 'CheckpointLoaderSimple'},
            '9': {errors: [{type: 'required_input_missing', message: 'Required input is missing', details: 'image'}], class_type: 'LoadImage'},
        },
    })
    const message = describeRejection('gpu1', body)
    expect(message).toContain('node not installed: VRAMCleanup')
    expect(message).toContain('model not on the server: m.safetensors (ckpt_name of CheckpointLoaderSimple)')
    expect(message).toContain('LoadImage: Required input is missing: image')
    expect(message.slice(0, 200)).toContain('VRAMCleanup')
})

test('a body that is not ComfyUI JSON comes back as it is', () => {
    expect(describeRejection('gpu1', 'Bad Gateway')).toBe('ComfyUI gpu1 rejected the workflow - Bad Gateway')
})
