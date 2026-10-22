import {OpenAI} from "openai/client";
import type {ResponseCreateParamsStreaming} from "openai/resources/responses/responses";
import {currentStep, readTimings, recordTiming} from "./timings.ts";
import {predictLlmSeconds} from "./predict.ts";
import {countWords, formatDuration, formatRate, log, startSpinner, styles, suffix} from "./log.ts";
import type {VisionSettings} from "./settings.ts";

export type LlmSettings = { url?: string, apiKey?: string, model?: string, parallel?: number, vision?: VisionSettings }

// One server and model the calls go to: the text one, and the one a call with pictures goes to - the same, unless
// llm.vision names another server or model (a text server without a vision projector). Connected on first use.
type Endpoint = {
    url?: string, apiKey?: string, model?: string,
    // "Model" or "Vision model" in the log
    label: string,
    client?: OpenAI,
    modelId?: Promise<string>,
    // whether the server takes a JSON schema on Chat Completions (see openChat)
    chatSchema?: boolean,
    // checked once, on the first call with a picture
    vision?: Promise<void>,
}

let settings: LlmSettings = {}
let text: Endpoint = {label: 'Model'}
let vision: Endpoint = text

/** Sets the server for the following calls - the connection itself is made on the first call. */
export function configureLlm(llm: LlmSettings) {
    settings = llm
    text = {url: llm.url, apiKey: llm.apiKey, model: llm.model, label: 'Model'}
    const v = llm.vision
    // only a model: the text server (and its key) with another model
    vision = v?.url || v?.model
        ? {url: v.url ?? llm.url, apiKey: v.url ? v.apiKey : llm.apiKey, model: v.model, label: 'Vision model'}
        : text
}

// local servers ignore the key, but the OpenAI client needs one
const newClient = (url: string, apiKey?: string, timeout?: number) =>
    new OpenAI({baseURL: url, apiKey: apiKey || 'none', ...(timeout ? {timeout, maxRetries: 0} : {})})

function getClient(endpoint: Endpoint = text) {
    if (!endpoint.url) throw new Error('No LLM server configured - run: bun run setup llm (or set FEVERSLOP_LLM_URL, or pass --llm-url)')
    return endpoint.client ??= newClient(endpoint.url, endpoint.apiKey)
}

/** The model ids on a server - used by the setup and to check the configured model. */
export async function listModels(url: string, apiKey?: string, timeout?: number) {
    const ids: string[] = []
    for await (const model of newClient(url, apiKey, timeout).models.list()) ids.push(model.id)
    return ids
}

// resolved on first use, so a fully cached project runs without the server - once, also when the first calls run at once
function getModelId(endpoint: Endpoint = text) {
    endpoint.modelId ??= resolveModelId(endpoint).catch(e => {
        endpoint.modelId = undefined
        throw e
    })
    return endpoint.modelId
}

async function resolveModelId(endpoint: Endpoint) {
    const client = getClient(endpoint)
    const ids: string[] = []
    for await (const model of client.models.list()) ids.push(model.id)
    const list = ids.join(', ') || 'none'
    const setup = endpoint === text ? 'bun run setup llm-model' : 'bun run setup vision'
    let id: string
    if (endpoint.model) {
        if (!ids.includes(endpoint.model)) throw new Error(`The LLM server ${endpoint.url} has no model "${endpoint.model}" (it has: ${list}) - pick one with: ${setup}`)
        id = endpoint.model
    } else if (ids.length === 1) {
        id = ids[0]!
    } else if (!ids.length) {
        throw new Error(`The LLM server ${endpoint.url} lists no models - load one on the server`)
    } else {
        throw new Error(`Several models on ${endpoint.url} (${list}) - pick one with: ${setup}`)
    }
    const parallel = endpoint === text && (settings.parallel ?? 1) > 1 ? `, up to ${settings.parallel} calls at once` : ''
    log.step(endpoint.label, `${styles.name(id)} ${styles.muted(`on ${endpoint.url}${parallel}`)}`)
    return id
}

/**
 * Whether a model takes pictures, as far as the server tells: llama.cpp (/props: the modalities of the loaded model, in
 * router mode of the one asked for), Ollama (/api/show: its capabilities), LM Studio (/api/v0/models: vlm or llm).
 * undefined when the server tells nothing (vLLM, a proxy) - the call then simply tries.
 */
