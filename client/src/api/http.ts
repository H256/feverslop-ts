/** A request the server refused or could not answer: its own words when it sent some, and the status. */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
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
  if (!response.ok) {
    const said = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : `Request failed (${response.status})`
    throw new HttpError(said, response.status)
  }
  if (!readable) throw new HttpError(`The answer of ${url.split('?')[0]} is not JSON`, response.status)
  return body as T
}

export const getJson = <T>(url: string, signal?: AbortSignal) => send<T>(url, {signal})
export const postJson = <T>(url: string, body: unknown, signal?: AbortSignal) =>
  send<T>(url, {method: 'POST', signal, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})
export const postForm = <T>(url: string, form: FormData) => send<T>(url, {method: 'POST', body: form})
/** An aborted request is nobody's failure: it was not wanted any more. */
export const isAbort = (cause: unknown) => cause instanceof DOMException && cause.name === 'AbortError'
