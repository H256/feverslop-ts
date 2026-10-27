import {formatDuration} from "./log.ts";
import type {Timing} from "./timings.ts";

// How long what is left will take, from what was measured before. Medians, not means: durations vary with whatever
// else uses the GPU. Nothing is invented - a job without a comparable measurement is counted as "no data".

export const median = (values: number[]) => percentile(values, 0.5)

/** Linear percentile (0..1) - 0 for no values. */
export function percentile(values: number[], p: number) {
    if (!values.length) return 0
    const sorted = [...values].sort((a, b) => a - b)
    const at = (sorted.length - 1) * p
    const lower = Math.floor(at)
    return sorted[lower]! + (sorted[Math.ceil(at)]! - sorted[lower]!) * (at - lower)
}

export type RenderJob = { kind: 'picture' | 'clip', name: string, workflowHash?: string, frames?: number, resolution?: number | string }
export type Basis = 'measured' | 'extrapolated' | 'none'
export type Prediction = {
    seconds?: number          // time of one job on all servers together (1 / summed throughput)
    basis: Basis
    samples: number
    servers: string[]         // the servers it is based on
}

const size = (frames: number | undefined, pixels: number | undefined) => (frames ?? 1) * (pixels ?? 1)

/**
 * The pixels of a measured job in the unit of its resolution setting, the graph's own size only when the setting names
 * none (-1, a sheet video): a two-pass workflow's graph says its first pass (960x544) while "videoResolution": 2 is 2 MP.
 */
const pixelsOf = (t: Timing) => (t.resolution !== undefined ? resolutionPixels(t.resolution) : undefined) ?? t.pixels

/** Pixels of a resolution setting: a number is megapixels, "1280x720" a size, -1 the workflow's own default (unknown here). */
export function resolutionPixels(resolution: number | string): number | undefined {
    if (typeof resolution === 'number') return resolution > 0 ? Math.round(resolution * 1e6) : undefined
    const [w, h] = resolution.split('x').map(Number)
    return w && h ? w * h : undefined
}

/**
 * Same workflow file (so same variant) on the same server → the median of the jobs of the same size, "measured";
 * another resolution or frame count → the median time per frame × pixel of that variant, scaled, "extrapolated".
 * Cold starts and failed tries are left out. Servers without a measurement do not contribute (the estimate is then
 * on the safe side). No measurement at all → basis 'none', no number.
 */
export function predictJob(timings: Timing[], job: RenderJob, servers: string[]): Prediction {
    const same = timings.filter(t => t.kind === job.kind && t.name === job.name && !t.outcome && !t.cold && !!t.variant
        && !!job.workflowHash && t.workflowHash === job.workflowHash && pixelsOf(t) && t.seconds > 0)
    const variant = same.at(-1)?.variant
    const ofVariant = same.filter(t => t.variant === variant)
    // the workflow's own default size (resolution -1) is the size of its earlier jobs
    const last = ofVariant.at(-1)
    const pixels = (job.resolution !== undefined ? resolutionPixels(job.resolution) : undefined) ?? (last && pixelsOf(last))
    let throughput = 0
    let basis: Basis = 'measured'
    let samples = 0
    const used: string[] = []
    for (const server of servers) {
        const mine = ofVariant.filter(t => t.server === server)
        if (!mine.length) continue
        const exact = mine.filter(t => (t.frames ?? 1) === (job.frames ?? 1) && pixelsOf(t) === pixels)
        let seconds: number
        if (exact.length) {
            seconds = median(exact.map(t => t.seconds))
            samples += exact.length
        } else {
            seconds = median(mine.map(t => t.seconds / size(t.frames, pixelsOf(t)))) * size(job.frames, pixels)
            basis = 'extrapolated'
            samples += mine.length
        }
        throughput += 1 / seconds
        used.push(server)
    }
    return throughput ? {seconds: 1 / throughput, basis, samples, servers: used} : {basis: 'none', samples: 0, servers: []}
}

export type ProjectPrediction = { seconds: number, jobs: number, known: number, extrapolated: number, samples: number, servers: string[] }

/** The whole of what is missing: the sum of the jobs with a prediction; the rest is counted as unknown, not guessed. */
export function predictJobs(timings: Timing[], jobs: RenderJob[], servers: string[]): ProjectPrediction {
    const result: ProjectPrediction = {seconds: 0, jobs: jobs.length, known: 0, extrapolated: 0, samples: 0, servers: []}
    for (const job of jobs) {
        const p = predictJob(timings, job, servers)
        if (p.seconds === undefined) continue
        result.seconds += p.seconds
        result.known++
        result.samples = Math.max(result.samples, p.samples)
        if (p.basis === 'extrapolated') result.extrapolated++
        result.servers = [...new Set([...result.servers, ...p.servers])]
    }
    return result
}

/** "12 clips left: about 1h 40m (measured, median of 31 jobs on gpu1)" - or the honest "no data". */
export function describePrediction(noun: string, p: ProjectPrediction) {
    const left = `${p.jobs} ${noun}${p.jobs === 1 ? '' : 's'} left`
    if (!p.jobs) return left
    if (!p.known) return `${left}: no data for this workflow variant yet, measured during this run`
    const how = p.extrapolated ? `extrapolated from other sizes of the same variant, ${p.samples} jobs` : `measured, median of up to ${p.samples} jobs`
    const missing = p.jobs - p.known
    return `${left}: about ${formatDuration(p.seconds * 1000)} (${how} on ${p.servers.join(', ')})${missing ? `, ${missing} without data not counted` : ''}`
}

/** An LLM step: the output length it had before ÷ the tokens/s the model reaches. Only from reported numbers. */
export function predictLlmSeconds(timings: Timing[], model: string, step: string | undefined): number | undefined {
    const calls = timings.filter(t => t.kind === 'llm' && t.name === model && !t.outcome)
    const rates = calls.flatMap(t => t.tokensPerSecond ? [t.tokensPerSecond] : [])
    const lengths = calls.filter(t => t.step === step).flatMap(t => t.completionTokens ? [t.completionTokens] : [])
    if (!rates.length || !lengths.length) return undefined
    return median(lengths) / median(rates)
}

export type TokenSums = { calls: number, prompt: number, completion: number, reasoning: number, cached: number }

/** Token sums per key (step, project, model …) - only calls that reported usage count their tokens. */
export function sumTokens(timings: Timing[], key: (t: Timing) => string): Map<string, TokenSums> {
    const sums = new Map<string, TokenSums>()
    for (const t of timings) {
        // a cut-off or empty answer is kept as a retry: its tokens were spent all the same
        if (t.kind !== 'llm' || t.outcome === 'failed' || t.outcome === 'again') continue
        const sum = sums.get(key(t)) ?? {calls: 0, prompt: 0, completion: 0, reasoning: 0, cached: 0}
        sum.calls++
        sum.prompt += t.promptTokens ?? 0
        sum.completion += t.completionTokens ?? 0
        sum.reasoning += t.reasoningTokens ?? 0
        sum.cached += t.cachedTokens ?? 0
        sums.set(key(t), sum)
    }
    return sums
}

export type Price = { inputPerMillion: number, outputPerMillion: number, currency?: string }

/** Tokens × the price per million (from the settings) - undefined when the model has no price. Reasoning tokens are part of the completion. */
export const cost = (sum: TokenSums, price: Price | undefined) =>
    price ? (sum.prompt * price.inputPerMillion + sum.completion * price.outputPerMillion) / 1e6 : undefined
