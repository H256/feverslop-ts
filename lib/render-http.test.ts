import {removeHeld} from './previous-output.ts'
import {expect, test} from 'bun:test'
import {existsSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {ComfyApi} from '@saintno/comfyui-sdk'
import {WorkflowBuilder} from '../comfy/helpers.ts'
import {Renderer, type RenderWhat} from './render.ts'
import {defaults} from './config.ts'
import {runTimings} from './timings.ts'

const what: RenderWhat = {label: 'test', kind: 'picture', workflow: 'krea2-image', spec: {kind: 'picture', id: 'test', parts: ['test']}}
class TestWorkflow extends WorkflowBuilder {
    output() {
        // by its own method, not by a generated node: this test runs without comfy/nodes.ts too, where the builder's type has none
        return (this as unknown as {addNode: (type: string, inputs: object) => string}).addNode('SaveImage', {})
    }
}
const prepare = async () => {
    const workflow = new TestWorkflow()
    const output = workflow.output()
    return {result: {workflow, output}, uploads: [], meta: {seed: 7}}
}

// Only connection discovery is bypassed: the real SDK performs HTTP and Renderer owns submit/resume/download.
class HttpRenderer extends Renderer {
    constructor(dir: string, url: string) {
        super('http-test', dir, defaults, [{name: 'fake', url}])
        const server = {name: 'fake', url, api: new ComfyApi(url, 'test')}
        Object.assign(this, {connected: [server], ready: Promise.resolve([server])})
    }
    run(target: string) {
        return this.render(what, target, '.png', prepare)
    }
}

test('HTTP submit/download is atomic; a failed download resumes without resubmission (#670)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'render-http-'))
    let submissions = 0,
        broken = true
    const server = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        fetch(req) {
            const path = new URL(req.url).pathname
            if (path === '/prompt') {
                submissions++
                return Response.json({prompt_id: 'job'})
            }
            if (path === '/history/job')
                return Response.json({job: {status: {completed: true}, outputs: {'1': {images: [{filename: 'result.png', type: 'output'}]}}}})
            if (path === '/view') return broken ? new Response('failure', {status: 500}) : new Response('image bytes')
            if (path === '/system_stats') return Response.json({})
            return Response.json({queue_running: [], queue_pending: []})
        },
    })
    try {
        const target = join(dir, 'result.png')
        using renderer = new HttpRenderer(dir, server.url.origin)
        await expect(renderer.run(target)).rejects.toThrow()
        expect(existsSync(target)).toBe(false)
        expect(existsSync(`${target}.pending.json`)).toBe(true)
        broken = false
        await renderer.run(target)
        expect(readFileSync(target, 'utf8')).toBe('image bytes')
        expect(submissions).toBe(1)
        expect(existsSync(`${target}.pending.json`)).toBe(false)
        expect(runTimings().at(-1)?.outcome).toBe('resumed')
    } finally {
        void server.stop(true)
        removeHeld(dir)
    }
})

test('a resume-probe connection blip falls through to protected recovery (#666)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'resume-http-'))
    let histories = 0,
        submissions = 0
    const server = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        fetch(req) {
            const path = new URL(req.url).pathname
            if (path === '/history/job')
                return Response.json(
                    ++histories === 1 ? {} : {job: {status: {completed: true}, outputs: {'1': {images: [{filename: 'result.png', type: 'output'}]}}}},
                )
            if (path === '/queue') return new Response('temporary outage', {status: 503})
            if (path === '/view') return new Response('resumed image')
            if (path === '/prompt') submissions++
            return Response.json({})
        },
    })
    try {
        const target = join(dir, 'result.png')
        writeFileSync(
            `${target}.pending.json`,
            JSON.stringify({promptId: 'job', server: {name: 'fake', url: server.url.origin}, output: '1', nodes: {}, meta: {seed: 4}, queuedAt: 1}),
        )
        using renderer = new HttpRenderer(dir, server.url.origin)
        expect(await renderer.run(target)).toEqual({seed: 4})
        expect(submissions).toBe(0)
        expect(readFileSync(target, 'utf8')).toBe('resumed image')
        expect(runTimings().at(-1)?.outcome).toBe('resumed')
    } finally {
        void server.stop(true)
        removeHeld(dir)
    }
})

test('a job its server says failed leaves no record to take up again - the fallback after it starts fresh', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'failed-http-'))
    const server = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        fetch(req) {
            const path = new URL(req.url).pathname
            if (path === '/prompt') return Response.json({prompt_id: 'job'})
            if (path === '/history/job')
                return Response.json({
                    job: {
                        status: {completed: false, status_str: 'error', messages: [['execution_error', {exception_message: 'HIP out of memory'}]]},
                        outputs: {},
                    },
                })
            if (path === '/system_stats') return Response.json({})
            return Response.json({queue_running: [], queue_pending: []})
        },
    })
    try {
        const target = join(dir, 'result.png')
        using renderer = new HttpRenderer(dir, server.url.origin)
        await expect(renderer.run(target)).rejects.toThrow(/out of memory/)
        expect(existsSync(`${target}.pending.json`)).toBe(false)
    } finally {
        void server.stop(true)
        removeHeld(dir)
    }
})
