import {afterAll, beforeAll, describe, expect, test} from 'bun:test'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {loadProjectConfig} from '../config.ts'
import type {ClipRequest} from '../compose.ts'
import {clipFingerprint} from '../render.ts'
import {previewConfig, readConfig, workflowsByKind, writeConfig} from './projectconfig.ts'
import type {EditorTarget} from './project.ts'

// The settings of a project: what the Settings page shows, and what a change would do (#576)
let root: string
const write = (file: string, content: unknown) => {
    mkdirSync(dirname(file), {recursive: true})
    writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2))
}
const music = (): EditorTarget => ({id: 'music', kind: 'music', dir: join(root, 'projects', 'music')})
const film = (): EditorTarget => ({id: 'film', kind: 'film', dir: join(root, 'films', 'film')})
const configOf = (target: EditorTarget) => JSON.parse(readFileSync(join(target.dir, 'config.json'), 'utf8'))

beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'project-config-'))
    write(join(music().dir, 'config.json'), {singers: ['elias'], videoWorkflow: 'h3-ref2video-2pass', contextFrames: 22})
    write(join(film().dir, 'project.json'), {})
    // one clip rendered from the plan as it is: current - until the settings it is made from change
    const request: ClipRequest = {
        id: 'slot-001',
        index: 1,
        start: 0,
        end: 2,
        duration: 2,
        frameStart: 0,
        frames: 48,
        section: 'Verse',
        beatId: 'b1',
        shots: [],
        assets: {pictures: [], audio: []},
        prompt: 'a prompt',
    } as unknown as ClipRequest
    write(join(music().dir, 'output/clips/slot-001.json'), request)
    write(join(music().dir, 'videos/slot-001.mp4'), '0123456789')
    write(join(music().dir, 'videos/slot-001.mp4.json'), {fingerprint: clipFingerprint(request, music().dir, await loadProjectConfig(music().dir))})
})
afterAll(() => rmSync(root, {recursive: true, force: true}))

describe('what the project has', () => {
    test('every setting with its value, its default, and whether config.json has it; other keys are not offered', async () => {
        const {settings} = await readConfig(music())
        const by = (key: string) => settings.find(s => s.key === key)!
        expect(by('videoWorkflow')).toMatchObject({value: 'h3-ref2video-2pass', default: 'h3-ref2video', own: true, control: 'select', group: 'Workflows'})
        expect(by('videoAspect')).toMatchObject({value: '16:9', own: false})
        expect(by('contextFrames')).toMatchObject({value: 22, default: 0, own: true, control: 'number'})
        expect(settings.some(s => s.key === 'singers')).toBe(false)
    })
    test('the workflows offered are the ones of that kind, the film its own, and the one the project has is always among them', async () => {
        const choices = (settings: Awaited<ReturnType<typeof readConfig>>['settings']) =>
            settings.find(s => s.key === 'videoWorkflow')!.choices!.map(c => c.value)
        const music1 = choices((await readConfig(music())).settings)
        expect(music1).toContain('h3-ref2video-prism-2pass')
        expect(music1).not.toContain('h3-ref2video-film-2pass')
        expect(music1).not.toContain('krea2-image')
        const film1 = choices((await readConfig(film())).settings)
        expect(film1).toContain('h3-ref2video-film-prism-2pass')
        expect(film1).not.toContain('h3-ref2video-2pass')
        write(join(root, 'films', 'own', 'config.json'), {videoWorkflow: 'h3-ref2video-film-beta'})
        expect(workflowsByKind().image).toEqual(expect.arrayContaining(['kroma-image', 'krea2-image']))
    })
    test("a film has the film's settings: no sheet workflow, no pinned first frame", async () => {
        const keys = (await readConfig(film())).settings.map(s => s.key)
        expect(keys).toContain('qaRetries')
        expect(keys).not.toContain('sequenceWorkflow')
        expect(keys).not.toContain('pinStartFrame')
    })
    test('continuity is set here too, with the choices of the kind', async () => {
        const choices = async (target: EditorTarget) => (await readConfig(target)).settings.find(s => s.key === 'continuity')!.choices!.map(c => c.value)
        expect(await choices(music())).toEqual(['never', 'auto', 'always'])
        expect(await choices(film())).toEqual(['never', 'auto', 'scene'])
        expect((await previewConfig(music(), {continuity: 'scene'})).problems[0]).toContain('continuity must be')
        expect((await previewConfig(music(), {continuity: 'auto'})).notes.join(' ')).not.toContain('does nothing')
        expect((await previewConfig(music(), {continuity: 'never'})).notes.join(' ')).toContain('does nothing')
    })
})