export async function takesPictures(url: string, model: string, apiKey?: string, timeoutMs = 5000): Promise<boolean | undefined> {
    const root = url.replace(/\/v1$/, '')
    const auth: Record<string, string> = apiKey ? {Authorization: `Bearer ${apiKey}`} : {}
    const get = async (path: string, init: RequestInit = {}) => {
        try {
            const response = await fetch(`${root}${path}`, {...init, headers: {...auth, ...init.headers as Record<string, string>}, signal: AbortSignal.timeout(timeoutMs)})
            return response.ok ? await response.json() as Record<string, unknown> : undefined
        } catch {
            return undefined
        }
    }
    const props = await get(`/props?model=${encodeURIComponent(model)}`) as { modalities?: { vision?: unknown } } | undefined
    if (typeof props?.modalities?.vision === 'boolean') return props.modalities.vision
    const show = await get('/api/show', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({model})}) as { capabilities?: unknown } | undefined
    if (Array.isArray(show?.capabilities)) return show.capabilities.includes('vision')
    const lmStudio = await get(`/api/v0/models/${encodeURIComponent(model)}`) as { type?: unknown } | undefined
    if (lmStudio?.type === 'vlm') return true
    if (lmStudio?.type === 'llm') return false
    return undefined
}

// what to do about a model that takes no pictures - another one, or the text model's own vision projector
const visionHint = (endpoint: Endpoint) => endpoint === text
    ? 'name a vision model for pictures: bun run setup vision (or FEVERSLOP_VISION_URL / FEVERSLOP_VISION_MODEL), or load the model with its vision projector (llama-server --mmproj)'
    : 'pick another: bun run setup vision'

/** Before the first picture goes to the endpoint: a model the server says takes none stops here, with what to do. */
function checkVision(endpoint: Endpoint) {
    endpoint.vision ??= (async () => {
        const id = await getModelId(endpoint)
        if (await takesPictures(endpoint.url!, id, endpoint.apiKey) === false) throw new Error(`${id} on ${endpoint.url} takes no pictures - ${visionHint(endpoint)}`)
    })().catch(e => {
        endpoint.vision = undefined
        throw e
    })
    return endpoint.vision
}

/**
 * Runs `run` for every item, as many at once as the server takes (llm.parallel, default 1 = one after the other) - for
 * calls that don't depend on each other. The results are in the order of the items.
 */
export async function llmMap<T, R>(items: T[], run: (item: T, index: number) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length)
    let next = 0
    const worker = async () => {
        while (next < items.length) {
            const i = next++
            results[i] = await run(items[i]!, i)
        }
    }
    await Promise.all(Array.from({length: Math.min(Math.max(1, settings.parallel ?? 1), items.length)}, worker))
    return results
}

// none: no thinking at all, for a call that only picks or copies (a view number, a phrase out of a description) - for a
// model that cannot switch it off, it is low
export type ReasoningStrength = 'none' | 'low' | 'medium' | 'high' | 'xhigh'

// Models control their thinking differently - the first matching entry wins,
// everything else gets the standard `reasoning.effort` field.
const reasoningAdapters: {
    match: RegExp,
    apply: (p: ResponseCreateParamsStreaming, level: ReasoningStrength) => ResponseCreateParamsStreaming
}[] = [
    // Muse Glimmer reads its reasoning effort from the system prompt
    {
        match: /muse/i,
        apply: (p, level) => ({...p, instructions: `Reasoning strength: ${level === 'none' ? 'low' : level}\n\n${p.instructions ?? ''}`})
    },
    // Qwen 3.8 reads reasoning_effort from chat_template_kwargs, but only while enable_thinking is also true -
    // thinking is off by default, so reasoning_effort alone is silently ignored (no thinking at all, any level)
    {
        match: /qwen3\.8/i,
        apply: (p, level) => ({...p, chat_template_kwargs: level === 'none' ? {enable_thinking: false} : {enable_thinking: true, reasoning_effort: level}} as ResponseCreateParamsStreaming)
    },
    // The other Qwen 3 models think by default and take no level: reasoning_effort low and high came out the same with
    // Qwen3.6-35B-A3B on llama.cpp (~330 tokens of thinking for a one-number question) - only enable_thinking switches it
    // off, on the Chat Completions and the Responses API alike
    {
        match: /qwen3/i,
        apply: (p, level) => level === 'none'
            ? {...p, chat_template_kwargs: {enable_thinking: false}} as ResponseCreateParamsStreaming
            : {...p, reasoning: {effort: level}}
    },
]

