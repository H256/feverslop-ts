import {existsSync, mkdtempSync, statSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {extname, isAbsolute, join, relative, resolve, sep} from "node:path";
import {clipVersions} from "../archive.ts";
import type {ClipRequest} from "../compose.ts";
import {loadProjectConfig} from "../config.ts";
import {libraryDir, libraryIdPattern} from "../library.ts";
import {listProjects, projectDir, projectExists, validProjectId} from "../project-setup.ts";
import {clipEstimate, clipFailureRisks, pictureEstimate, readClipRequests} from "../render-state.ts";
import {loadSettings} from "../settings.ts";
import {filmStatus, projectStatus} from "../status.ts";
import {readTimings} from "../timings.ts";
import {loadFilmConfig} from "../film/config.ts";
import {filmRenderConfig} from "../film/pictures.ts";
import {filmDir, filmExists, filmIds} from "../film/setup.ts";
import {readCasting, readLibrary, writeCastingEntry} from "./library.ts";
import {clipRequestId, type EditorKind, type EditorOverride, type EditorTarget, readEditorFreshness, readEditorProject, readListing, waveformSource} from "./project.ts";
import {picturesFile, readReferences} from "./references.ts";
import {readSinging, type SingingChange, writeSinging} from "./singing.ts";
import {pickVersion, writeOverride} from "./choices.ts";
import {type CastChange, castingRedo, dropStoryProposal, type LookChange, readBook, readCast, readLook, stageOf, writeCast, writeLook, writeStory, writeStoryForCast} from "./preproduction.ts";
import {readTiming, type TimingChange, writeTiming} from "./timing.ts";
import {runProgress} from "./progress.ts";
import {type RunAction, RunControl} from "./runs.ts";
import {readServers, urlsOfChoice} from "./servers.ts";
import {readPictureJobs} from "../render-state.ts";
import {clientStatic, editorUI, requireClientBuild, type EditorUIOptions} from './static.ts';

// The workspace's server: one HTML page, what it shows of the projects as JSON, and their pictures, videos and sound. What it changes
// goes through the CLI (RunControl) or under the project's lock; it keeps nothing but thumbnails and waveforms in memory.

const PAGE = join(import.meta.dir, 'page.html')
// only what the page plays and shows - not project.json, the logs or the settings, whatever a path says
const MEDIA_TYPES: Record<string, string> = {
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.flac': 'audio/flac',
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

/** The loudness at a fixed rate (values per second) - fine enough to see where a word starts, for the Timing page. */
async function readFineWaveform(file: string, perSecond: number): Promise<number[] | undefined> {
    const rate = 8000
    const proc = Bun.spawn(['ffmpeg', '-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(rate), '-f', 's16le', '-'], {stdout: 'pipe', stderr: 'ignore', stdin: 'ignore'})
    const bytes = await new Response(proc.stdout).arrayBuffer()
    if (await proc.exited !== 0) return undefined
    const samples = new Int16Array(bytes, 0, Math.floor(bytes.byteLength / 2))
    return peaks(samples, Math.max(1, Math.round(samples.length / rate * perSecond)))
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

const json = (value: unknown, status = 200) => Response.json(value, {status, headers: {'Cache-Control': 'no-store'}})
const message = (e: unknown) => e instanceof Error ? e.message : String(e)
// a run can be writing a file just as it is read: the page keeps what it has and asks again
const failure = (e: unknown) => json({error: message(e)}, 503)
const refused = (e: unknown) => json({error: message(e)}, 409)
const notFound = () => new Response('Not found', {status: 404})
const stripColors = (text: string) => Bun.stripANSI(text)

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

const RENDER_ACTIONS = new Set<RunAction['type']>(['clips', 'final', 'plan', 'refresh', 'retake', 'repeat', 'next', 'leak-scan', 'export-asset', 'add-view', 'refinish', 'look-pictures', 'adapt-story'])
/** A music video planned up to the look: a picture is rendered there and then, the shots are not planned for it (#540). */
const atLook = (target: EditorTarget) => target.kind === 'music' && stageOf(target) === 'look'

/** What rendering these clips is expected to cost: the time, what can go wrong, and that a fixed seed gives the same clip. */
async function estimateClips(target: EditorTarget, ids: string[]) {
    const requests = await readClipRequests<ClipRequest & { frames: number }>(target.dir)
    const clips = requests.filter(c => ids.includes(c.id))
    const projectConfig = target.kind === 'film' ? filmRenderConfig(await loadFilmConfig(target.dir)) : await loadProjectConfig(target.dir)
    const settings = await loadSettings(target.kind === 'film' ? {projectModel: (await loadFilmConfig(target.dir)).llm.model} : {projectModel: (projectConfig as Awaited<ReturnType<typeof loadProjectConfig>>).llm.model})
    const servers = settings.comfy.map(s => s.name)
    return {
        estimate: stripColors(await clipEstimate(clips, projectConfig, servers)),
        risks: clipFailureRisks(readTimings(), clips, projectConfig.videoWorkflow, servers).map(stripColors),
        fixedSeed: projectConfig.seed !== -1 ? projectConfig.seed : undefined,
    }
}

async function estimatePictures(target: EditorTarget, count: number) {
    const projectConfig = target.kind === 'film' ? filmRenderConfig(await loadFilmConfig(target.dir)) : await loadProjectConfig(target.dir)
    const settings = await loadSettings(target.kind === 'film' ? {projectModel: (await loadFilmConfig(target.dir)).llm.model} : {projectModel: (projectConfig as Awaited<ReturnType<typeof loadProjectConfig>>).llm.model})
    return {estimate: stripColors(await pictureEstimate(count, projectConfig, settings.comfy.map(s => s.name))), fixedSeed: projectConfig.seed !== -1 ? projectConfig.seed : undefined}
}

/** The lines of a run as they come, as server-sent events: a page can come and go, and follow a run it did not start. */
function runEvents(runs: RunControl, target: EditorTarget, request: Request, from: number) {
    let after = from
    let timer: ReturnType<typeof setInterval> | undefined
    const stream = new ReadableStream({
        start(controller) {
            const send = (event: string, data: unknown) => controller.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
            let wasRunning: boolean | undefined
            const tick = () => {
                try {
                    const {lines, next} = runs.lines(target, after)
                    after = next
                    if (lines.length) send('lines', {lines: lines.map(stripColors), next})
                    const current = runs.current(target)
                    if ((current?.running ?? false) !== wasRunning) {
                        wasRunning = current?.running ?? false
                        send('state', current ?? null)
                    }
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

export function editorHandler(runs = new RunControl(), options: EditorUIOptions = {}) {
    const waveforms = new Map<string, Promise<number[] | undefined>>()
    const thumbnails = new Map<string, Promise<Uint8Array | undefined>>()
    const oneByOne = limiter(THUMBNAILS_AT_ONCE)

    const ui = options.ui ?? editorUI()
    const serveClient = clientStatic(options.publicDir)
    const page = (request: Request, legacy = false) => ui === 'vue' && !legacy ? serveClient(request, 'index.html') : new Response(request.method === 'HEAD' ? null : Bun.file(PAGE), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache'}})

    const thumbnail = async (file: string | undefined, url: URL, request: Request) => {
        const width = Number(url.searchParams.get('w') ?? THUMBNAIL_WIDTHS[0])
        if (!file || !THUMBNAIL_WIDTHS.includes(width) || !['.png', '.jpg', '.jpeg', '.webp'].includes(extname(file).toLowerCase())) return notFound()
        const key = `${file}:${width}:${statSync(file).mtimeMs}`
        if (!thumbnails.has(key)) thumbnails.set(key, oneByOne(() => makeThumbnail(file, width)).catch(() => undefined))
        const bytes = await thumbnails.get(key)
        // ffmpeg could not make one: the picture itself will do
        if (!bytes) return serveMedia(file, request, url.searchParams.has('v'))
        return new Response(bytes, {headers: {'Content-Type': 'image/jpeg', 'Cache-Control': url.searchParams.has('v') ? 'private, max-age=86400, immutable' : 'no-cache'}})
    }

    const projectApi = async (target: EditorTarget, rest: string[], request: Request, url: URL): Promise<Response> => {
        const [what, id, action] = rest
        const post = request.method === 'POST'
        const body = async <T>() => await request.json() as T

        if (!post) {
            try {
                if (what === 'project') return json(await readEditorProject(target))
                if (what === 'freshness') return json(await readEditorFreshness(target))
                if (what === 'status') {
                    const status = await (target.kind === 'film' ? filmStatus(target.id) : projectStatus(target.id))
                    const {render, next, steps, changed} = status
                    return json({
                        steps, changed,
                        pictures: {total: render.pictures.length, missing: render.missingPictures.length, stale: render.stalePictures.length},
                        clips: {total: render.clips.length, missing: render.missingClips.length, stale: render.staleClips.length},
                        final: render.finalState,
                        next: {...next, why: stripColors(next.why), estimate: next.estimate && stripColors(next.estimate)},
                    })
                }
                if (what === 'waveform') {
                    const source = waveformSource(await readEditorProject(target))
                    const file = source && mediaFile(target.dir, source)
                    if (!file) return json({peaks: null})
                    const key = `${file}:${statSync(file).mtimeMs}`
                    if (!waveforms.has(key)) waveforms.set(key, readWaveform(file).catch(() => undefined))
                    return json({peaks: await waveforms.get(key) ?? null})
                }
                if (what === 'progress') {
                    const current = runs.current(target)
                    if (!current?.running) return json({progress: null})
                    const requests = await readClipRequests<{ id: string }>(target.dir)
                    return json({progress: runProgress(target.dir, current.command, current.startedAt ? Date.parse(current.startedAt) : 0, requests.map(clip => clip.id)) ?? null})
                }
                if (what === 'run-events') return runEvents(runs, target, request, Number(url.searchParams.get('after') ?? 0))
                if (what === 'versions' && id) {
                    const current = await clipRequestId(target, id)
                    return json({versions: clipVersions(target.dir, id).map(version => ({...version, v: Math.round(version.made), fromThisPlan: version.fingerprint === undefined ? undefined : version.fingerprint === current}))})
                }
                if (what === 'references') return json({references: await readReferences(target)})
                if (what === 'singing') return json({singing: target.kind === 'music' ? await readSinging(target) ?? null : null})
                if (what === 'timing') return json({timing: target.kind === 'music' ? await readTiming(target) ?? null : null})
                if (what === 'timing-wave') {
                    const audio = target.kind === 'music' ? (await readTiming(target))?.audio : undefined
                    const file = audio && mediaFile(target.dir, audio.file)
                    if (!file) return json({peaks: null})
                    const key = `fine:${file}:${statSync(file).mtimeMs}`
                    if (!waveforms.has(key)) waveforms.set(key, readFineWaveform(file, 100).catch(() => undefined))
                    return json({peaks: await waveforms.get(key) ?? null})
                }
                if (what === 'casting') {
                    const project = await readEditorProject(target)
                    return json(await readCasting(target, project.clips))
                }
                if (what === 'casting-redo') return json(await castingRedo(target))
                if (what === 'cast') return json({cast: readCast(target) ?? null})
                if (what === 'book') return json(readBook(target))
                if (what === 'look') return json(readLook(target))
            } catch (e) {
                return failure(e)
            }
            return notFound()
        }

        try {
            const started = (run: unknown) => json({run})
            if (what === 'run') {
                const {action: wanted, servers} = await body<{ action: RunAction, servers?: string[] }>()
                if (!wanted || !RENDER_ACTIONS.has(wanted.type) && wanted.type !== 'pictures') return refused(new Error('no such action'))
                // a prompt comes in through its own route below, never as a path from the page
                if (wanted.type === 'pictures') {
                    delete wanted.promptFile
                    wanted.look = atLook(target)
                }
                return started(runs.start(target, wanted, await urlsOfChoice(servers)))
            }
            if (what === 'stop') return json({stopped: runs.stop(target)})
            if (what === 'estimate') {
                const asked = await body<{ clips?: string[], pictures?: number }>()
                return json(asked.clips ? await estimateClips(target, asked.clips) : await estimatePictures(target, asked.pictures ?? 1))
            }
            if (what === 'versions' && id && action === 'pick') return json(await pickVersion(target, id, (await body<{ version: string }>()).version))
            if (what === 'references' && id && action === 'rerender') {
                const {newAnchor, prompt, servers} = await body<{ newAnchor?: boolean, prompt?: string, servers?: string[] }>()
                const job = (await readPictureJobs(picturesFile(target))).find(p => p.id === id)
                if (!job) return refused(new Error(`no picture ${id}`))
                let promptFile: string | undefined
                if (prompt !== undefined && prompt.trim() !== job.prompt.trim()) {
                    promptFile = join(mkdtempSync(join(tmpdir(), 'workspace-prompt-')), `${id}.txt`)
                    writeFileSync(promptFile, prompt)
                }
                return started(runs.start(target, {type: 'pictures', ids: [id], again: true, newAnchor, promptFile, look: atLook(target)}, await urlsOfChoice(servers)))
            }
            if (what === 'references' && id && action === 'pick') return json(await pickVersion(target, id, (await body<{ version: string }>()).version))
            if (what === 'casting') {
                const {kind, id: role, value} = await body<{ kind: 'character' | 'location', id: string, value: string }>()
                await writeCastingEntry(target, kind, role, value)
                return json({written: true})
            }
            if (what === 'singing') return json(await writeSinging(target, await body<SingingChange>()))
            if (what === 'cast') return json(await writeCast(target, await body<CastChange>()))
            if (what === 'book' && id === 'for-cast') return json(await writeStoryForCast(target, await body<{ proposal?: boolean, renamed?: { from: string, to: string }[] }>()))
            if (what === 'book' && id === 'drop-proposal') {
                dropStoryProposal(target)
                return json({dropped: true})
            }
            if (what === 'book') return json(await writeStory(target, (await body<{ text?: unknown }>()).text))
            if (what === 'look') return json(await writeLook(target, await body<LookChange>()))
            if (what === 'timing') return json(await writeTiming(target, await body<TimingChange>()))
            if (what === 'override' && id) {
                await writeOverride(target, id, await body<EditorOverride | null>())
                return json({written: true})
            }
        } catch (e) {
            return refused(e)
        }
        return notFound()
    }

    const libraryApi = async (rest: string[], request: Request, url: URL): Promise<Response> => {
        const dir = await libraryDir()
        const target: EditorTarget = {id: 'library', kind: 'music', dir}
        if (request.method !== 'POST') {
            if (rest[0] === 'assets') return json(await readLibrary())
            if (rest[0] === 'run-events') return runEvents(runs, target, request, Number(url.searchParams.get('after') ?? 0))
            return notFound()
        }
        if (rest[0] === 'create') {
            const form = await request.formData()
            const picture = form.get('anchor')
            const kind = form.get('kind')
            const id = String(form.get('id') ?? '')
            if (!(picture instanceof File) || (kind !== 'character' && kind !== 'location') || !libraryIdPattern.test(id)) return refused(new Error('a picture, a kind and a usable id are needed: lowercase letters, digits and dashes'))
            const folder = mkdtempSync(join(tmpdir(), 'workspace-anchor-'))
            const anchor = join(folder, `anchor${extname(picture.name) || '.png'}`)
            await Bun.write(anchor, picture)
            const optional = (name: string) => {
                const value = String(form.get(name) ?? '').trim()
                return value ? [`--${name}=${value}`] : []
            }
            try {
                const servers = form.get('servers')
                return json({run: runs.startTool(target, 'tools/create-asset.ts', [kind, id, `--anchor=${anchor}`, ...optional('name'), ...optional('role'), ...optional('description')], await urlsOfChoice(servers ? JSON.parse(String(servers)) : undefined))})
            } catch (e) {
                return refused(e)
            }
        }
        return notFound()
    }

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
            if (parts.length === 0 || (parts.length === 1 && parts[0] === 'library')) return post ? notFound() : page(request, url.searchParams.get('legacy') === '1')
            if (parts[0] === 'api') {
                if (parts[1] === 'projects' && !post) return json({projects: allTargets().flatMap(target => {
                    try {
                        return [readListing(target)]
                    } catch {
                        return []
                    }
                }).sort((a, b) => b.changed - a.changed)})
                if (parts[1] === 'servers' && !post) return json({servers: await readServers()})
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
                if (ui === 'vue' && (parts.length > 4 || (area && !['story', 'casting', 'singers', 'timing', 'look', 'references'].includes(area)))) return notFound()
                // Project tools stay functional while their individual Vue migrations are pending.
                return post ? notFound() : page(request, true)
            }
        } catch (e) {
            return failure(e)
        }
        return notFound()
    }
}

/** Serves on the first free port from `port` on, on this machine only. */
export function startEditor(port: number) {
    if (editorUI() === 'vue') requireClientBuild()
    const fetch = editorHandler()
    for (let attempt = 0; ; attempt++) {
        try {
            return Bun.serve({hostname: '127.0.0.1', port: port + attempt, idleTimeout: 0, fetch})
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE' || attempt >= 20) throw e
        }
    }
}
