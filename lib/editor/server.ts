import {existsSync, statSync} from "node:fs";
import {extname, isAbsolute, join, relative, resolve, sep} from "node:path";
import {type EditorTarget, readEditorFreshness, readEditorProject, waveformSource} from "./project.ts";

// The workspace's server: one HTML page, what it shows of the project as JSON, and the project's pictures, videos and
// sound. It writes nothing and keeps nothing but the waveform of a song.

const PAGE = join(import.meta.dir, 'page.html')
// only what the page plays and shows - not project.json, the logs or the settings, whatever a path says
const MEDIA_TYPES: Record<string, string> = {
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.flac': 'audio/flac',
}

/** The file a /media/ path means, inside the project folder - undefined for anything else. */
export function mediaFile(dir: string, path: string): string | undefined {
    if (!(extname(path).toLowerCase() in MEDIA_TYPES)) return undefined
    const file = resolve(dir, path)
    const inside = relative(resolve(dir), file)
    // another drive on Windows: relative() gives an absolute path
    if (inside === '' || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) return undefined
    return existsSync(file) && statSync(file).isFile() ? file : undefined
}

/** bytes=a-b, bytes=a- or bytes=-n of a file of `size` bytes: first and last byte - undefined when it cannot be served. */
export function byteRange(header: string, size: number): { first: number, last: number } | undefined {
    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
    if (!match || (!match[1] && !match[2]) || size === 0) return undefined
    const first = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
    const last = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
    return first > last || first >= size ? undefined : {first, last}
}

// a video is only seekable in the browser when its bytes can be asked for piece by piece
function serveMedia(file: string, request: Request, versioned: boolean) {
    const blob = Bun.file(file)
    const headers = {
        'Content-Type': MEDIA_TYPES[extname(file).toLowerCase()]!,
        'Accept-Ranges': 'bytes',
        // ?v= is the file's modification time: another version of it has another address
        'Cache-Control': versioned ? 'private, max-age=86400, immutable' : 'no-cache',
    }
    const header = request.headers.get('range')
    if (!header) return new Response(blob, {headers})
    const range = byteRange(header, blob.size)
    if (!range) return new Response(null, {status: 416, headers: {'Content-Range': `bytes */${blob.size}`}})
    return new Response(blob.slice(range.first, range.last + 1), {
        status: 206,
        headers: {...headers, 'Content-Range': `bytes ${range.first}-${range.last}/${blob.size}`, 'Content-Length': String(range.last - range.first + 1)},
    })
}

const WAVEFORM_BUCKETS = 4000
const WAVEFORM_RATE = 4000

/**
 * How loud each of `buckets` equal parts of 16-bit mono sound is, 0 to 1 with 1 the loudest part. Loudness and not the
 * highest sample: in a mastered song nearly every part reaches the top, and the verses would look like the chorus.
 */
export function peaks(samples: Int16Array, buckets: number): number[] {
    const sums = new Array<number>(buckets).fill(0)
    const counts = new Array<number>(buckets).fill(0)
    for (let i = 0; i < samples.length; i++) {
        const bucket = Math.floor(i / samples.length * buckets)
        sums[bucket]! += samples[i]! * samples[i]!
        counts[bucket]!++
    }
    const levels = sums.map((sum, bucket) => counts[bucket] ? Math.sqrt(sum / counts[bucket]!) : 0)
    const loudest = Math.max(...levels, 1)
    return levels.map(level => Math.round(level / loudest * 1000) / 1000)
}