export function applyReasoning(prompt: ResponseCreateParamsStreaming, level: ReasoningStrength) {
    const adapter = reasoningAdapters.find(a => a.match.test(prompt.model ?? ''))
    return adapter ? adapter.apply(prompt, level) : {...prompt, reasoning: {effort: level === 'none' ? 'low' as const : level}}
}

// A JSON schema the answer must follow - the server then constrains the decoding to it, so the JSON cannot break. The
// Responses API of llama.cpp ignores text.format without a word; its Chat Completions API honours response_format (also
// with reasoning), so an answer with a schema is asked there. A server that refuses it is asked the plain way for the rest
// of the run, and the answer is read and repaired as before.
export type JsonSchema = Record<string, unknown>

export async function fetchAndDisplayResponse(prompt: ResponseCreateParamsStreaming, reasoning: ReasoningStrength = 'low', schema?: JsonSchema, label?: string, endpoint: Endpoint = text) {
    let thinking = ''
    let answer = ''
    let usage: ResponseUsage | undefined
    let incomplete: string | undefined
    // a stream that ends without a terminal event was cut off by the connection or the server - what came before is not an answer
    let finished = false
    prompt = applyReasoning({...prompt, model: prompt.model ?? await getModelId(endpoint)}, reasoning)
    const started = Date.now()
    const expected = predictLlmSeconds(readTimings(), prompt.model ?? '', currentStep())

    const stopSpinner = startSpinner(() => {
        if (answer) return `${styles.answer('writing')} ${styles.muted(`${countWords(answer)} words`)}`
        if (thinking) return `${styles.thinking('thinking')} ${styles.muted(`${countWords(thinking)} words`)}`
        return styles.muted(`waiting for model${expected ? ` (usually ~${formatDuration(expected * 1000)})` : ''}`)
    })
    try {
        const chat = schema && endpoint.chatSchema !== false && typeof prompt.input === 'string' ? await openChat(endpoint, prompt, schema) : undefined
        if (chat) for await (const chunk of chat) {
            const delta = chunk.choices[0]?.delta as { content?: string | null, reasoning_content?: string | null, reasoning?: string | null } | undefined
            thinking += delta?.reasoning_content ?? delta?.reasoning ?? ''
            answer += delta?.content ?? ''
            const reason = chunk.choices[0]?.finish_reason
            if (reason) {
                finished = true
                if (reason === 'length') incomplete = 'max_output_tokens'
            }
            if (chunk.usage) usage = {
                input_tokens: chunk.usage.prompt_tokens,
                output_tokens: chunk.usage.completion_tokens,
                input_tokens_details: {cached_tokens: chunk.usage.prompt_tokens_details?.cached_tokens},
                output_tokens_details: {reasoning_tokens: chunk.usage.completion_tokens_details?.reasoning_tokens},
            }
        }
        else for await (const event of await getClient(endpoint).responses.create(prompt)) {
            switch (event.type) {
                case 'response.reasoning_text.delta':
                case 'response.reasoning_summary_text.delta':
                    thinking += event.delta
                    break
                case 'response.output_text.delta':
                    answer += event.delta
                    break
                case 'response.completed':
                    finished = true
                    usage = event.response.usage
                    break
                case 'response.incomplete':
                    finished = true
                    usage = event.response.usage
                    incomplete = event.response.incomplete_details?.reason ?? 'unknown reason'
                    break
                case 'response.failed':
                    throw new Error(`the LLM server reported a failed response: ${event.response.error?.message ?? event.response.error?.code ?? 'no reason given'}`)
                case 'error':
                    throw new Error(event.message)
            }
        }
    } catch (e) {
        keepCall(endpoint, prompt, started, usage, thinking, 'failed', e instanceof Error ? e.name : 'error')
        throw e
    } finally {
        stopSpinner()
    }
    const took = Date.now() - started
    const outputTokens = usage?.output_tokens
    if (!finished) {
        keepCall(endpoint, prompt, started, usage, thinking, 'failed', 'no-end')
        throw new Error('the LLM stream ended without a completed or incomplete event - the answer is not complete')
    }
    log.step('Done', (label ? `${styles.name(label)} ` : '') + styles.muted(`${countWords(thinking)} words thinking (${reasoning}), ${countWords(answer)} words answer${outputTokens ? `, ${outputTokens} of ${prompt.max_output_tokens} tokens` : ''} · ${suffix(formatDuration(took), formatRate(outputTokens, took))}`))
    // llama.cpp reports a cut-off answer as "completed" - all tokens used up means cut off, too
    const limit = prompt.max_output_tokens
    const truncated = incomplete === 'max_output_tokens' || (!!limit && outputTokens !== undefined && outputTokens >= limit)
    // a cut-off or empty answer is asked for again (ask) - the call is kept as a retry, its tokens were spent all the same
    keepCall(endpoint, prompt, started, usage, thinking, truncated ? 'retry' : answer.trim() ? undefined : 'retry', truncated ? 'truncated' : answer.trim() ? undefined : 'empty')
    if (truncated) throw new TruncatedError(limit ?? 0)
    if (incomplete) log.warn(`the answer is incomplete: ${incomplete}`)
    return {thinking, answer}
}

