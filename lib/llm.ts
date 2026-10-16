import {OpenAI} from "openai/client";
import type {ResponseCreateParamsStreaming} from "openai/resources/responses/responses";
import {currentStep, readTimings, recordTiming} from "./timings.ts";
import {predictLlmSeconds} from "./predict.ts";
import {countWords, formatDuration, formatRate, log, startSpinner, styles, suffix} from "./log.ts";

export type LlmSettings = { url?: string, apiKey?: string, model?: string, parallel?: number }

let settings: LlmSettings = {}
let llmClient: OpenAI | undefined
let modelId: Promise<string> | undefined

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

// resolved on first use, so a fully cached project runs without the server - once, also when the first calls run at once
function getModelId() {
    modelId ??= resolveModelId().catch(e => {
        modelId = undefined
        throw e
    })
    return modelId
}

async function resolveModelId() {
    const client = getClient()
    const ids: string[] = []
    for await (const model of client.models.list()) ids.push(model.id)
    const list = ids.join(', ') || 'none'
    let id: string
    if (settings.model) {
        if (!ids.includes(settings.model)) throw new Error(`The LLM server ${settings.url} has no model "${settings.model}" (it has: ${list}) - pick one with: bun run setup llm-model`)
        id = settings.model
    } else if (ids.length === 1) {
        id = ids[0]!
    } else if (!ids.length) {
        throw new Error(`The LLM server ${settings.url} lists no models - load one on the server`)
    } else {
        throw new Error(`Several models on ${settings.url} (${list}) - pick one with: bun run setup llm-model`)
    }
    log.step('Model', `${styles.name(id)} ${styles.muted(`on ${settings.url}${(settings.parallel ?? 1) > 1 ? `, up to ${settings.parallel} calls at once` : ''}`)}`)
    return id
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
    // Qwen 3.8 reads reasoning_effort from chat_template_kwargs, but only while enable_thinking is also true -
    // thinking is off by default, so reasoning_effort alone is silently ignored (no thinking at all, any level)
    {
        match: /qwen3\.8/i,
        apply: (p, level) => ({...p, chat_template_kwargs: {enable_thinking: true, reasoning_effort: level}} as ResponseCreateParamsStreaming)
    },
]

function applyReasoning(prompt: ResponseCreateParamsStreaming, level: ReasoningStrength) {
    const adapter = reasoningAdapters.find(a => a.match.test(prompt.model ?? ''))
    return adapter ? adapter.apply(prompt, level) : {...prompt, reasoning: {effort: level}}
}

