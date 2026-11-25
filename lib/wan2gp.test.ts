import {describe, expect, test} from 'bun:test'
import {mkdtempSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {bridgeBase, bridgeClient, type BridgeJob, waitForJob, withUploads} from './wan2gp.ts'

/** A bridge answered by hand: each path gets what the test says, and every request is kept. */
function fakeBridge(answers: Record<string, (init?: RequestInit) => unknown>) {
    const asked: {url: string; init?: RequestInit}[] = []
    const fetcher = (async (url: string, init?: RequestInit) => {
        asked.push({url, init})
        const path = url.replace(/^.*\/feverslop/, '')
        const answer = Object.entries(answers).find(([p]) => path.startsWith(p))
        if (!answer) return new Response(JSON.stringify({detail: `no ${path}`}), {status: 404})
        const body = answer[1](init)
        return new Response(JSON.stringify(body))
    }) as unknown as typeof fetch
    return {fetcher, asked}
}
const job = (status: BridgeJob['status'], more: Partial<BridgeJob> = {}): BridgeJob => ({
    id: 'j1',
    kind: 'generate',
    status,
    created: 0,
    finished: null,
    progress: {},
    files: [],
    errors: [],
    ...more,
})

describe('the wan2gp bridge client (#1192)', () => {
    test('the bridge sits at /feverslop of the wan2gp address, given or not', () => {
        expect(bridgeBase('http://host:7860/')).toBe('http://host:7860/feverslop')
        expect(bridgeBase('http://host:7860/feverslop')).toBe('http://host:7860/feverslop')
    })
    test('local inputs are uploaded and named by what the bridge keeps; a start time and other values stay', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'w2g-'))
        writeFileSync(join(dir, 'singer.png'), 'picture')
        writeFileSync(join(dir, 'song.wav'), 'sound')
        let n = 0
        const {fetcher, asked} = fakeBridge({'/api/files': () => ({name: `${String(++n).repeat(32)}.x`})})
        const client = bridgeClient('http://host:7860', fetcher)
        const sent = await withUploads(
            client,
            {
                template: 'gen_video_with_refs/H3',
                prompt: join(dir, 'singer.png'),
                image_refs: [join(dir, 'singer.png'), 'visual:abc'],
                audio_guide: `${join(dir, 'song.wav')}|start_s=9.1`,
            },
            value => value.startsWith(dir),
        )
        expect(sent.image_refs).toEqual([`${'1'.repeat(32)}.x`, 'visual:abc'])
        expect(sent.audio_guide).toBe(`${'2'.repeat(32)}.x|start_s=9.1`)
        expect(sent.prompt).toBe(join(dir, 'singer.png')) // not an input key: never uploaded
        expect(asked.length).toBe(2)
    })
    test('waiting tells each change once and ends on done; a failed job is an error with its reasons', async () => {
        const states = [job('queued'), job('running', {progress: {step: 4, steps: 8}}), job('running', {progress: {step: 4, steps: 8}}), job('done')]
        const {fetcher} = fakeBridge({'/api/jobs/j1': () => states.shift()})
        const seen: string[] = []
        const done = await waitForJob(bridgeClient('http://h', fetcher), 'j1', j => seen.push(j.status), 1)
        expect(done.status).toBe('done')
        expect(seen).toEqual(['queued', 'running', 'done'])
        const failing = fakeBridge({'/api/jobs/j1': () => job('failed', {errors: ['out of memory']})})
        expect(waitForJob(bridgeClient('http://h', failing.fetcher), 'j1', undefined, 1)).rejects.toThrow('wan2gp job j1 failed: out of memory')
    })
    test("the bridge's refusal is said with its reason", async () => {
        const {fetcher} = fakeBridge({})
        expect(bridgeClient('http://h', fetcher).job('x')).rejects.toThrow('wan2gp bridge 404 on /api/jobs/x: no /api/jobs/x')
    })
})
