import {mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, test} from 'bun:test'
import {loadSettings, maskSecret, normalizeUrl, parseComfyEntries, readSettingsFile} from './settings.ts'

const envKeys = [
    'FEVERSLOP_SETTINGS',
    'FEVERSLOP_LLM_URL',
    'FEVERSLOP_LLM_API_KEY',
    'FEVERSLOP_LLM_MODEL',
    'FEVERSLOP_LLM_PARALLEL',
    'FEVERSLOP_VISION_URL',
    'FEVERSLOP_VISION_API_KEY',
    'FEVERSLOP_VISION_MODEL',
    'FEVERSLOP_COMFY',
    'COMFY',
]
const originalEnv = new Map(envKeys.map(key => [key, process.env[key]]))
const directories: string[] = []

afterEach(() => {
    for (const key of envKeys) {
        const value = originalEnv.get(key)
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
    }
    for (const directory of directories.splice(0)) rmSync(directory, {recursive: true, force: true})
})

function settingsFile(contents: string) {
    const directory = mkdtempSync(join(tmpdir(), 'feverslop-settings-test-'))
    directories.push(directory)
    const file = join(directory, 'settings.json')
    writeFileSync(file, contents)
    process.env.FEVERSLOP_SETTINGS = file
    return file
}

describe('settings', () => {
    test('layers defaults, file, project, environment and flags in order and reports each source', async () => {
        settingsFile(JSON.stringify({llm: {url: 'https://file.example/v1/', apiKey: 'file-key', model: 'file-model', parallel: 2}}))
        process.env.FEVERSLOP_LLM_URL = 'https://env.example/v1/'
        process.env.FEVERSLOP_LLM_API_KEY = 'env-key'
        process.env.FEVERSLOP_LLM_MODEL = 'env-model'
        process.env.FEVERSLOP_LLM_PARALLEL = '3'

        const result = await loadSettings({
            projectModel: 'project-model',
            llmUrl: 'https://flag.example/v1/',
            llmApiKey: 'flag-key',
            llmModel: 'flag-model',
            llmParallel: '4',
        })

        expect(result.llm).toEqual({url: 'https://flag.example/v1', apiKey: 'flag-key', model: 'flag-model', parallel: 4})
        expect(result.sources).toMatchObject({llmUrl: 'flag', llmApiKey: 'flag', llmModel: 'flag', llmParallel: 'flag'})
        expect((await loadSettings({projectModel: 'project-model'})).llm.model).toBe('env-model')
        expect((await loadSettings({})).sources.llmModel).toBe('env')
        delete process.env.FEVERSLOP_LLM_URL
        delete process.env.FEVERSLOP_LLM_API_KEY
        delete process.env.FEVERSLOP_LLM_MODEL
        delete process.env.FEVERSLOP_LLM_PARALLEL
        expect((await loadSettings({projectModel: 'project-model'})).llm.model).toBe('project-model')
        expect((await loadSettings({projectModel: 'project-model'})).sources.llmModel).toBe('project')
        expect((await loadSettings()).llm).toMatchObject({url: 'https://file.example/v1', apiKey: 'file-key', model: 'file-model', parallel: 2})
    })

    test('keeps credentials for matching file servers while merging and deduplicating Comfy entries', async () => {
        settingsFile(JSON.stringify({comfy: [{url: 'http://gpu:8188', name: 'render', token: 'secret'}]}))
        process.env.FEVERSLOP_COMFY = 'gpu:8188,https://other.example/'

        const result = await loadSettings()

        expect(result.comfy).toEqual([
            {url: 'http://gpu:8188', name: 'render', credentials: {type: 'bearer_token', token: 'secret'}},
            {url: 'https://other.example', name: 'other.example'},
        ])
        expect(result.sources.comfy).toBe('env')
        expect(parseComfyEntries(['gpu:8188', {url: 'http://gpu:8188', name: 'gpu:8188'}], 'test').map(server => server.name)).toEqual([
            'gpu:8188',
            'gpu:8188-2',
        ])
    })

    test('normalizes scheme-less URLs and rejects unsupported schemes', () => {
        expect(normalizeUrl('  gpu:8188/  ', 'test')).toBe('http://gpu:8188')
        expect(() => normalizeUrl('file:///tmp/server', 'test')).toThrow('must start with http:// or https://')
    })

    test('masks secrets without exposing short keys or the middle of long keys', () => {
        expect(maskSecret('12345678')).toBe('••••••••')
        expect(maskSecret('sk-abcdefghij')).toBe('sk-…ij (13 chars)')
    })

    test('returns empty settings for a missing file and explains invalid JSON with its path', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'feverslop-settings-missing-'))
        directories.push(directory)
        const missing = join(directory, 'settings.json')
        process.env.FEVERSLOP_SETTINGS = missing
        expect(await readSettingsFile()).toEqual({})

        const invalid = settingsFile('{')
        await expect(readSettingsFile()).rejects.toThrow(`${invalid}: not valid JSON`)
    })

    test('uses defaults when no settings file or environment overrides exist', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'feverslop-settings-defaults-'))
        directories.push(directory)
        process.env.FEVERSLOP_SETTINGS = join(directory, 'missing.json')

        const result = await loadSettings()

        expect(result.llm).toEqual({parallel: 1})
        expect(result.comfy).toEqual([{url: 'http://localhost:8188', name: 'localhost:8188'}])
        expect(Object.values(result.sources)).toEqual(Array(8).fill('default'))
    })

    test('retains a vision API key when no separate vision URL or model is set', async () => {
        settingsFile(JSON.stringify({llm: {vision: {apiKey: 'file-vision-key'}}}))
        expect((await loadSettings()).llm.vision).toEqual({apiKey: 'file-vision-key'})
        expect((await loadSettings()).sources.visionApiKey).toBe('file')

        process.env.FEVERSLOP_VISION_API_KEY = 'env-vision-key'
        expect((await loadSettings()).llm.vision).toEqual({apiKey: 'env-vision-key'})
        expect((await loadSettings()).sources.visionApiKey).toBe('env')
    })
})