export async function fetchAndDisplayResponse(prompt: ResponseCreateParamsStreaming, reasoning: ReasoningStrength = 'low') {
    let thinking = ''
    let answer = ''
    let usage: ResponseUsage | undefined
    let incomplete: string | undefined
    // a stream that ends without a terminal event was cut off by the connection or the server - what came before is not an answer
    let finished = false
    prompt = applyReasoning({...prompt, model: prompt.model ?? await getModelId()}, reasoning)
    const started = Date.now()
    const expected = predictLlmSeconds(readTimings(), prompt.model ?? '', currentStep())

    const stopSpinner = startSpinner(() => {
        if (answer) return `${styles.answer('writing')} ${styles.muted(`${countWords(answer)} words`)}`
        if (thinking) return `${styles.thinking('thinking')} ${styles.muted(`${countWords(thinking)} words`)}`
        return styles.muted(`waiting for model${expected ? ` (usually ~${formatDuration(expected * 1000)})` : ''}`)
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
        keepCall(prompt, started, usage, thinking, 'failed', e instanceof Error ? e.name : 'error')
        throw e
    } finally {
        stopSpinner()
    }
    const took = Date.now() - started
    const outputTokens = usage?.output_tokens
    if (!finished) {
        keepCall(prompt, started, usage, thinking, 'failed', 'no-end')
        throw new Error('the LLM stream ended without a completed or incomplete event - the answer is not complete')
    }
    log.step('Done', styles.muted(`${countWords(thinking)} words thinking (${reasoning}), ${countWords(answer)} words answer${outputTokens ? `, ${outputTokens} of ${prompt.max_output_tokens} tokens` : ''} · ${suffix(formatDuration(took), formatRate(outputTokens, took))}`))
    // llama.cpp reports a cut-off answer as "completed" - all tokens used up means cut off, too
    const limit = prompt.max_output_tokens
    const truncated = incomplete === 'max_output_tokens' || (!!limit && outputTokens !== undefined && outputTokens >= limit)
    // a cut-off or empty answer is asked for again (ask) - the call is kept as a retry, its tokens were spent all the same
    keepCall(prompt, started, usage, thinking, truncated ? 'retry' : answer.trim() ? undefined : 'retry', truncated ? 'truncated' : answer.trim() ? undefined : 'empty')
    if (truncated) throw new TruncatedError(limit ?? 0)
    if (incomplete) log.warn(`the answer is incomplete: ${incomplete}`)
    return {thinking, answer}
}

type ResponseUsage = { input_tokens?: number, output_tokens?: number, input_tokens_details?: { cached_tokens?: number }, output_tokens_details?: { reasoning_tokens?: number } }

/** Keeps one call in the central timings: durations and the token numbers the endpoint reported - nothing is estimated, and no text. */
function keepCall(prompt: ResponseCreateParamsStreaming, started: number, usage: ResponseUsage | undefined, thinking: string, outcome?: 'retry' | 'failed', reason?: string) {
    const ms = Date.now() - started
    const tokensPerSecond = usage?.output_tokens && ms > 0 ? Math.round(usage.output_tokens / (ms / 1000) * 10) / 10 : undefined
    const endpoint = settings.url ? new URL(settings.url).host : undefined
    recordTiming({
        kind: 'llm', name: prompt.model ?? '', seconds: Math.round(ms / 100) / 10, ...(currentStep() ? {step: currentStep()} : {}),
        ...(outcome ? {outcome, reason} : {}), ...(endpoint ? {endpoint} : {}),
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
}

/** The model finished every attempt without writing an answer - it only thought. */
export class EmptyAnswerError extends Error {
    constructor(readonly attempts: number) {
        super(`the model gave no answer in ${attempts} attempts, it only thought - try a lower reasoning effort or another model (bun run setup llm-model)`)
    }
}

const emptyAnswerNote = '\n\nKeep your thinking short and then write the answer itself - an empty answer is not acceptable.'

export async function ask({instructions, input, maxTokens = 8192, reasoning = 'low', images}: AskOptions) {
    const requestInput = images?.length
        ? [{role: 'user' as const, content: [{type: 'input_text' as const, text: input}, ...images.map(image_url => ({type: 'input_image' as const, image_url, detail: 'auto' as const}))]}]
        : input
    // A cut-off answer is useless (half a JSON), an empty one even more so - the model spent everything on thinking, which
    // varies a lot from run to run, and a small quant can loop in its thinking - more room at the same effort only
    // lets it loop longer. So the second try already has the prompt rewritten (think briefly, then answer) with a low
    // reasoning effort, and the last try gets even more room.
    const attempts = [
        {limit: maxTokens, level: reasoning, note: ''},
        {limit: maxTokens * 2, level: 'low' as ReasoningStrength, note: emptyAnswerNote},
        {limit: maxTokens * 4, level: 'low' as ReasoningStrength, note: emptyAnswerNote},
    ]
    for (const [i, {limit, level, note}] of attempts.entries()) {
        try {
            const {answer} = await fetchAndDisplayResponse({max_output_tokens: limit, input: requestInput, instructions: instructions + note, stream: true}, level)
            if (answer.trim()) return answer.trim()
            if (i === attempts.length - 1) throw new EmptyAnswerError(attempts.length)
            log.warn(`empty answer - the model only thought - asking again with ${attempts[i + 1]!.limit}${attempts[i + 1]!.note ? ' and a shorter-thinking prompt' : ''}`)
        } catch (e) {
            // only the first cut-off gets a second chance - after that the answer is too long for the model, not just unlucky
            if (!(e instanceof TruncatedError) || i !== 0) throw e
            log.warn(`${e.message} - asking again with ${attempts[1]!.limit} and a shorter-thinking prompt`)
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
