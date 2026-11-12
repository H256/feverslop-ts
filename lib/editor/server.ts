import {boundedMemo} from './memo.ts'
import {statSync} from 'node:fs'
import {extname} from 'node:path'
import {peaks} from '../waveform.ts'
import {libraryDir} from '../library.ts'
import {listProjects, projectDir, projectExists, validProjectId} from '../project-setup.ts'
import {filmDir, filmExists, filmIds} from '../film/setup.ts'
import {statsView} from './stats.ts'
import {type EditorKind, type EditorTarget, readListing} from './project.ts'
import {RunControl} from './runs.ts'
import {readServers} from './servers.ts'
import {clientStatic, requireClientBuild, type EditorOptions} from './static.ts'
import {PROJECT_PAGES, type NewFilm, type NewProject, type SetupChange} from '../../shared/workspace.ts'
import {doctor} from '../doctor.ts'
import {settingsView} from '../setup-options.ts'
import {runSetup} from './setup-run.ts'
import {createFilm, createProject} from './new-project.ts'
import {failure, json, MEDIA_TYPES, mediaFile, notFound, refused} from './http.ts'
import {findRoute, LIBRARY_ROUTES, PROJECT_ROUTES, type Route} from './project-routes.ts'
// what the tests and the tools take from the server, from where it lives now
export {answerOf, eventCursor, mediaFile, runEvents} from './http.ts'
export {peaks}

// The workspace's server: one HTML page, what it shows of the projects as JSON, and their pictures, videos and sound. What it changes
// goes through the CLI (RunControl) or under the project's lock; it keeps nothing but thumbnails and waveforms in memory.

/** bytes=a-b, bytes=a- or bytes=-n of a file of `size` bytes: first and last byte - undefined when it cannot be served. */
export function byteRange(header: string, size: number): {first: number; last: number} | undefined {
    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
    if (!match || (!match[1] && !match[2]) || size === 0) return undefined
    const first = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
    const last = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
    return first > last || first >= size ? undefined : {first, last}
}

// what one answer to a range gives at most: the browser asks for the next piece itself
export const MEDIA_PIECE_BYTES = 4 * 1024 * 1024

/**
 * A video is only seekable in the browser when its bytes can be asked for piece by piece. A piece is read whole and the file let
 * go before it is sent: a paused player keeps its request open, and on Windows an open file cannot be replaced - a label or an
 * intro made again over the video the page shows failed with EPERM.
 */
async function serveMedia(file: string, request: Request, versioned: boolean) {
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
    const last = Math.min(range.last, range.first + MEDIA_PIECE_BYTES - 1)
    const bytes = await blob.slice(range.first, last + 1).arrayBuffer()
    return new Response(bytes, {
        status: 206,
        headers: {...headers, 'Content-Range': `bytes ${range.first}-${last}/${blob.size}`, 'Content-Length': String(bytes.byteLength)},
    })
}

const THUMBNAIL_WIDTHS = [320, 640]
const THUMBNAILS_AT_ONCE = 4

/** A picture made small: forty 2 MP pictures on one timeline are more than a browser wants to paint at once. */
async function makeThumbnail(file: string, width: number): Promise<Uint8Array | undefined> {
    const proc = Bun.spawn(
        ['ffmpeg', '-v', 'error', '-i', file, '-vf', `scale=${width}:-2`, '-frames:v', '1', '-c:v', 'mjpeg', '-q:v', '4', '-f', 'image2pipe', '-'],
        {stdout: 'pipe', stderr: 'ignore', stdin: 'ignore'},
    )
    const bytes = new Uint8Array(await new Response(proc.stdout).arrayBuffer())
    return (await proc.exited) === 0 && bytes.length ? bytes : undefined
}

/** Runs what it is given, a few at a time. */
function limiter(atOnce: number) {
    let running = 0
    const waiting: (() => void)[] = []
    return async <T>(work: () => Promise<T>): Promise<T> => {
        if (running >= atOnce) await new Promise<void>(next => waiting.push(next))
        running++
        try {
            return await work()
        } finally {
            running--
            waiting.shift()?.()
        }
    }
}