/**
 * The same request on the Chat Completions API, with the schema as response_format - undefined (and the plain way for the
 * rest of the run) when the server refuses it.
 */
async function openChat(endpoint: Endpoint, prompt: ResponseCreateParamsStreaming, schema: JsonSchema) {
    const extra = prompt as ResponseCreateParamsStreaming & { chat_template_kwargs?: unknown }
    try {
        const stream = await getClient(endpoint).chat.completions.create({
            model: prompt.model!,
            messages: [
                ...(prompt.instructions ? [{role: 'system' as const, content: prompt.instructions}] : []),
                {role: 'user' as const, content: prompt.input as string},
            ],
            ...(prompt.max_output_tokens ? {max_tokens: prompt.max_output_tokens} : {}),
            ...(prompt.reasoning?.effort ? {reasoning_effort: prompt.reasoning.effort as 'low'} : {}),
            ...(extra.chat_template_kwargs ? {chat_template_kwargs: extra.chat_template_kwargs} : {}),
            response_format: {type: 'json_schema', json_schema: {name: 'answer', strict: true, schema}},
            stream: true,
            stream_options: {include_usage: true},
        } as Parameters<OpenAI['chat']['completions']['create']>[0] & { stream: true })
        endpoint.chatSchema = true
        return stream
    } catch (e) {
        const status = (e as { status?: number }).status
        if (endpoint.chatSchema === true || !status || status >= 500) throw e
        endpoint.chatSchema = false
        log.warn(`the LLM server does not take a JSON schema (${status}) - asking without one for the rest of the run`)
        return undefined
    }
}

type ResponseUsage = { input_tokens?: number, output_tokens?: number, input_tokens_details?: { cached_tokens?: number }, output_tokens_details?: { reasoning_tokens?: number } }

/** Keeps one call in the central timings: durations and the token numbers the endpoint reported - nothing is estimated, and no text. */
function keepCall(endpoint: Endpoint, prompt: ResponseCreateParamsStreaming, started: number, usage: ResponseUsage | undefined, thinking: string, outcome?: 'retry' | 'failed', reason?: string) {
    const ms = Date.now() - started
    const tokensPerSecond = usage?.output_tokens && ms > 0 ? Math.round(usage.output_tokens / (ms / 1000) * 10) / 10 : undefined
    const host = endpoint.url ? new URL(endpoint.url).host : undefined
    recordTiming({
        kind: 'llm', name: prompt.model ?? '', seconds: Math.round(ms / 100) / 10, ...(currentStep() ? {step: currentStep()} : {}),
        ...(outcome ? {outcome, reason} : {}), ...(host ? {endpoint: host} : {}),
        ...(usage?.input_tokens !== undefined ? {promptTokens: usage.input_tokens} : {}),
        ...(usage?.output_tokens !== undefined ? {completionTokens: usage.output_tokens} : {}),
        ...(usage?.output_tokens_details?.reasoning_tokens !== undefined ? {reasoningTokens: usage.output_tokens_details.reasoning_tokens} : {}),
        ...(usage?.input_tokens_details?.cached_tokens !== undefined ? {cachedTokens: usage.input_tokens_details.cached_tokens} : {}),
        ...(thinking ? {thinkingWords: countWords(thinking)} : {}),
        ...(tokensPerSecond ? {tokensPerSecond} : {}),
    })
}

