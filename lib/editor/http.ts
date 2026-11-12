import {existsSync, statSync} from 'node:fs'
import {extname, isAbsolute, relative, resolve, sep} from 'node:path'
import type {RunEvents} from '../../shared/workspace.ts'
import {kindOf, STATUS_OF} from '../service-error.ts'
import {peaks} from '../waveform.ts'
import type {EditorTarget} from './project.ts'
import type {RunControl} from './runs.ts'

// The answers of the workspace's server, shared by its routes (lib/editor/project-routes.ts) and its top level (server.ts): JSON and
// refusals, the files it may serve, a song's waveform, and the lines of a run as they come.

// only what the page plays and shows - not project.json, the logs or the settings, whatever a path says
export const MEDIA_TYPES: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.flac': 'audio/flac',
}

/** The file a /media/ path means, inside the folder - undefined for anything else. */
export function mediaFile(dir: string, path: string): string | undefined {
    if (!(extname(path).toLowerCase() in MEDIA_TYPES)) return undefined
    const file = resolve(dir, path)
    const inside = relative(resolve(dir), file)
    // another drive on Windows: relative() gives an absolute path
    if (inside === '' || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) return undefined
    return existsSync(file) && statSync(file).isFile() ? file : undefined
}

const WAVEFORM_BUCKETS = 4000
const WAVEFORM_RATE = 4000

export async function readWaveform(file: string): Promise<number[] | undefined> {
    const proc = Bun.spawn(['ffmpeg', '-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(WAVEFORM_RATE), '-f', 's16le', '-'], {
        stdout: 'pipe',
        stderr: 'ignore',
        stdin: 'ignore',
    })
    const bytes = await new Response(proc.stdout).arrayBuffer()
    if ((await proc.exited) !== 0) return undefined
    return peaks(new Int16Array(bytes, 0, Math.floor(bytes.byteLength / 2)), WAVEFORM_BUCKETS)
}

export const json = (value: unknown, status = 200) => Response.json(value, {status, headers: {'Cache-Control': 'no-store'}})
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
/**
 * A no, by its kind (#837): the page shows a mistake in the input at the form, a lock with the run that holds it, and an error of the
 * workspace as one - with where it happened, to copy into a report. A run can be writing a file just as it is read: a read that fails
 * otherwise is `unavailable`, and the page keeps what it has and asks again.
 */
export function answerOf(e: unknown, writing: boolean): Response {
    const kind = kindOf(e, writing)
    if (kind === 'failed') {
        console.error(e)
        const where =
            e instanceof Error
                ? e.stack
                      ?.split('\n')
                      .find(line => line.trim().startsWith('at '))
                      ?.trim()
                : undefined
        return json({error: message(e), kind, where}, STATUS_OF[kind])
    }
    return json({error: message(e), kind}, STATUS_OF[kind])
}
export const failure = (e: unknown) => answerOf(e, false)
export const refused = (e: unknown) => answerOf(e, true)
export const notFound = () => new Response('Not found', {status: 404})
export const stripColors = (text: string) => Bun.stripANSI(text)

/**
 * Where the lines of a run go on from: the cursor the page asked for, or - when the browser reconnects by itself - the id of the last
 * lines event it got (the cursor after it), so that no line comes twice.
 */
export function eventCursor(request: Request, after: number) {
    const last = Number(request.headers.get('last-event-id') ?? NaN)
    return Number.isInteger(last) && last >= 0 ? last : after
}

/** The lines of a run as they come, as server-sent events: a page can come and go, and follow a run it did not start. */
export function runEvents(runs: RunControl, target: EditorTarget, request: Request, from: number) {
    let after = eventCursor(request, from)
    let timer: ReturnType<typeof setInterval> | undefined
    const stream = new ReadableStream({
        start(controller) {
            // what one tick has to say goes out as one chunk
            let said = ''
            const send = (event: string, data: unknown, id?: number) => {
                said += `${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
            }
            let wasRunning: boolean | undefined
            // the events of the newest run (#829): from its start for a new connection or a new run, then what was added
            let eventsFile: string | undefined | null = null
            let eventsSent = 0
            const tick = () => {
                said = ''
                try {
                    const {lines, next} = runs.lines(target, after)
                    after = next
                    if (lines.length) send('lines', {lines: lines.map(stripColors), next}, next)
                    const current = runs.current(target)
                    if ((current?.running ?? false) !== wasRunning) {
                        wasRunning = current?.running ?? false
                        send('state', current ?? null)
                    }
                    const {file, events} = runs.events(target)
                    if (file !== eventsFile) {
                        // another run (or the first look): its events from the start, even none - the page drops what it had
                        eventsFile = file
                        send('events', {events, from: 0, next: events.length} satisfies RunEvents)
                        eventsSent = events.length
                    } else if (events.length > eventsSent) {
                        send('events', {events: events.slice(eventsSent), from: eventsSent, next: events.length} satisfies RunEvents)
                        eventsSent = events.length
                    }
                    if (said) controller.enqueue(new TextEncoder().encode(said))
                } catch {
                    // a log being replaced, or the page gone: the next tick sees
                }
            }
            tick()
            timer = setInterval(tick, 700)
            request.signal.addEventListener('abort', () => {
                clearInterval(timer)
                try {
                    controller.close()
                } catch {}
            })
        },
        cancel() {
            clearInterval(timer)
        },
    })
    return new Response(stream, {headers: {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store'}})
}