/** A request from anywhere but this page must not start GPU work or change files: another site's page can reach 127.0.0.1 too. */
export function fromThisPage(request: Request): boolean {
    const origin = request.headers.get('origin')
    const site = request.headers.get('sec-fetch-site')
    if (site && site !== 'same-origin' && site !== 'none') return false
    return !origin || new URL(origin).host === new URL(request.url).host
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

function targetOf(kind: string, id: string): EditorTarget | undefined {
    if (!validProjectId(id)) return undefined
    if (kind === 'music' && projectExists(id)) return {id, kind, dir: projectDir(id)}
    if (kind === 'film' && filmExists(id)) return {id, kind, dir: filmDir(id)}
    return undefined
}

const allTargets = (): EditorTarget[] => [
    ...listProjects().map(id => ({id, kind: 'music' as EditorKind, dir: projectDir(id)})),
    ...filmIds().map(id => ({id, kind: 'film' as EditorKind, dir: filmDir(id)})),
]

export function editorHandler(runs = new RunControl(), options: EditorOptions = {}) {
    // bounded: a re-rendered file is a new key, the entries of its old versions must not stay forever
    const waveform = boundedMemo<Promise<number[] | undefined>>(100)
    const thumbnailOf = boundedMemo<Promise<Uint8Array | undefined>>(300)
    const oneByOne = limiter(THUMBNAILS_AT_ONCE)

    // every page is the built client: its router shows the page of the address
    const serveClient = clientStatic(options.publicDir)
    const page = (request: Request) => serveClient(request, 'index.html')

    const thumbnail = async (file: string | undefined, url: URL, request: Request) => {
        const width = Number(url.searchParams.get('w') ?? THUMBNAIL_WIDTHS[0])
        if (!file || !THUMBNAIL_WIDTHS.includes(width) || !['.png', '.jpg', '.jpeg', '.webp'].includes(extname(file).toLowerCase())) return notFound()
        const key = `${file}:${width}:${statSync(file).mtimeMs}`
        const bytes = await thumbnailOf(key, () => oneByOne(() => makeThumbnail(file, width)).catch(() => undefined))
        // ffmpeg could not make one: the picture itself will do
        if (!bytes) return serveMedia(file, request, url.searchParams.has('v'))
        return new Response(bytes, {
            headers: {'Content-Type': 'image/jpeg', 'Cache-Control': url.searchParams.has('v') ? 'private, max-age=86400, immutable' : 'no-cache'},
        })
    }

    /** A route of a table (lib/editor/project-routes.ts) for the request: a mistake of a GET is a failure, of a POST a refusal. */
    const answer = async (routes: readonly Route[], target: EditorTarget, rest: string[], request: Request, url: URL): Promise<Response> => {
        const post = request.method === 'POST'
        const found = findRoute(routes, post ? 'POST' : 'GET', rest)
        if (!found) return notFound()
        try {
            return await found.route.handle({
                target,
                id: found.id,
                request,
                url,
                body: async <T>() => (await request.json()) as T,
                runs,
                waveform,
            })
        } catch (e) {
            return post ? refused(e) : failure(e)
        }
    }
    const projectApi = (target: EditorTarget, rest: string[], request: Request, url: URL) => answer(PROJECT_ROUTES, target, rest, request, url)
    const libraryApi = async (rest: string[], request: Request, url: URL) =>
        answer(LIBRARY_ROUTES, {id: 'library', kind: 'music', dir: await libraryDir()}, rest, request, url)

    return async (request: Request): Promise<Response> => {
        const url = new URL(request.url)
        // a page of another site cannot read these through a name it points at this machine
        if (!LOCAL_HOSTS.has(url.hostname)) return new Response('Forbidden', {status: 403})
        const post = request.method === 'POST'
        if (!post && request.method !== 'GET' && request.method !== 'HEAD') return new Response('Not allowed', {status: 405})
        if (post && !fromThisPage(request)) return new Response('Forbidden', {status: 403})
        try {
            const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
            if (parts[0] === 'workspace-assets') return post ? notFound() : serveClient(request, parts.slice(1).join('/'))
            if (parts.length === 0 || (parts.length === 1 && (parts[0] === 'library' || parts[0] === 'stats'))) return post ? notFound() : page(request)
            if (parts[0] === 'api') {
                if (parts[1] === 'projects' && !post)
                    return json({
                        projects: allTargets()
                            .flatMap(target => {
                                try {
                                    return [readListing(target)]
                                } catch {
                                    return []
                                }
                            })
                            .sort((a, b) => b.changed - a.changed),
                    })
                if (parts[1] === 'servers' && !post) return json({servers: await readServers()})
                // what this machine has of what a video needs: `bun run doctor`, asked by the start page (#831)
                if (parts[1] === 'doctor' && !post) return json({checks: await doctor()})
                // the servers of this machine: bun run setup show --json, and a change of them by bun run setup <command> --… (#831)
                if (parts[1] === 'setup' && !post) return json(await settingsView())
                if (parts[1] === 'setup' && post) {
                    try {
                        return json(await runSetup((await request.json()) as SetupChange))
                    } catch (e) {
                        return refused(e)
                    }
                }
                // a new music video: `bun run init <id> …` with the form as its options
                if (parts[1] === 'projects' && parts[2] === 'new' && post) {
                    try {
                        return json(await createProject((await request.json()) as NewProject))
                    } catch (e) {
                        return refused(e)
                    }
                }
                // a new film: `bun run film:init <id> …` with the form as its options (#831)
                if (parts[1] === 'films' && parts[2] === 'new' && post) {
                    try {
                        return json(await createFilm((await request.json()) as NewFilm))
                    } catch (e) {
                        return refused(e)
                    }
                }
                // the measured times of this machine: bun run stats --json (#836)
                if (parts[1] === 'stats' && !post) {
                    try {
                        return json(await statsView({since: url.searchParams.get('since') ?? undefined, kind: url.searchParams.get('kind') ?? undefined}))
                    } catch (e) {
                        return refused(e)
                    }
                }
                if (parts[1] === 'library') return libraryApi(parts.slice(2), request, url)
                return notFound()
            }
            if (parts[0] === 'library' && (parts[1] === 'media' || parts[1] === 'thumb')) {
                const inside = parts.slice(2).join('/')
                // an asset being made is not part of the library yet
                const file = inside.startsWith('.') ? undefined : mediaFile(await libraryDir(), inside)
                if (parts[1] === 'thumb') return thumbnail(file, url, request)
                return file ? serveMedia(file, request, url.searchParams.has('v')) : notFound()
            }
            if (parts[0] === 'p') {
                const target = targetOf(parts[1] ?? '', parts[2] ?? '')
                if (!target) return notFound()
                const area = parts[3]
                if (area === 'api') return projectApi(target, parts.slice(4), request, url)
                if (area === 'media' || area === 'thumb') {
                    const file = mediaFile(target.dir, parts.slice(4).join('/'))
                    if (area === 'thumb') return thumbnail(file, url, request)
                    return file ? serveMedia(file, request, url.searchParams.has('v')) : notFound()
                }
                if (parts.length > 4 || (area && !(PROJECT_PAGES as readonly string[]).includes(area))) return notFound()
                return post ? notFound() : page(request)
            }
        } catch (e) {
            return failure(e)
        }
        return notFound()
    }
}

/** Serves on the first free port from `port` on, on this machine only. */
export function startEditor(port: number) {
    requireClientBuild()
    const runs = new RunControl()
    const fetch = editorHandler(runs)
    // what waits in a queue - also left by an editor before this one - is started as its project is free (#837)
    runs.watchQueues(allTargets)
    for (let attempt = 0; ; attempt++) {
        try {
            return Bun.serve({hostname: '127.0.0.1', port: port + attempt, idleTimeout: 0, fetch})
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE' || attempt >= 20) throw e
        }
    }
}
