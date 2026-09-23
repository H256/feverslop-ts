import {OpenAI} from "openai/client";
import type {ResponseCreateParamsStreaming} from "openai/resources/responses/responses";
import {log, startSpinner, styles} from "./log.ts";

export type LlmSettings = { url?: string, apiKey?: string, model?: string }

let settings: LlmSettings = {}
let llmClient: OpenAI | undefined
let modelId: string | undefined

/** Sets the server for the following calls - the connection itself is made on the first call. */
export function configureLlm(llm: LlmSettings) {
    settings = llm
    llmClient = undefined
    modelId = undefined
}

// local servers ignore the key, but the OpenAI client needs one
const newClient = (url: string, apiKey?: string, timeout?: number) =>
    new OpenAI({baseURL: url, apiKey: apiKey || 'none', ...(timeout ? {timeout, maxRetries: 0} : {})})

function getClient() {
    if (!settings.url) throw new Error('No LLM server configured - run: bun run setup llm (or set FEVERSLOP_LLM_URL, or pass --llm-url)')
    return llmClient ??= newClient(settings.url, settings.apiKey)
}

/** The model ids on a server - used by the setup and to check the configured model. */
export async function listModels(url: string, apiKey?: string, timeout?: number) {
    const ids: string[] = []
    for await (const model of newClient(url, apiKey, timeout).models.list()) ids.push(model.id)
    return ids
}

// resolved on first use, so a fully cached project runs without the server
async function getModelId() {
    if (!modelId) {
        const client = getClient()
        const ids: string[] = []
        for await (const model of client.models.list()) ids.push(model.id)
        const list = ids.join(', ') || 'none'
        if (settings.model) {
            if (!ids.includes(settings.model)) throw new Error(`The LLM server ${settings.url} has no model "${settings.model}" (it has: ${list}) - pick one with: bun run setup llm-model`)
            modelId = settings.model
        } else if (ids.length === 1) {
            modelId = ids[0]!
        } else if (!ids.length) {
            throw new Error(`The LLM server ${settings.url} lists no models - load one on the server`)
        } else {
            throw new Error(`Several models on ${settings.url} (${list}) - pick one with: bun run setup llm-model`)
        }
        log.step('Model', `${styles.name(modelId)} ${styles.muted(`on ${settings.url}`)}`)
    }
    return modelId
}

export type ReasoningStrength = 'low' | 'medium' | 'high' | 'xhigh'

// Models control their thinking differently - the first matching entry wins,
// everything else gets the standard `reasoning.effort` field.
const reasoningAdapters: {
    match: RegExp,
    apply: (p: ResponseCreateParamsStreaming, level: ReasoningStrength) => ResponseCreateParamsStreaming
}[] = [
    // Muse Glimmer reads its reasoning effort from the system prompt
    {
        match: /muse/i,
        apply: (p, level) => ({...p, instructions: `Reasoning strength: ${level}\n\n${p.instructions ?? ''}`})
    },
    {
        match: /qwen3.8/i,
        apply: (p, level) => ({...p, chat_template_kwargs: {reasoning_effort: level}} as ResponseCreateParamsStreaming)
    },
]

function applyReasoning(prompt: ResponseCreateParamsStreaming, level: ReasoningStrength) {
    const adapter = reasoningAdapters.find(a => a.match.test(prompt.model ?? ''))
    return adapter ? adapter.apply(prompt, level) : {...prompt, reasoning: {effort: level}}
}

export async function fetchAndDisplayResponse(prompt: ResponseCreateParamsStreaming, reasoning: ReasoningStrength = 'low') {
    let thinking = ''
    let answer = ''
    let outputTokens: number | undefined
    let incomplete: string | undefined
    prompt = applyReasoning({...prompt, model: prompt.model ?? await getModelId()}, reasoning)

    const stopSpinner = startSpinner(() => {
        if (answer) return `${styles.answer('writing')} ${styles.muted(`${answer.length} chars`)}`
        if (thinking) return `${styles.thinking('thinking')} ${styles.muted(`${thinking.length} chars`)}`
        return styles.muted('waiting for model')
    })
    try {
        const stream = await getClient().responses.create(prompt)
        for await (const event of stream) {
            switch (event.type) {
                case 'response.reasoning_text.delta':
                case 'response.reasoning_summary_text.delta':
                    thinking += event.delta
                    break
                case 'response.output_text.delta':
                    answer += event.delta
                    break
                case 'response.completed':
                    outputTokens = event.response.usage?.output_tokens
                    break
                case 'response.incomplete':
                    outputTokens = event.response.usage?.output_tokens
                    incomplete = event.response.incomplete_details?.reason ?? 'unknown reason'
                    break
                case 'error':
                    throw new Error(event.message)
            }
        }
    } finally {
        stopSpinner()
    }
    log.step('Done', styles.muted(`${thinking.length} chars thinking (${reasoning}), ${answer.length} chars answer${outputTokens ? `, ${outputTokens} of ${prompt.max_output_tokens} tokens` : ''}`))
    // llama.cpp reports a cut-off answer as "completed" - all tokens used up means cut off, too
    const limit = prompt.max_output_tokens
    if (incomplete === 'max_output_tokens' || (limit && outputTokens !== undefined && outputTokens >= limit)) throw new TruncatedError(limit ?? 0)
    if (incomplete) log.warn(`the answer is incomplete: ${incomplete}`)
    return {thinking, answer}
}

/** The model hit max_output_tokens - thinking and answer together - before the answer was finished. */
export class TruncatedError extends Error {
    constructor(readonly maxTokens: number) {
        super(`the answer was cut off at max_output_tokens (${maxTokens}) - thinking and answer share that limit`)
    }
}

export type AskOptions = { instructions: string, input: string, maxTokens?: number, reasoning?: ReasoningStrength }

export async function ask({instructions, input, maxTokens = 8192, reasoning = 'low'}: AskOptions) {
    // a cut-off answer is useless (half a JSON) - once more with twice the room, the thinking length varies anyway
    for (const limit of [maxTokens, maxTokens * 2]) {
        try {
            const {answer} = await fetchAndDisplayResponse({max_output_tokens: limit, input, instructions, stream: true}, reasoning)
            if (!answer.trim()) log.warn(`empty answer - the model only thought`)
            return answer.trim()
        } catch (e) {
            if (!(e instanceof TruncatedError) || limit !== maxTokens) throw e
            log.warn(`${e.message} - asking again with ${limit * 2}`)
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

// Models like to wrap JSON in ```json fences or add a sentence around it
export async function askJson<T>(options: AskOptions): Promise<T> {
    const answer = await ask(options)
    const start = answer.search(/[{[]/)
    const end = Math.max(answer.lastIndexOf('}'), answer.lastIndexOf(']'))
    try {
        return JSON.parse(escapeControlCharsInStrings(answer.slice(start, end + 1)))
    } catch (e) {
        log.box('Unparsable answer', answer)
        throw new Error(`LLM did not answer with valid JSON: ${(e as Error).message}`)
    }
}
