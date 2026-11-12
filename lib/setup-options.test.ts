import {expect, test} from 'bun:test'
import {changeSettings, givesSetup} from './setup-options.ts'

// #827: the settings changed by options - for a script and for the workspace's Machine panel
test('the LLM server: URL, key, model, calls at once; "-" takes a key or model out', () => {
    expect(givesSetup({})).toBe(false)
    expect(givesSetup({off: true})).toBe(true)
    const {file, said} = changeSettings({}, 'llm', {url: 'localhost:8080/v1', key: 'k', model: 'm', parallel: '2'})
    expect(file).toEqual({llm: {url: 'http://localhost:8080/v1', apiKey: 'k', model: 'm', parallel: 2}})
    expect(said[0]).toContain('http://localhost:8080/v1, model m, with a key, 2 calls at once')
    // what is not given stays; the vision settings stay with it
    const kept = changeSettings({llm: {url: 'http://a/v1', apiKey: 'k', model: 'm', vision: {model: 'v'}}}, 'llm', {model: '-', key: '-'}).file
    expect(kept).toEqual({llm: {url: 'http://a/v1', vision: {model: 'v'}}})
    expect(() => changeSettings({}, 'llm', {model: 'm'})).toThrow('--url: the LLM server')
    expect(() => changeSettings({}, 'llm', {url: 'http://a/v1', parallel: '0'})).toThrow('--parallel')
})

test('the vision model, and off again', () => {
    const on = changeSettings({llm: {url: 'http://a/v1'}}, 'vision', {model: 'v'}).file
    expect(on).toEqual({llm: {url: 'http://a/v1', vision: {model: 'v'}}})
    expect(changeSettings(on, 'vision', {off: true}).file).toEqual({llm: {url: 'http://a/v1'}})
    expect(() => changeSettings({}, 'vision', {key: 'k'})).toThrow('--url and/or --model')
})

test('ComfyUI servers added and removed, by name or URL', () => {
    const one = changeSettings({}, 'comfy', {add: 'gpu1.lan:8188', name: 'gpu1'}).file
    expect(one).toEqual({comfy: [{url: 'http://gpu1.lan:8188', name: 'gpu1'}]})
    const two = changeSettings(one, 'comfy', {add: 'http://gpu2.lan:8188'}).file
    expect(two.comfy).toEqual([{url: 'http://gpu1.lan:8188', name: 'gpu1'}, 'http://gpu2.lan:8188'])
    expect(() => changeSettings(two, 'comfy', {add: 'gpu2.lan:8188'})).toThrow('is there already')
    expect(changeSettings(two, 'comfy', {remove: 'gpu1'}).file.comfy).toEqual(['http://gpu2.lan:8188'])
    // the last one gone: the default server again
    expect(changeSettings(one, 'comfy', {remove: 'http://gpu1.lan:8188'}).file).toEqual({})
    expect(() => changeSettings(two, 'comfy', {remove: 'gpu9'})).toThrow('--remove: no server "gpu9"')
    expect(() => changeSettings({}, 'whisper', {url: 'x'})).toThrow('takes no options')
})