describe('what a change would do', () => {
    test('a value the loader refuses is said in its words, and nothing else is promised', async () => {
        expect((await previewConfig(music(), {contextFrames: 20})).problems).toEqual(['contextFrames must be 0 (off) or 5 + 17·k frames - 22 or 39 - got 20'])
        expect((await previewConfig(music(), {videoWorkflow: 'nope'})).problems).toEqual(['videoWorkflow: no workflow comfy/workflows/nope.ts'])
        expect((await previewConfig(music(), {singers: ['x']})).problems[0]).toContain('not a setting here')
    })
    test('the keys that change - a value the file has already is no change - and a rendered clip it makes stale', async () => {
        expect(await previewConfig(music(), {contextFrames: 22})).toMatchObject({
            problems: [],
            changed: [],
            stale: {clips: [], pictures: []},
            rendered: {clips: 1, pictures: 0},
        })
        // not part of what a clip is made from
        expect(await previewConfig(music(), {leakRetries: 1, finalFps: 48})).toMatchObject({changed: ['leakRetries', 'finalFps'], stale: {clips: []}})
        // the workflow and the size are
        expect((await previewConfig(music(), {videoWorkflow: 'h3-ref2video-prism-2pass'})).stale.clips).toEqual(['slot-001'])
        expect((await previewConfig(music(), {videoResolution: 1.2})).stale.clips).toEqual(['slot-001'])
        // back to the default - null - is a change too
        expect((await previewConfig(music(), {videoWorkflow: null})).stale.clips).toEqual(['slot-001'])
    })
    test('what is only said: retries that a fixed seed makes useless, and many retries - never lowered', async () => {
        expect((await previewConfig(music(), {seed: 7, qaRetries: 1})).notes.join(' ')).toContain('fixed seed')
        const many = await previewConfig(music(), {qaRetries: 5})
        expect(many.problems).toEqual([])
        expect(many.notes.join(' ')).toContain('qaRetries 5')
    })
})

describe('writing it', () => {
    test('what is changed is written and the rest of config.json stays; null takes a key back out; nothing wrong is written', async () => {
        const target = {id: 'written', kind: 'music' as const, dir: join(root, 'projects', 'written')}
        write(join(target.dir, 'config.json'), {singers: ['elias'], seed: 5})
        expect(await writeConfig(target, {videoAspect: '9:16', seed: null})).toMatchObject({written: true, changed: ['videoAspect', 'seed']})
        expect(configOf(target)).toEqual({singers: ['elias'], videoAspect: '9:16'})
        const before = readFileSync(join(target.dir, 'config.json'), 'utf8')
        expect(await writeConfig(target, {videoAspect: 'wide'})).toMatchObject({
            written: false,
            problems: [expect.stringContaining('videoAspect must be an aspect ratio')],
        })
        expect(await writeConfig(target, {videoAspect: '9:16'})).toMatchObject({written: false, changed: []})
        expect(readFileSync(join(target.dir, 'config.json'), 'utf8')).toBe(before)
        expect(existsSync(join(target.dir, 'config.json.tmp'))).toBe(false)
    })
    test('a project without a config.json gets one; while a run holds the project nothing is written', async () => {
        const target = {id: 'fresh', kind: 'film' as const, dir: join(root, 'films', 'fresh')}
        mkdirSync(target.dir, {recursive: true})
        expect((await writeConfig(target, {qaRetries: 1})).written).toBe(true)
        expect(configOf(target)).toEqual({qaRetries: 1})
        // a run of another process holds it (the parent of this one is alive)
        writeFileSync(join(target.dir, '.lock'), String(process.ppid))
        await expect(writeConfig(target, {qaRetries: 2})).rejects.toThrow('another run')
        expect(configOf(target)).toEqual({qaRetries: 1})
        rmSync(join(target.dir, '.lock'))
    })
})
