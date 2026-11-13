// Values that come from outside the code - an LLM answer, JSON, a form, a thrown value - as text (#891). An object that is not
// text must not end up as "[object Object]" in a prompt or a log line: a string is taken as it is, anything else is said for what
// it is, or left out where only text belongs.

/** Text where only text belongs (a prompt, a description): a string as it is, anything else nothing. */
export const textOf = (value: unknown): string => (typeof value === 'string' ? value : '')

/** A value shown to the user: a string as it is, a number or a boolean as written, nothing as nothing, anything else as JSON. */
export function shownOf(value: unknown): string {
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
    if (value === undefined || value === null) return ''
    return JSON.stringify(value) ?? ''
}

/** What went wrong, from a caught value: the message of an error, else the value shown. */
export const messageOf = (e: unknown): string => (e instanceof Error ? e.message : shownOf(e))
