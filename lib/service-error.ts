/**
 * Says who failed, for an error that came back from a server as it was ("502 Bad Gateway", "The operation timed out.").
 * The same error stays, its status and class still count. `known`: the text that shows a message names it already.
 */
export function nameService(e: unknown, who: string, known = who): Error {
    const error = e instanceof Error ? e : new Error(String(e))
    if (error.message.includes(known)) return error
    const status = (error as { status?: number }).status
    const shown = status && !error.message.startsWith(String(status)) ? `HTTP ${status} ${error.message}` : error.message
    error.message = `${who}: ${shown || 'no message'}`
    return error
}
