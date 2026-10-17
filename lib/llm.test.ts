import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {applyReasoning, ask, askJson, configureLlm, EmptyAnswerError, TruncatedError} from "./llm.ts";

// A fake server that speaks the part of the OpenAI Responses API the pipelines use (model list, a streamed answer), so ask() and askJson() are
// tested with their retries - cut-off and empty answers - without a language model.
type Reply = { text: string, outputTokens?: number, incomplete?: boolean, failed?: boolean, noEnd?: boolean }
let replies: Reply[] = []
const requests: { max_output_tokens: number, instructions: string }[] = []
let server: ReturnType<typeof Bun.serve>

const sse = (events: object[]) => events.map(e => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join('')

beforeAll(() => {
    server = Bun.serve({
        port: 0,
        async fetch(req) {
            const path = new URL(req.url).pathname
            if (path.endsWith('/models')) return Response.json({object: 'list', data: [{id: 'fake-model', object: 'model', created: 0, owned_by: 'test'}]})
            const body = await req.json() as { max_output_tokens: number, instructions: string }
            requests.push({max_output_tokens: body.max_output_tokens, instructions: body.instructions})
            const reply = replies.shift() ?? {text: ''}
            const response = {id: 'r', object: 'response', created_at: 0, model: 'fake-model', output: [], usage: {input_tokens: 1, output_tokens: reply.outputTokens ?? reply.text.length, total_tokens: 1}}
            const events: object[] = [
                ...(reply.text ? [{type: 'response.output_text.delta', delta: reply.text, sequence_number: 1}] : []),
                ...(reply.noEnd ? [] : [reply.failed
                    ? {type: 'response.failed', response: {...response, status: 'failed', error: {code: 'server_error', message: 'boom'}}, sequence_number: 2}
                    : reply.incomplete
                    ? {type: 'response.incomplete', response: {...response, status: 'incomplete', incomplete_details: {reason: 'max_output_tokens'}}, sequence_number: 2}
                    : {type: 'response.completed', response: {...response, status: 'completed'}, sequence_number: 2}]),
            ]
            return new Response(sse(events), {headers: {'content-type': 'text/event-stream'}})
        },
    })
    configureLlm({url: `http://localhost:${server.port}/v1`})
})
afterAll(() => server.stop(true))

const run = async <T>(list: Reply[], fn: () => Promise<T>) => {
    replies = [...list]
    requests.length = 0
    return fn()
}

describe('ask', () => {
    test('returns the answer, trimmed', async () => {
        expect(await run([{text: '  hello \n'}], () => ask({instructions: 'i', input: 'x', maxTokens: 100}))).toBe('hello')
    })
    test('a cut-off answer is asked again once with twice the room', async () => {
        const answer = await run([{text: '{"a":', incomplete: true}, {text: 'done'}], () => ask({instructions: 'i', input: 'x', maxTokens: 100}))
        expect(answer).toBe('done')
        expect(requests.map(r => r.max_output_tokens)).toEqual([100, 200])
    })
    test('a second cut-off is an error, not a loop', async () => {
        const result = run([{text: 'a', incomplete: true}, {text: 'b', incomplete: true}, {text: 'never'}], () => ask({instructions: 'i', input: 'x', maxTokens: 100}))
        await expect(result).rejects.toBeInstanceOf(TruncatedError)
        expect(requests).toHaveLength(2)
    })
    test('an empty answer is asked again - the second time with a prompt that asks for short thinking', async () => {
        const answer = await run([{text: ''}, {text: 'finally'}], () => ask({instructions: 'i', input: 'x', maxTokens: 100}))
        expect(answer).toBe('finally')
        expect(requests.map(r => r.max_output_tokens)).toEqual([100, 200])
        expect(requests[1]!.instructions).toContain('Keep your thinking short')
        expect(requests[0]!.instructions).not.toContain('Keep your thinking short')
    })
    test('a failed response is an error even when text came before it', async () => {
        await expect(run([{text: '{"valid":true}', failed: true}], () => ask({instructions: 'i', input: 'x'}))).rejects.toThrow('boom')
        expect(requests).toHaveLength(1)
    })
    test('a stream without a terminal event is an error', async () => {
        await expect(run([{text: 'half', noEnd: true}], () => ask({instructions: 'i', input: 'x'}))).rejects.toThrow('without a completed')
    })
    test('three empty answers are an error', async () => {
        await expect(run([{text: ''}, {text: ''}, {text: ''}], () => ask({instructions: 'i', input: 'x', maxTokens: 100}))).rejects.toBeInstanceOf(EmptyAnswerError)
    })
})

describe('askJson', () => {
    test('takes the JSON out of a fenced answer with a sentence around it', async () => {
        const answer = await run([{text: 'Here you go:\n```json\n{"a": [1, 2], "b": "x"}\n```\nDone.'}], () => askJson<{ a: number[], b: string }>({instructions: 'i', input: 'x'}))
        expect(answer).toEqual({a: [1, 2], b: 'x'})
    })
    test('a raw newline inside a string is escaped', async () => {
        const answer = await run([{text: '{"lyrics": "line one\nline two"}'}], () => askJson<{ lyrics: string }>({instructions: 'i', input: 'x'}))
        expect(answer.lyrics).toBe('line one\nline two')
    })
    test('a missing closing bracket is closed', async () => {
        const answer = await run([{text: '{"a": [{"b": 1}'}], () => askJson<{ a: { b: number }[] }>({instructions: 'i', input: 'x'}))
        expect(answer.a[0]!.b).toBe(1)
    })
    test('an answer that is not JSON at all is an error', async () => {
        await expect(run([{text: '{"a": nope}'}], () => askJson({instructions: 'i', input: 'x'}))).rejects.toThrow(/valid JSON/)
    })
})

describe('applyReasoning', () => {
    const prompt = (model: string) => ({model, input: 'x', stream: true as const})
    test('none switches the thinking of a Qwen 3 model off - it takes no level', () => {
        expect(applyReasoning(prompt('Qwen3.6-35B-A3B-MTP-GGUF-UD-Q4_K_XL'), 'none')).toMatchObject({chat_template_kwargs: {enable_thinking: false}})
        expect(applyReasoning(prompt('Qwen3.6-35B-A3B'), 'none')).not.toHaveProperty('reasoning')
        expect(applyReasoning(prompt('Qwen3.6-35B-A3B'), 'medium')).toMatchObject({reasoning: {effort: 'medium'}})
        expect(applyReasoning(prompt('Qwen3.6-35B-A3B'), 'medium')).not.toHaveProperty('chat_template_kwargs')
    })
    test('Qwen 3.8 keeps its level, and none switches it off', () => {
        expect(applyReasoning(prompt('qwen3.8-30b'), 'low')).toMatchObject({chat_template_kwargs: {enable_thinking: true, reasoning_effort: 'low'}})
        expect(applyReasoning(prompt('qwen3.8-30b'), 'none')).toMatchObject({chat_template_kwargs: {enable_thinking: false}})
    })
    test('a model that cannot switch it off thinks at low for none', () => {
        expect(applyReasoning(prompt('gemma-4-26b'), 'none')).toMatchObject({reasoning: {effort: 'low'}})
        expect(applyReasoning(prompt('muse-glimmer'), 'none').instructions).toContain('Reasoning strength: low')
    })
})
