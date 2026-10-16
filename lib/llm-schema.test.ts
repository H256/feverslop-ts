import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {askJson, configureLlm} from "./llm.ts";

// A fake server with both APIs: an answer with a schema goes to Chat Completions with it as response_format; a server
// that refuses it (400) is asked on the Responses API for the rest of the run.
let chatStatus = 200
const seen: { path: string, body: Record<string, unknown> }[] = []
let server: ReturnType<typeof Bun.serve>
const sse = (events: object[]) => events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n'

beforeAll(() => {
    server = Bun.serve({
        port: 0,
        async fetch(req) {
            const path = new URL(req.url).pathname
            if (path.endsWith('/models')) return Response.json({object: 'list', data: [{id: 'fake-model', object: 'model', created: 0, owned_by: 'test'}]})
            const body = await req.json() as Record<string, unknown>
            seen.push({path, body})
            if (path.endsWith('/chat/completions')) {
                if (chatStatus !== 200) return Response.json({error: {message: 'response_format not supported'}}, {status: chatStatus})
                const chunk = (delta: object, finish: string | null = null) => ({id: 'c', object: 'chat.completion.chunk', created: 0, model: 'fake-model', choices: [{index: 0, delta, finish_reason: finish}]})
                return new Response(sse([
                    chunk({reasoning_content: 'thinking about it'}),
                    chunk({content: '{"count": '}),
                    chunk({content: '3}'}, 'stop'),
                    {id: 'c', object: 'chat.completion.chunk', created: 0, model: 'fake-model', choices: [], usage: {prompt_tokens: 5, completion_tokens: 7, total_tokens: 12}},
                ]), {headers: {'content-type': 'text/event-stream'}})
            }
            const response = {id: 'r', object: 'response', created_at: 0, model: 'fake-model', output: [], usage: {input_tokens: 1, output_tokens: 3, total_tokens: 4}}
            const events = [{type: 'response.output_text.delta', delta: '{"count": 4}', sequence_number: 1}, {type: 'response.completed', response: {...response, status: 'completed'}, sequence_number: 2}]
            return new Response(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''), {headers: {'content-type': 'text/event-stream'}})
        },
    })
})
afterAll(() => {
    server.stop(true)
    configureLlm({})
})

const schema = {type: 'object', required: ['count'], properties: {count: {type: 'integer'}}}

describe('answers in a JSON schema', () => {
    test('with a schema: Chat Completions, the schema as response_format, system + user message', async () => {
        configureLlm({url: `http://localhost:${server.port}/v1`})
        chatStatus = 200
        seen.length = 0
        expect(await askJson<{ count: number }>({instructions: 'JSON only.', input: 'How many?', schema})).toEqual({count: 3})
        const request = seen.find(r => r.path.endsWith('/chat/completions'))!
        expect(request.body.response_format).toEqual({type: 'json_schema', json_schema: {name: 'answer', strict: true, schema}})
        expect((request.body.messages as { role: string }[]).map(m => m.role)).toEqual(['system', 'user'])
    })
    test('without a schema: the Responses API as before', async () => {
        configureLlm({url: `http://localhost:${server.port}/v1`})
        seen.length = 0
        expect(await askJson<{ count: number }>({instructions: 'JSON only.', input: 'How many?'})).toEqual({count: 4})
        expect(seen.map(r => r.path.split('/').at(-1))).toEqual(['responses'])
    })
    test('a server that refuses the schema is asked without it, and not again with it', async () => {
        configureLlm({url: `http://localhost:${server.port}/v1`})
        chatStatus = 400
        seen.length = 0
        expect(await askJson<{ count: number }>({instructions: 'JSON only.', input: 'How many?', schema})).toEqual({count: 4})
        expect(await askJson<{ count: number }>({instructions: 'JSON only.', input: 'How many?', schema})).toEqual({count: 4})
        expect(seen.map(r => r.path.split('/').at(-1))).toEqual(['completions', 'responses', 'responses'])
    })
})
