/**
 * Says who failed, for an error that came back from a server as it was ("502 Bad Gateway", "The operation timed out.").
 * The same error stays, its status and class still count. `known`: the text that shows a message names it already.
 */
export function nameService(e: unknown, who: string, known = who): Error {
    const error = e instanceof Error ? e : new Error(String(e))
    if (error.message.includes(known)) return error
    const status = (error as {status?: number}).status
    const shown = status && !error.message.startsWith(String(status)) ? `HTTP ${status} ${error.message}` : error.message
    error.message = `${who}: ${shown || 'no message'}`
    return error
}

/**
 * What kind of no an answer of the workspace is (#837), so that the page can tell them apart: `invalid` - something about the input
 * (400), `busy` - a run holds the project (423), `missing` - no such thing (404), `failed` - an error of the workspace itself (500),
 * `unavailable` - a file being written just as it was read, asked again (503).
 */
export type ErrorKind = 'invalid' | 'busy' | 'missing' | 'failed' | 'unavailable'
export const STATUS_OF: Record<ErrorKind, number> = {invalid: 400, busy: 423, missing: 404, failed: 500, unavailable: 503}

/** An error that knows its kind: thrown where the kind is known - by a check of the input, by a lock, by a lookup. */
export class KindError extends Error {
    constructor(
        readonly kind: ErrorKind,
        message: string,
    ) {
        super(message)
    }
}
export const invalid = (message: string) => new KindError('invalid', message)
export const busy = (message: string) => new KindError('busy', message)
export const missing = (message: string) => new KindError('missing', message)

/**
 * The kind of an error that does not say it. A TypeError, ReferenceError or RangeError is a bug of the code, as is a failed system
 * call (an error with a `code`); a request body that is not JSON, or an address that cannot be decoded, is invalid. Any other error is the words of one of our checks: a
 * refusal of a write (`invalid`), or - for a read - a file being written just then (`unavailable`).
 */
export function kindOf(e: unknown, writing: boolean): ErrorKind {
    if (e instanceof KindError) return e.kind
    if (e instanceof SyntaxError) return writing ? 'invalid' : 'unavailable'
    // an address that cannot be decoded (%zz)
    if (e instanceof URIError) return 'invalid'
    if (e instanceof TypeError || e instanceof ReferenceError || e instanceof RangeError) return 'failed'
    if (e instanceof Error && typeof (e as {code?: unknown}).code === 'string') return 'failed'
    return writing ? 'invalid' : 'unavailable'
}
