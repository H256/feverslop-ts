/** What kind of no the server said (#837): a mistake in the input, a run holding the project, nothing there, an error of the workspace. */
export type ErrorKind = 'invalid' | 'busy' | 'missing' | 'failed' | 'unavailable'

/** A request the server refused or could not answer: its own words when it sent some, the status, and the kind of no. */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind?: ErrorKind,
    /** for an error of the workspace: the line of the code it happened in */
    readonly where?: string,
  ) {
    super(message)
  }
}

/** The error of an answer that is not ok: its words, kind and place as the server sent them, else the status. */
export function errorOfAnswer(body: unknown, status: number): HttpError {
  const said = (body && typeof body === 'object' ? body : {}) as {error?: unknown; kind?: unknown; where?: unknown}
  return new HttpError(
    typeof said.error === 'string' ? said.error : `Request failed (${status})`,
    status,
    typeof said.kind === 'string' ? (said.kind as ErrorKind) : undefined,
    typeof said.where === 'string' ? said.where : undefined,
  )
}

/**
 * A JSON request. A refusal says the server's words when it sent some; an answer that is not JSON is a failure too, said where it
 * happened - never data that is undefined further on. An abort while reading stays an abort.
 */
async function send<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {...init, headers: {Accept: 'application/json', ...init.headers}})
  const text = await response.text()
  let body: unknown
  let readable = true
  try {
    body = JSON.parse(text)
  } catch {
    readable = false
  }
  if (!response.ok) throw errorOfAnswer(body, response.status)
  if (!readable) throw new HttpError(`The answer of ${url.split('?')[0]} is not JSON`, response.status)
  return body as T
}

export const getJson = <T>(url: string, signal?: AbortSignal) => send<T>(url, {signal})
export const postJson = <T>(url: string, body: unknown, signal?: AbortSignal) =>
  send<T>(url, {method: 'POST', signal, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})
export const postForm = <T>(url: string, form: FormData) => send<T>(url, {method: 'POST', body: form})
/** An aborted request is nobody's failure: it was not wanted any more. */
export const isAbort = (cause: unknown) => cause instanceof DOMException && cause.name === 'AbortError'