/** The model hit max_output_tokens - thinking and answer together - before the answer was finished. */
export class TruncatedError extends Error {
    constructor(readonly maxTokens: number) {
        super(`the answer was cut off at max_output_tokens (${maxTokens}) - thinking and answer share that limit`)
    }
}

export type AskOptions = {
    instructions: string,
    input: string,
    maxTokens?: number,
    reasoning?: ReasoningStrength,
    // data URLs (e.g. "data:image/png;base64,...") - only for a vision-capable model; see tools/replace-character.ts
    images?: string[],
    // askJson only: the shape of the answer - the server keeps the decoding to it (see fetchAndDisplayResponse)
    schema?: JsonSchema,
    // what the call is for ("beat-03 · shots 5-8") - in the log, where calls running at once cannot be told apart otherwise
    label?: string,
}

/** The model finished every attempt without writing an answer - it only thought. */
export class EmptyAnswerError extends Error {
    constructor(readonly attempts: number) {
        super(`the model gave no answer in ${attempts} attempts, it only thought - try a lower reasoning effort or another model (bun run setup llm-model)`)
    }
}

const emptyAnswerNote = '\n\nKeep your thinking short and then write the answer itself - an empty answer is not acceptable.'

export async function ask({instructions, input, maxTokens = 8192, reasoning = 'low', images, schema, label}: AskOptions) {
    const of = label ? `${label}: ` : ''
    const requestInput = images?.length
        ? [{role: 'user' as const, content: [{type: 'input_text' as const, text: input}, ...images.map(image_url => ({type: 'input_image' as const, image_url, detail: 'auto' as const}))]}]
        : input
    // pictures go to the vision model - checked first, so a text-only model says so instead of failing somewhere
    const endpoint = images?.length ? vision : text
    if (images?.length) await checkVision(endpoint)
    // A cut-off answer is useless (half a JSON), an empty one even more so - the model spent everything on thinking, which
    // varies a lot from run to run, and a small quant can loop in its thinking - more room at the same effort only
    // lets it loop longer. So the second try already has the prompt rewritten (think briefly, then answer) with a low
    // reasoning effort, and the last try gets even more room.
    const retryLevel: ReasoningStrength = reasoning === 'none' ? 'none' : 'low'
    const attempts = [
        {limit: maxTokens, level: reasoning, note: ''},
        {limit: maxTokens * 2, level: retryLevel, note: emptyAnswerNote},
        {limit: maxTokens * 4, level: retryLevel, note: emptyAnswerNote},
    ]
    for (const [i, {limit, level, note}] of attempts.entries()) {
        try {
            const {answer} = await fetchAndDisplayResponse({max_output_tokens: limit, input: requestInput, instructions: instructions + note, stream: true}, level, schema, label, endpoint)
            if (answer.trim()) return answer.trim()
            if (i === attempts.length - 1) throw new EmptyAnswerError(attempts.length)
            log.warn(`${of}empty answer - the model only thought - asking again with ${attempts[i + 1]!.limit}${attempts[i + 1]!.note ? ' and a shorter-thinking prompt' : ''}`)
        } catch (e) {
            // a server that could not tell beforehand refuses the picture now (llama.cpp without --mmproj: "image input is not supported")
            if (images?.length && /image|vision|mmproj|multimodal/i.test((e as Error).message)) {
                throw new Error(`${await getModelId(endpoint)} on ${endpoint.url} took no picture (${(e as Error).message}) - ${visionHint(endpoint)}`)
            }
            // only the first cut-off gets a second chance - after that the answer is too long for the model, not just unlucky
            if (!(e instanceof TruncatedError) || i !== 0) throw e
            log.warn(`${of}${e.message} - asking again with ${attempts[1]!.limit} and a shorter-thinking prompt`)
        }
    }
    throw new Error('unreachable')
}

