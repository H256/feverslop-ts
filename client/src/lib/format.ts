import {HttpError} from '../api/http'
/** Seconds as m:ss.s, or m:ss when not precise. */
export function clock(seconds: number, precise = true) {
  const whole = Math.max(0, seconds)
  const minutes = Math.floor(whole / 60)
  const rest = whole - minutes * 60
  return precise ? `${minutes}:${rest.toFixed(1).padStart(4, '0')}` : `${minutes}:${String(Math.floor(rest)).padStart(2, '0')}`
}
export const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
export const dateOf = (ms: number) => new Date(ms).toLocaleString(undefined, {dateStyle: 'short', timeStyle: 'short'})
/** A text of the plan as the person reads it: the cast's {Name} tokens as names (#834). Edited, a text keeps its tokens. */
export const withNames = (text: string) => text.replace(/\{([^{}\n]{1,80})\}/g, '$1')
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
/** The steps a change drops, in words. */
export const listSteps = (steps: string[]) => steps.join(', ')
/**
 * An error as the person reads it. By the kind the server said (#837): a run holding the project says what to do about it, an error
 * of the workspace says that it is one - and where, to copy into a report. A mistake in the input is its own words.
 */
export function errorText(cause: unknown): string {
  if (!(cause instanceof Error)) return String(cause)
  if (cause instanceof HttpError && cause.kind === 'busy') return `${cause.message}. Wait for the run to end, or stop it in the run dock.`
  if (cause instanceof HttpError && cause.kind === 'failed')
    return `An error of the workspace, not of what you did: ${cause.message}${cause.where ? ` (${cause.where})` : ''}. To report it, copy this text.`
  return cause.message
}
/** The words that are there, the empty ones left out. */
export const joined = (parts: (string | false | undefined | null)[], by = ' · ') => parts.filter(Boolean).join(by)
