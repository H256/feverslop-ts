import {afterAll, beforeAll, expect, test} from "bun:test";
import {ask, configureLlm} from "./llm.ts";
import {lastLines, runProcess} from "./process.ts";
import {nameService} from "./service-error.ts";

let server: ReturnType<typeof Bun.serve>

beforeAll(() => {
    server = Bun.serve({
        port: 0,
        fetch(req) {
            if (new URL(req.url).pathname.endsWith('/models')) return Response.json({object: 'list', data: [{id: 'fake-model', object: 'model'}]})
            return new Response('{"message":"","code":500}', {status: 500})
        },
    })
})
afterAll(() => {
    server.stop(true)
})

test('a server error names the LLM server and keeps the error itself', async () => {
    configureLlm({url: `http://localhost:${server.port}/v1`, parallel: 1} as Parameters<typeof configureLlm>[0])
    const error = await ask({instructions: 'x', input: 'y', label: 'beat-01'}).catch((e: Error) => e)
    expect((error as Error).message).toContain(`LLM http://localhost:${server.port}/v1`)
    expect((error as Error).message).toContain('beat-01')
    expect((error as Error).message).toContain('500')
    expect((error as { status?: number }).status).toBe(500)
})

test('a message that names the service already stays as it is', () => {
    expect(nameService(new Error('clip slot-001: job failed'), 'clip slot-001 on a', 'clip slot-001').message).toBe('clip slot-001: job failed')
    expect(nameService(new Error('The operation timed out.'), 'clip slot-001 on a').message).toBe('clip slot-001 on a: The operation timed out.')
    expect(nameService(new Error(''), 'x').message).toBe('x: no message')
})

test('the last lines of a progress output: bar updates are lines, empty ones are left out', () => {
    expect(lastLines('a\n\n 10%\r 20%\r\nboom\n', 2)).toEqual([' 20%', 'boom'])
})

test('a tool that fails: its stderr reaches the error message', async () => {
    const script = 'console.error("Traceback: model missing"); process.exit(3)'
    const message = await runProcess(['bun', '-e', script], {stderr: 'tee', errorMessage: stderr => `failed: ${lastLines(stderr).join(' / ')}`}).catch((e: Error) => e.message)
    expect(message).toBe('failed: Traceback: model missing')
})
