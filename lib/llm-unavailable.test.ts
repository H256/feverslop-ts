import {afterAll, describe, expect, test} from 'bun:test'
import {ask, configureLlm, LlmUnavailableError} from './llm.ts'

// A server that cannot be asked is not a bad answer (#815): the call says so with an error of its own, which the pipelines end on
// instead of taking the fallback of every beat in turn.
const servers: ReturnType<typeof Bun.serve>[] = []
afterAll(() => {
    for (const server of servers) void server.stop(true)
})

describe('a language model that cannot be asked', () => {
    test('no server configured', async () => {
        configureLlm({})
        const error = await ask({instructions: 'i', input: 'x'}).catch((e: unknown) => e)
        expect(error).toBeInstanceOf(LlmUnavailableError)
        expect((error as Error).message).toContain('bun run setup llm')
        expect((error as Error).message).not.toContain('undefined')
    })

    test('nothing listens at its address', async () => {
        // a port that was free a moment ago: the connection is refused
        const gone = Bun.serve({port: 0, fetch: () => new Response('')})
        const url = `http://127.0.0.1:${gone.port}/v1`
        await gone.stop(true)
        configureLlm({url})
        const started = Date.now()
        const error = await ask({instructions: 'i', input: 'x'}).catch((e: unknown) => e)
        expect(error).toBeInstanceOf(LlmUnavailableError)
        expect((error as Error).message).toContain(url)
        expect((error as Error).message).toContain('repeat the command')
        expect(Date.now() - started).toBeLessThan(5000)
    })

    test('it goes away in the middle of a step', async () => {
        const server = Bun.serve({
            port: 0,
            fetch(req, self) {
                if (new URL(req.url).pathname.endsWith('/models'))
                    return Response.json({object: 'list', data: [{id: 'fake-model', object: 'model', created: 0, owned_by: 'test'}]})
                // the model list was answered, the call itself finds nobody: the server is stopped under it
                void self.stop(true)
                return new Promise<Response>(() => {})
            },
        })
        servers.push(server)
        configureLlm({url: `http://127.0.0.1:${server.port}/v1`})
        const error = await ask({instructions: 'i', input: 'x'}).catch((e: unknown) => e)
        expect(error).toBeInstanceOf(LlmUnavailableError)
    }, 30_000)

    test('a refusal with a status is not it', async () => {
        const server = Bun.serve({
            port: 0,
            fetch(req) {
                if (new URL(req.url).pathname.endsWith('/models'))
                    return Response.json({object: 'list', data: [{id: 'fake-model', object: 'model', created: 0, owned_by: 'test'}]})
                return Response.json({error: {message: 'bad request'}}, {status: 400})
            },
        })
        servers.push(server)
        configureLlm({url: `http://127.0.0.1:${server.port}/v1`})
        const error = await ask({instructions: 'i', input: 'x'}).catch((e: unknown) => e)
        expect(error).toBeInstanceOf(Error)
        expect(error).not.toBeInstanceOf(LlmUnavailableError)
    })
})
