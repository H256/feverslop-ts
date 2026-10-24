import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {ask, configureLlm, picturesReadable, takesPictures} from "./llm.ts";
import {loadSettings} from "./settings.ts";

// Two fake servers: a text server and a vision server, each with its models, /props as llama.cpp has it (vision on or
// off, or none at all) and a streamed Responses answer that names the server and the model it was asked for.
type Fake = { name: string, models: string[], vision?: boolean, refuseImages?: boolean, calls: { model: string, images: number }[] }
const sse = (events: object[]) => events.map(e => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join('')

function serve(fake: Fake) {
    return Bun.serve({
        port: 0,
        async fetch(req) {
            const path = new URL(req.url).pathname
            if (path === '/v1/models') return Response.json({object: 'list', data: fake.models.map(id => ({id, object: 'model', created: 0, owned_by: 'test'}))})
            if (path === '/props') return fake.vision === undefined ? new Response('not found', {status: 404}) : Response.json({modalities: {vision: fake.vision, audio: false}})
            if (path !== '/v1/responses') return new Response('not found', {status: 404})
            const body = await req.json() as { model: string, input: string | { content: { type: string }[] }[] }
            const images = typeof body.input === 'string' ? 0 : body.input.flatMap(m => m.content).filter(c => c.type === 'input_image').length
            fake.calls.push({model: body.model, images})
            if (images && fake.refuseImages) return Response.json({error: {message: 'image input is not supported - hint: if this is unexpected, you may need to provide the mmproj', type: 'server_error'}}, {status: 500})
            const response = {id: 'r', object: 'response', created_at: 0, model: body.model, output: [], usage: {input_tokens: 1, output_tokens: 1, total_tokens: 2}}
            return new Response(sse([
                {type: 'response.output_text.delta', delta: `${fake.name}:${body.model}`, sequence_number: 1},
                {type: 'response.completed', response: {...response, status: 'completed'}, sequence_number: 2},
            ]), {headers: {'content-type': 'text/event-stream'}})
        },
    })
}

const textFake: Fake = {name: 'text', models: ['qwen-27b', 'qwen-vl'], calls: []}
const visionFake: Fake = {name: 'vision', models: ['gemma-vl'], vision: true, calls: []}
let textServer: ReturnType<typeof Bun.serve>
let visionServer: ReturnType<typeof Bun.serve>
const textUrl = () => `http://localhost:${textServer.port}/v1`
const visionUrl = () => `http://localhost:${visionServer.port}/v1`
const picture = {instructions: 'describe', input: 'who is this', images: ['data:image/png;base64,AAAA']}
const words = {instructions: 'write', input: 'a line'}

beforeAll(() => {
    textServer = serve(textFake)
    visionServer = serve(visionFake)
})
afterAll(() => {
    textServer.stop(true)
    visionServer.stop(true)
    configureLlm({})
})
afterEach(() => {
    textFake.calls = []
    visionFake.calls = []
    textFake.vision = undefined
    textFake.refuseImages = undefined
})

describe('pictures without a vision model', () => {
    test('go to the text model', async () => {
        textFake.vision = true
        configureLlm({url: textUrl(), model: 'qwen-27b'})
        expect(await ask(picture)).toBe('text:qwen-27b')
    })
    test('a text model the server says takes no pictures stops before the call, naming the setting', async () => {
        textFake.vision = false
        configureLlm({url: textUrl(), model: 'qwen-27b'})
        await expect(ask(picture)).rejects.toThrow(/qwen-27b .* takes no pictures - name a vision model for pictures: bun run setup vision/)
        expect(textFake.calls).toEqual([])
    })
    test('a server that could not tell and then refuses the picture names the setting too', async () => {
        textFake.refuseImages = true
        configureLlm({url: textUrl(), model: 'qwen-27b'})
        await expect(ask(picture)).rejects.toThrow(/qwen-27b .* took no picture \(.*mmproj.*\) - name a vision model/)
    })
})

describe('a vision model of its own', () => {
    test('on another server: pictures go there, words stay on the text server', async () => {
        textFake.vision = false
        configureLlm({url: textUrl(), model: 'qwen-27b', vision: {url: visionUrl()}})
        expect(await ask(picture)).toBe('vision:gemma-vl')
        expect(await ask(words)).toBe('text:qwen-27b')
        expect(visionFake.calls).toEqual([{model: 'gemma-vl', images: 1}])
        expect(textFake.calls).toEqual([{model: 'qwen-27b', images: 0}])
    })
    test('only a model: the text server with that model', async () => {
        textFake.vision = true
        configureLlm({url: textUrl(), model: 'qwen-27b', vision: {model: 'qwen-vl'}})
        expect(await ask(picture)).toBe('text:qwen-vl')
        expect(await ask(words)).toBe('text:qwen-27b')
    })
    test('a vision model the server does not have is named with its setup', async () => {
        configureLlm({url: textUrl(), model: 'qwen-27b', vision: {model: 'nope'}})
        await expect(ask(picture)).rejects.toThrow(/no model "nope".*bun run setup vision/)
    })
})

describe('takesPictures', () => {
    test('reads llama.cpp /props, and is undefined when the server tells nothing', async () => {
        expect(await takesPictures(visionUrl(), 'gemma-vl')).toBe(true)
        textFake.vision = false
        expect(await takesPictures(textUrl(), 'qwen-27b')).toBe(false)
        textFake.vision = undefined
        expect(await takesPictures(textUrl(), 'qwen-27b')).toBeUndefined()
    })
})

describe('picturesReadable', () => {
    test('a vision model of its own, or a text model the server says takes pictures - unknown is no', async () => {
        configureLlm({url: textUrl(), model: 'qwen-27b', vision: {url: visionUrl(), model: 'gemma-vl'}})
        expect(await picturesReadable()).toBe(true)
        configureLlm({url: textUrl(), model: 'qwen-vl'})
        textFake.vision = true
        expect(await picturesReadable()).toBe(true)
        textFake.vision = false
        expect(await picturesReadable()).toBe(false)
        // a server that tells nothing: a text model there may drop the picture and make up what it would have seen
        textFake.vision = undefined
        expect(await picturesReadable()).toBe(false)
        configureLlm({})
        expect(await picturesReadable()).toBe(false)
    })
})

describe('loadSettings', () => {
    const saved = {...process.env}
    afterEach(() => {
        process.env = {...saved}
    })
    test('the vision model from env vars - the project model only changes the text model', async () => {
        process.env.FEVERSLOP_SETTINGS = '/nonexistent/settings.json'
        process.env.FEVERSLOP_LLM_URL = 'http://text:8080/v1'
        process.env.FEVERSLOP_VISION_URL = 'http://vision:8081/v1/'
        process.env.FEVERSLOP_VISION_MODEL = 'gemma-vl'
        const {llm, sources} = await loadSettings({projectModel: 'project-model'})
        expect(llm.model).toBe('project-model')
        expect(llm.vision).toEqual({url: 'http://vision:8081/v1', model: 'gemma-vl'})
        expect(sources.visionUrl).toBe('env')
    })
    test('no vision settings: none, the text model describes pictures', async () => {
        process.env.FEVERSLOP_SETTINGS = '/nonexistent/settings.json'
        delete process.env.FEVERSLOP_VISION_URL
        delete process.env.FEVERSLOP_VISION_MODEL
        expect((await loadSettings()).llm.vision).toBeUndefined()
    })
})