// Local models often put a raw newline/tab inside a JSON string (e.g. multi-line lyrics) instead of the \n escape -
// technically invalid JSON, so JSON.parse rejects it with "Unterminated string". Escaping control characters found
// inside string literals (tracking quotes/backslashes so it doesn't touch the JSON's own structural whitespace)
// fixes that without needing a smarter parser.
function escapeControlCharsInStrings(text: string): string {
    let out = ''
    let inString = false
    let escaped = false
    for (const ch of text) {
        if (!inString) {
            out += ch
            if (ch === '"') inString = true
            continue
        }
        if (escaped) {
            out += ch
            escaped = false
        } else if (ch === '\\') {
            out += ch
            escaped = true
        } else if (ch === '"') {
            out += ch
            inString = false
        } else if (ch === '\n') {
            out += '\\n'
        } else if (ch === '\r') {
            out += '\\r'
        } else if (ch === '\t') {
            out += '\\t'
        } else {
            out += ch
        }
    }
    return out
}

// Long answers sometimes lose or mix up closing brackets - e.g. ..."}} or ..."]]} instead of ..."]}} at the end of the
// last array, with everything before it complete. Closing what is still open, by type, repairs that: a closer that
// doesn't match the innermost open bracket first closes the ones the model forgot (or, if that kind isn't open at all,
// is taken as the innermost one), and at the end the rest is closed. A closer that would close the whole answer while it goes on
// (a comma and more after it: ..."}}, "shots": [...] where the "ends" object had been closed already) is one too many and is left out.
// Strings are tracked (as in escapeControlCharsInStrings) so brackets inside text are left alone.
export function closeOpenBrackets(text: string): string {
    const open: string[] = []
    let out = ''
    let inString = false
    let escaped = false
    for (const [i, ch] of [...text].entries()) {
        if (inString) {
            if (escaped) escaped = false
            else if (ch === '\\') escaped = true
            else if (ch === '"') inString = false
        } else if (ch === '"') {
            inString = true
        } else if (ch === '{' || ch === '[') {
            open.push(ch === '{' ? '}' : ']')
        } else if (ch === '}' || ch === ']') {
            if (open.length === 1 && open[0] === ch && /^\s*,/.test(text.slice(i + 1))) continue
            if (open.includes(ch)) {
                while (open.at(-1) !== ch) out += open.pop()
                open.pop()
            } else if (open.length > 0) {
                // wrong kind, e.g. ..."]]} instead of ..."]}}: it stands for the innermost open bracket
                out += open.pop()
                continue
            }
        }
        out += ch
    }
    return out + (inString ? '"' : '') + open.reverse().join('')
}

// End (exclusive) of the first complete top-level value starting at `start`, or -1 if it never closes. Strings are
// tracked as in closeOpenBrackets, so brackets in the prose after the JSON are not taken for part of it.
function firstValueEnd(text: string, start: number): number {
    let depth = 0
    let inString = false
    let escaped = false
    for (let i = start; i < text.length; i++) {
        const ch = text[i]!
        if (inString) {
            if (escaped) escaped = false
            else if (ch === '\\') escaped = true
            else if (ch === '"') inString = false
        } else if (ch === '"') {
            inString = true
        } else if (ch === '{' || ch === '[') {
            depth++
        } else if ((ch === '}' || ch === ']') && --depth === 0) {
            return i + 1
        }
    }
    return -1
}

// Models like to wrap JSON in ```json fences or add a sentence around it
export async function askJson<T>(options: AskOptions): Promise<T> {
    const answer = await ask(options)
    const start = Math.max(answer.search(/[{[]/), 0)
    // candidates, best first: the first complete value (prose with a bracket after it is left out); up to the last
    // closer (a bracket mix-up the repair can fix); everything from the start (a cut-off answer - the repair closes
    // what is still open)
    const lastCloser = Math.max(answer.lastIndexOf('}'), answer.lastIndexOf(']'))
    const first = firstValueEnd(answer, start)
    const candidates = [...new Set([
        ...(first > 0 ? [answer.slice(start, first)] : []),
        ...(lastCloser >= start ? [answer.slice(start, lastCloser + 1)] : []),
        answer.slice(start).replace(/\s*```\s*$/, ''),
    ])].map(escapeControlCharsInStrings)
    let error: unknown
    for (const json of candidates) {
        try {
            return JSON.parse(json)
        } catch (e) {
            error ??= e
        }
        try {
            const repaired = JSON.parse(closeOpenBrackets(json))
            log.warn('the answer lacked a closing bracket - closed it')
            return repaired
        } catch {}
    }
    log.box('Unparsable answer', answer)
    throw new Error(`LLM did not answer with valid JSON: ${(error as Error).message}`)
}
