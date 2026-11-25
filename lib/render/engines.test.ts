import {afterAll, describe, expect, test} from 'bun:test'
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {defaults} from '../config.ts'
import {Renderer, type RenderWhat, type Server, type Wan2gpServer} from '../render.ts'
import type {BridgeClient, BridgeJob} from '../wan2gp.ts'

const dir = mkdtempSync(join(tmpdir(), 'engines-'))
afterAll(() => rmSync(dir, {recursive: true, force: true}))

/** A bridge that renders at once: it keeps what it was sent, and its video is the job's settings. */
function fakeBridge(fail?: string) {
    const sent: Record<string, unknown>[] = []
    const uploaded: string[] = []
    const job = (status: BridgeJob['status']): BridgeJob => ({
        id: 'j1',
        kind: 'generate',
        status,
        created: 0,
        finished: 1,
        progress: {},
        files: status === 'done' ? [{index: 0, name: 'take.mp4'}] : [],
        errors: fail ? [fail] : [],
    })
    const bridge = {
        base: 'http://w/feverslop',
        health: async () => ({bridge: 1, wangp: 'test'}),
        upload: async (file: string) => {
            uploaded.push(file)
            return `${'a'.repeat(32)}.png`
        },
        generate: async (settings: Record<string, unknown>) => {
            sent.push(settings)
            return job('queued')
        },
        job: async () => job(fail ? 'failed' : 'done'),
        cancel: async () => job('cancelled'),
        download: async () => new TextEncoder().encode(JSON.stringify(sent.at(-1))).buffer,
        models: async () => [],
        postprocess: async () => job('queued'),
    }
    return {bridge: bridge as unknown as BridgeClient, sent, uploaded}
}

function renderer(comfy: number, bridges: Wan2gpServer[]) {
    const r = new Renderer('p', dir, defaults as never, [{url: 'http://x', name: 'x'}])
    r.connected = Array.from({length: comfy}, (_, i) => ({url: `http://c${i}`, name: `c${i}`, api: {}}) as unknown as Server)
    r.bridges = bridges
    r.ready = Promise.resolve(r.connected)
    return r
}
const wan2gpServer = (bridge: BridgeClient): Wan2gpServer => ({url: 'http://w', name: 'w', engine: 'wan2gp', bridge})
const what: RenderWhat = {label: 'clip c1', spec: {id: 'c1', parts: ['c1']} as never, kind: 'clip', workflow: 'h3-ref2video'}

describe('ComfyUI and wan2gp servers in one pool (#1204)', () => {
    test('a job with a wan2gp form takes the free wan2gp server while the ComfyUI one is busy; one without it waits for ComfyUI', async () => {
        const r = renderer(1, [wan2gpServer(fakeBridge().bridge)])
        expect((await r.acquire()).name).toBe('c0')
        expect((await r.acquire(undefined, true)).name).toBe('w')
        let got = ''
        void r.acquire().then(s => (got = s.name))
        await Bun.sleep(5)
        expect(got).toBe('')
        r.release(r.connected[0]!)
        await Bun.sleep(5)
        expect(got).toBe('c0')
    })
    test('with wan2gp servers only, a job without a wan2gp form is refused at once, with the reason', async () => {
        const r = renderer(0, [wan2gpServer(fakeBridge().bridge)])
        expect(r.acquire()).rejects.toThrow('this job has no wan2gp form')
        expect((await r.acquire(undefined, true)).name).toBe('w')
    })
    test('render: on a wan2gp server the job goes through the bridge, its local inputs uploaded, its video saved as the target', async () => {
        const {bridge, sent, uploaded} = fakeBridge()
        const r = renderer(0, [wan2gpServer(bridge)])
        const picture = join(dir, 'singer.png')
        writeFileSync(picture, 'p')
        const target = join(dir, 'c1.mp4')
        const meta = await r.render(
            what,
            target,
            '.mp4',
            () => Promise.reject(new Error('the ComfyUI form is not asked for')),
            async () => ({settings: {template: 't/x', image_refs: [picture]}, meta: {seed: 5}, engine: 'wan2gp:t/x'}),
        )
        expect(meta).toEqual({seed: 5})
        expect(uploaded).toEqual([picture])
        expect(sent[0]!.image_refs).toEqual([`${'a'.repeat(32)}.png`])
        expect(JSON.parse(readFileSync(target, 'utf8'))).toMatchObject({template: 't/x'})
        expect(existsSync(`${target}.download`)).toBe(false)
    })
    test('render: a job wan2gp says failed is a failure of the job, named with its server', async () => {
        const {bridge} = fakeBridge('out of memory')
        const r = renderer(0, [wan2gpServer(bridge)])
        expect(
            r.render(
                what,
                join(dir, 'c2.mp4'),
                '.mp4',
                () => Promise.reject(new Error('no')),
                async () => ({settings: {template: 't/x'}, meta: {}, engine: 'wan2gp:t/x'}),
            ),
        ).rejects.toThrow('out of memory')
    })
    test('render: a job without a wan2gp form says why and waits for ComfyUI', async () => {
        const r = renderer(0, [wan2gpServer(fakeBridge().bridge)])
        expect(
            r.render(
                what,
                join(dir, 'c3.mp4'),
                '.mp4',
                () => Promise.reject(new Error('no')),
                async () => 'it has 4 audio references',
            ),
        ).rejects.toThrow('this job has no wan2gp form')
    })
})