async function readWaveform(file: string): Promise<number[] | undefined> {
    const proc = Bun.spawn(['ffmpeg', '-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(WAVEFORM_RATE), '-f', 's16le', '-'], {stdout: 'pipe', stderr: 'ignore', stdin: 'ignore'})
    const bytes = await new Response(proc.stdout).arrayBuffer()
    if (await proc.exited !== 0) return undefined
    return peaks(new Int16Array(bytes, 0, Math.floor(bytes.byteLength / 2)), WAVEFORM_BUCKETS)
}

const THUMBNAIL_WIDTHS = [320, 640]
const THUMBNAILS_AT_ONCE = 4

/** A picture made small: forty 2 MP pictures on one timeline are more than a browser wants to paint at once. */
async function makeThumbnail(file: string, width: number): Promise<Uint8Array | undefined> {
    const proc = Bun.spawn(['ffmpeg', '-v', 'error', '-i', file, '-vf', `scale=${width}:-2`, '-frames:v', '1', '-c:v', 'mjpeg', '-q:v', '4', '-f', 'image2pipe', '-'], {stdout: 'pipe', stderr: 'ignore', stdin: 'ignore'})
    const bytes = new Uint8Array(await new Response(proc.stdout).arrayBuffer())
    return await proc.exited === 0 && bytes.length ? bytes : undefined
}

/** Runs what it is given, a few at a time. */
function limiter(atOnce: number) {
    let running = 0
    const waiting: (() => void)[] = []
    return async <T>(work: () => Promise<T>): Promise<T> => {
        if (running >= atOnce) await new Promise<void>(resolve => waiting.push(resolve))
        running++
        try {
            return await work()
        } finally {
            running--
            waiting.shift()?.()
        }
    }
}

const json = (value: unknown, status = 200) => Response.json(value, {status, headers: {'Cache-Control': 'no-store'}})
// a run can be writing a file just as it is read: the page keeps what it has and asks again
const failure = (e: unknown) => json({error: e instanceof Error ? e.message : String(e)}, 503)

export function editorHandler(target: EditorTarget) {
    const waveforms = new Map<string, Promise<number[] | undefined>>()
    const thumbnails = new Map<string, Promise<Uint8Array | undefined>>()
    const oneByOne = limiter(THUMBNAILS_AT_ONCE)
    return async (request: Request): Promise<Response> => {
        if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Read only', {status: 405})
        const url = new URL(request.url)
        const path = url.pathname
        if (path === '/') return new Response(Bun.file(PAGE), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache'}})
        try {
            if (path === '/api/project') return json(await readEditorProject(target))
            if (path === '/api/freshness') return json(await readEditorFreshness(target))
            if (path === '/api/waveform') {
                const source = waveformSource(await readEditorProject(target))
                const file = source && mediaFile(target.dir, source)
                if (!file) return json({peaks: null})
                const key = `${file}:${statSync(file).mtimeMs}`
                if (!waveforms.has(key)) waveforms.set(key, readWaveform(file).catch(() => undefined))
                return json({peaks: await waveforms.get(key) ?? null})
            }
        } catch (e) {
            return failure(e)
        }
        if (path.startsWith('/thumb/')) {
            const file = mediaFile(target.dir, decodeURIComponent(path.slice('/thumb/'.length)))
            const width = Number(url.searchParams.get('w') ?? THUMBNAIL_WIDTHS[0])
            if (!file || !THUMBNAIL_WIDTHS.includes(width) || !['.png', '.jpg', '.jpeg', '.webp'].includes(extname(file).toLowerCase())) return new Response('Not found', {status: 404})
            const key = `${file}:${width}:${statSync(file).mtimeMs}`
            if (!thumbnails.has(key)) thumbnails.set(key, oneByOne(() => makeThumbnail(file, width)).catch(() => undefined))
            const bytes = await thumbnails.get(key)
            // ffmpeg could not make one: the picture itself will do
            if (!bytes) return serveMedia(file, request, url.searchParams.has('v'))
            return new Response(bytes, {headers: {'Content-Type': 'image/jpeg', 'Cache-Control': url.searchParams.has('v') ? 'private, max-age=86400, immutable' : 'no-cache'}})
        }
        if (path.startsWith('/media/')) {
            const file = mediaFile(target.dir, decodeURIComponent(path.slice('/media/'.length)))
            return file ? serveMedia(file, request, url.searchParams.has('v')) : new Response('Not found', {status: 404})
        }
        return new Response('Not found', {status: 404})
    }
}

/** Serves on the first free port from `port` on, on this machine only. */
export function startEditor(target: EditorTarget, port: number) {
    const fetch = editorHandler(target)
    for (let attempt = 0; ; attempt++) {
        try {
            return Bun.serve({hostname: '127.0.0.1', port: port + attempt, idleTimeout: 0, fetch})
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE' || attempt >= 20) throw e
        }
    }
}
