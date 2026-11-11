import {afterAll, beforeAll, describe, expect, test} from 'bun:test'
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {doctor, firstFix, type Probes} from './doctor.ts'

// #828: what the machine has and what to do about what it lacks. The servers and the PATH are stood in for: no server is asked.
const dir = mkdtempSync(join(tmpdir(), 'doctor-'))
const before = {...process.env}
const settings = (content: object | undefined) => {
    const file = join(dir, `settings-${Math.random().toString(36).slice(2)}.json`)
    if (content) writeFileSync(file, JSON.stringify(content))
    process.env.FEVERSLOP_SETTINGS = file
}
beforeAll(() => {
    for (const name of Object.keys(process.env)) if (name.startsWith('FEVERSLOP_') || name === 'COMFY') delete process.env[name]
    process.env.FEVERSLOP_LIBRARY = join(dir, 'library')
})
afterAll(() => {
    for (const name of Object.keys(process.env)) if (name.startsWith('FEVERSLOP_')) delete process.env[name]
    Object.assign(process.env, before)
    rmSync(dir, {recursive: true, force: true})
})

const there: Probes = {
    models: async () => ['a-model'],
    pictures: async () => true,
    comfy: async () => ({device: 'cuda:0 Some GPU', freeGb: 24}),
    onPath: () => true,
    freeGb: () => 500,
}
const state = (checks: Awaited<ReturnType<typeof doctor>>) => Object.fromEntries(checks.map(check => [check.what, check.state]))

describe('doctor', () => {
    test('a machine with nothing set up: what a run needs is missing, each with its fix', async () => {
        settings(undefined)
        const gone = async () => {
            throw new Error('ECONNREFUSED')
        }
        const checks = await doctor({...there, models: gone, comfy: gone, onPath: program => program !== 'uv'})
        expect(state(checks)).toMatchObject({
            'Settings file': 'note',
            'LLM server': 'missing',
            'ComfyUI localhost:8188': 'missing',
            ffmpeg: 'ready',
            uv: 'missing',
        })
        expect(checks.find(c => c.what === 'LLM server')?.fix).toBe('bun run setup llm')
        // no server was ever set: the address is the default, and the fix says so
        expect(checks.find(c => c.what === 'ComfyUI localhost:8188')?.fix).toContain('no server is set')
        expect(firstFix(checks)).toBe('LLM server: bun run setup llm')
        // everything that is not ready says what to do
        for (const check of checks.filter(c => c.state === 'missing')) expect(check.fix).toBeTruthy()
    })

    test('everything there: nothing missing, nothing to fix', async () => {
        settings({llm: {url: 'http://llm/v1'}, comfy: [{url: 'http://gpu:8188', name: 'gpu'}]})
        const checks = await doctor(there)
        expect(checks.filter(c => c.state === 'missing')).toEqual([])
        expect(firstFix(checks)).toBeUndefined()
        expect(checks.find(c => c.what === 'ComfyUI gpu')?.found).toBe('http://gpu:8188 · cuda:0 Some GPU · 24 GB free')
        expect(checks.find(c => c.what === 'LLM model')?.found).toBe('a-model')
    })

    test('one of two render servers down is a note: the other one renders', async () => {
        settings({
            llm: {url: 'http://llm/v1'},
            comfy: [
                {url: 'http://a:8188', name: 'a'},
                {url: 'http://b:8188', name: 'b'},
            ],
        })
        const checks = await doctor({
            ...there,
            comfy: async server => {
                if (server.name === 'a') throw new Error('down')
                return {}
            },
        })
        expect(state(checks)).toMatchObject({'ComfyUI a': 'note', 'ComfyUI b': 'ready'})
        expect(firstFix(checks)).toBeUndefined()
    })

    test('the model: a configured one that the server does not have, several and none chosen', async () => {
        settings({llm: {url: 'http://llm/v1', model: 'wanted'}})
        const absent = await doctor({...there, models: async () => ['other']})
        expect(absent.find(c => c.what === 'LLM model')).toMatchObject({state: 'missing', fix: 'bun run setup llm-model'})
        settings({llm: {url: 'http://llm/v1'}})
        const several = await doctor({...there, models: async () => ['a', 'b']})
        expect(several.find(c => c.what === 'LLM model')?.found).toContain('several models and none chosen')
    })

    test('a model that takes no pictures is a note with what it is needed for', async () => {
        settings({llm: {url: 'http://llm/v1'}})
        const checks = await doctor({...there, pictures: async () => false})
        expect(checks.find(c => c.what === 'Reading pictures')).toMatchObject({state: 'note', fix: 'bun run setup vision'})
    })
})
