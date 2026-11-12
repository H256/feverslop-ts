import {boundedMemo} from './memo.ts'
import {existsSync, mkdtempSync, statSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {extname, isAbsolute, join, relative, resolve, sep} from 'node:path'
import {clipVersions} from '../archive.ts'
import {peaks, readFineWaveform} from '../waveform.ts'
export {peaks}
import type {ClipRequest} from '../compose.ts'
import {loadProjectConfig} from '../config.ts'
import {libraryDir, libraryIdPattern} from '../library.ts'
import {listProjects, projectDir, projectExists, validProjectId} from '../project-setup.ts'
import {clipEstimate, clipFailureRisks, pictureEstimate, readClipRequests} from '../render-state.ts'
import {configureLlm, picturesReadable} from '../llm.ts'
import {loadSettings} from '../settings.ts'
import {filmStatus, projectStatus} from '../status.ts'
import {readTimings} from '../timings.ts'
import {loadFilmConfig} from '../film/config.ts'
import {filmRenderConfig} from '../film/pictures.ts'
import {filmDir, filmExists, filmIds} from '../film/setup.ts'
import {changeLibrary, readCasting, readLibrary, writeCastingEntry} from './library.ts'
import {statsView} from './stats.ts'
import {dryRun} from './dry-run.ts'
import {
    clipRequestId,
    type EditorKind,
    type EditorOverride,
    type EditorTarget,
    readEditorFreshness,
    readEditorProject,
    readListing,
    waveformSource,
} from './project.ts'
import {picturesFile, readReferences} from './references.ts'
import {readSinging, type SingingChange, writeSinging} from './singing.ts'
import {writeBeatCast} from './beat-cast.ts'
import type {BeatCastChange} from '../../shared/workspace.ts'
import {pickVersion, writeOverride} from './choices.ts'
import {
    type CastChange,
    castingRedo,
    dropStoryProposal,
    type LookChange,
    readBook,
    readCast,
    readLook,
    stageOf,
    writeCast,
    writeLook,
    writeStory,
    writeStoryForCast,
} from './preproduction.ts'
import {readTiming, type TimingChange, writeTiming} from './timing.ts'
import {type ConfigChange, previewConfig, readConfig, writeConfig} from './projectconfig.ts'
import {runProgress} from './progress.ts'
import {type RunAction, RunControl} from './runs.ts'
import {readServers, urlsOfChoice} from './servers.ts'
import {checkUploadSize, takePictureUpload} from './upload.ts'
import {readPictureJobs} from '../render-state.ts'
import {clientStatic, requireClientBuild, type EditorOptions} from './static.ts'
import {busy, invalid, kindOf, missing, STATUS_OF} from '../service-error.ts'
import {PROJECT_PAGES, type LibraryChange, type NewProject, type ProjectStatus, type RunEvents} from '../../shared/workspace.ts'
import {doctor} from '../doctor.ts'
import {createProject} from './new-project.ts'
import type {DirectionEdit, DirectionRule} from '../../shared/direction.ts'
import {readDirection, setDirectionRules, setDirectionEdits, takeDirection, dropDirection, restoreDirection} from '../direction/service.ts'

// The workspace's server: one HTML page, what it shows of the projects as JSON, and their pictures, videos and sound. What it changes
// goes through the CLI (RunControl) or under the project's lock; it keeps nothing but thumbnails and waveforms in memory.

// only what the page plays and shows - not project.json, the logs or the settings, whatever a path says
const MEDIA_TYPES: Record<string, string> = {
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

const WAVEFORM_BUCKETS = 4000
const WAVEFORM_RATE = 4000

async function readWaveform(file: string): Promise<number[] | undefined> {
    const proc = Bun.spawn(['ffmpeg', '-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(WAVEFORM_RATE), '-f', 's16le', '-'], {
        stdout: 'pipe',
        stderr: 'ignore',
        stdin: 'ignore',
    })
    const bytes = await new Response(proc.stdout).arrayBuffer()
    if ((await proc.exited) !== 0) return undefined
    return peaks(new Int16Array(bytes, 0, Math.floor(bytes.byteLength / 2)), WAVEFORM_BUCKETS)
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

const json = (value: unknown, status = 200) => Response.json(value, {status, headers: {'Cache-Control': 'no-store'}})
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
const failure = (e: unknown) => answerOf(e, false)
const refused = (e: unknown) => answerOf(e, true)
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

const RENDER_ACTIONS = new Set<RunAction['type']>([
    'clips',
    'final',
    'plan',
    'retake',
    'repeat',
    'next',
    'leak-scan',
    'export-asset',
    'export-song',
    'add-view',
    'refinish',
    'look-pictures',
    'adapt-story',
    'label',
    'intro',
    'credits',
    'description',
])
/** A music video planned up to the look: a picture is rendered there and then, the shots are not planned for it (#540). */
const atLook = (target: EditorTarget) => target.kind === 'music' && stageOf(target) === 'look'

/** What rendering these clips is expected to cost: the time, what can go wrong, and that a fixed seed gives the same clip. */
async function estimateClips(target: EditorTarget, ids: string[]) {
    const requests = await readClipRequests<ClipRequest & {frames: number}>(target.dir)
    const clips = requests.filter(c => ids.includes(c.id))
    const projectConfig = target.kind === 'film' ? filmRenderConfig(await loadFilmConfig(target.dir)) : await loadProjectConfig(target.dir)
    const settings = await loadSettings(
        target.kind === 'film'
            ? {projectModel: (await loadFilmConfig(target.dir)).llm.model}
            : {projectModel: (projectConfig as Awaited<ReturnType<typeof loadProjectConfig>>).llm.model},
    )
    const servers = settings.comfy.map(s => s.name)
    return {
        estimate: stripColors(await clipEstimate(clips, projectConfig, servers)),
        risks: clipFailureRisks(readTimings(), clips, projectConfig.videoWorkflow, servers).map(stripColors),
        fixedSeed: projectConfig.seed !== -1 ? projectConfig.seed : undefined,
    }
}

/**
 * Can the language model of this project read a picture - a vision model of its own, or a text model that takes pictures? The
 * server asks no model anything else: what it connects to here is only for this question.
 */
async function picturesReadableFor(target: EditorTarget) {
    const model = target.kind === 'film' ? (await loadFilmConfig(target.dir)).llm.model : (await loadProjectConfig(target.dir)).llm.model
    configureLlm((await loadSettings({projectModel: model})).llm)
    return picturesReadable()
}

async function estimatePictures(target: EditorTarget, count: number) {
    const projectConfig = target.kind === 'film' ? filmRenderConfig(await loadFilmConfig(target.dir)) : await loadProjectConfig(target.dir)
    const settings = await loadSettings(
        target.kind === 'film'
            ? {projectModel: (await loadFilmConfig(target.dir)).llm.model}
            : {projectModel: (projectConfig as Awaited<ReturnType<typeof loadProjectConfig>>).llm.model},
    )
    return {
        estimate: stripColors(
            await pictureEstimate(
                count,
                projectConfig,
                settings.comfy.map(s => s.name),
            ),
        ),
        fixedSeed: projectConfig.seed !== -1 ? projectConfig.seed : undefined,
    }
}

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

    const projectApi = async (target: EditorTarget, rest: string[], request: Request, url: URL): Promise<Response> => {
        const [what, id, action] = rest
        const post = request.method === 'POST'
        const body = async <T>() => (await request.json()) as T

        if (!post) {
            try {
                if (what === 'project') return json(await readEditorProject(target))
                if (what === 'freshness') return json(await readEditorFreshness(target))
                if (what === 'status') {
                    const status = await (target.kind === 'film' ? filmStatus(target.id) : projectStatus(target.id))
                    const {render, next, steps, changed} = status
                    return json({
                        steps,
                        changed,
                        pictures: {total: render.pictures.length, missing: render.missingPictures.length, stale: render.stalePictures.length},
                        clips: {total: render.clips.length, missing: render.missingClips.length, stale: render.staleClips.length},
                        final: render.finalState,
                        next: {...next, why: stripColors(next.why), estimate: next.estimate && stripColors(next.estimate)},
                    } satisfies ProjectStatus)
                }
                if (what === 'waveform') {
                    const source = waveformSource(await readEditorProject(target))
                    const file = source && mediaFile(target.dir, source)
                    if (!file) return json({peaks: null})
                    const key = `${file}:${statSync(file).mtimeMs}`
                    return json({peaks: (await waveform(key, () => readWaveform(file).catch(() => undefined))) ?? null})
                }
                if (what === 'progress') {
                    const current = runs.current(target)
                    if (!current?.running) return json({progress: null})
                    const requests = await readClipRequests<{id: string}>(target.dir)
                    return json({
                        progress:
                            runProgress(
                                target.dir,
                                current.command,
                                current.startedAt ? Date.parse(current.startedAt) : 0,
                                requests.map(clip => clip.id),
                            ) ?? null,
                    })
                }
                if (what === 'run-events') return runEvents(runs, target, request, Number(url.searchParams.get('after') ?? 0))
                if (what === 'versions' && id) {
                    const current = await clipRequestId(target, id)
                    return json({
                        versions: clipVersions(target.dir, id).map(version => ({
                            ...version,
                            v: Math.round(version.made),
                            fromThisPlan: version.fingerprint === undefined ? undefined : version.fingerprint === current,
                        })),
                    })
                }
                if (what === 'references') return json({references: await readReferences(target)})
                if (what === 'singing') return json({singing: target.kind === 'music' ? ((await readSinging(target)) ?? null) : null})
                if (what === 'timing') return json({timing: target.kind === 'music' ? ((await readTiming(target)) ?? null) : null})
                if (what === 'timing-wave') {
                    const audio = target.kind === 'music' ? (await readTiming(target))?.audio : undefined
                    const file = audio && mediaFile(target.dir, audio.file)
                    if (!file) return json({peaks: null})
                    const key = `fine:${file}:${statSync(file).mtimeMs}`
                    return json({peaks: (await waveform(key, () => readFineWaveform(file, 100).catch(() => undefined))) ?? null})
                }
                if (what === 'casting') {
                    const project = await readEditorProject(target)
                    return json(await readCasting(target, project.clips))
                }
                if (what === 'casting-redo') return json(await castingRedo(target))
                if (what === 'cast') return json({cast: readCast(target) ?? null})
                if (what === 'book') return json(readBook(target))
                if (what === 'direction') return json(readDirection(target))
                if (what === 'look') return json(readLook(target))
                if (what === 'config') return json(await readConfig(target))
                if (what === 'vision') return json({readable: await picturesReadableFor(target)})
            } catch (e) {
                return failure(e)
            }
            return notFound()
        }

        try {
            const started = (run: unknown) => json({run})
            if (what === 'run') {
                const {action: wanted, servers} = await body<{action: RunAction; servers?: string[]}>()
                if (!wanted || (!RENDER_ACTIONS.has(wanted.type) && wanted.type !== 'pictures' && wanted.type !== 'direction'))
                    return refused(invalid('no such action'))
                // a prompt or a picture comes in through its own route below, never as a path from the page
                if (wanted.type === 'pictures') {
                    delete wanted.promptFile
                    delete wanted.anchorFile
                    delete wanted.descriptionFile
                    delete wanted.describe
                    wanted.look = atLook(target)
                }
                return started(runs.start(target, wanted, await urlsOfChoice(servers)))
            }
            if (what === 'stop') return json({stopped: await runs.stop(target)})
            if (what === 'direction') {
                // `rebuild`: the clip prompts are built again right after the change, as the command does it (bun run direction --take,
                // without --no-rebuild) - one request, so that a change is never taken with the prompts left as they were (#830). Refused
                // before anything is changed while a run goes on: the build could not start.
                const asked = await body<{
                    rules?: DirectionRule[]
                    edits?: DirectionEdit[]
                    despiteConflicts?: boolean
                    version?: string
                    rebuild?: boolean
                    servers?: string[]
                }>()
                if (asked.rebuild && runs.current(target)?.running) return refused(busy('a run is going on'))
                const rebuilt = async <V extends object>(view: V, when = true) =>
                    asked.rebuild && when ? {...view, run: runs.start(target, {type: 'plan'}, await urlsOfChoice(asked.servers))} : view
                if (!id) return json(await setDirectionRules(target, {rules: asked.rules ?? []}))
                if (id === 'edits') {
                    // edits that still wait for their words (a preview writes them) build nothing yet
                    const view = await setDirectionEdits(target, {edits: asked.edits ?? []})
                    return json(await rebuilt(view, !view.pending && !view.unresolved.length))
                }
                if (id === 'take') return json(await rebuilt(await takeDirection(target, {despiteConflicts: !!asked.despiteConflicts})))
                if (id === 'drop') return json(await dropDirection(target))
                if (id === 'restore') return json(await rebuilt(await restoreDirection(target, asked.version ?? '')))
                return notFound()
            }
            // what a plan run would do, before it is asked for: the command's --dry-run --json (#836)
            if (what === 'dry-run') {
                const asked = await body<{redo?: string[]; until?: string; beats?: string[]; scenes?: string[]}>()
                return json({dryRun: await dryRun(target, {type: 'plan', ...asked})})
            }
            if (what === 'estimate') {
                const asked = await body<{clips?: string[]; pictures?: number}>()
                return json(asked.clips ? await estimateClips(target, asked.clips) : await estimatePictures(target, asked.pictures ?? 1))
            }
            if (what === 'versions' && id && action === 'pick') return json(await pickVersion(target, id, (await body<{version: string}>()).version))
            if (what === 'references' && id && action === 'rerender') {
                const {newAnchor, prompt, servers} = await body<{newAnchor?: boolean; prompt?: string; servers?: string[]}>()
                const job = (await readPictureJobs(picturesFile(target))).find(p => p.id === id)
                if (!job) return refused(missing(`no picture ${id}`))
                const urls = await urlsOfChoice(servers)
                // the edited prompt as a file of its own, for this run only: it goes when the run has ended, or is not started
                const folder = prompt !== undefined && prompt.trim() !== job.prompt.trim() ? mkdtempSync(join(tmpdir(), 'workspace-prompt-')) : undefined
                const promptFile = folder && join(folder, `${id}.txt`)
                if (promptFile) writeFileSync(promptFile, prompt!)
                return started(
                    runs.start(target, {type: 'pictures', ids: [id], again: true, newAnchor, promptFile, look: atLook(target)}, urls, folder ? [folder] : []),
                )
            }
            // the user's own picture as the anchor, uploaded: checked (lib/editor/upload.ts), kept for the run only, then put in by the CLI
            if (what === 'references' && id && action === 'own-anchor') {
                checkUploadSize(request)
                const form = await request.formData()
                const job = (await readPictureJobs(picturesFile(target))).find(p => p.id === id)
                if (!job) return refused(missing(`no picture ${id}`))
                if (job.kind === 'prop') return refused(invalid(`${job.name} is a prop: its picture is drawn from its description only`))
                const library = (await readReferences(target)).find(r => r.id === id)?.library
                if (library) return refused(invalid(`${job.name} is played by library:${library} - change it on the Casting page`))
                const prompt = String(form.get('prompt') ?? '')
                const description = String(form.get('description') ?? '').trim()
                const describe = form.get('describe') === 'true'
                if (prompt.length > 8000 || description.length > 8000) return refused(invalid('the prompt and the description are at most 8000 characters'))
                if (description && describe) return refused(invalid('a description given by hand, or read from the picture - not both'))
                const upload = await takePictureUpload(form.get('picture'))
                try {
                    const promptFile = prompt.trim() && prompt.trim() !== job.prompt.trim() ? await upload.text('prompt', prompt) : undefined
                    const descriptionFile = description ? await upload.text('description', description) : undefined
                    const servers = form.get('servers')
                    const urls = await urlsOfChoice(servers ? JSON.parse(String(servers)) : undefined)
                    return started(
                        runs.start(
                            target,
                            {type: 'pictures', ids: [id], again: true, anchorFile: upload.file, promptFile, descriptionFile, describe, look: atLook(target)},
                            urls,
                            [upload.folder],
                        ),
                    )
                } catch (e) {
                    upload.drop()
                    throw e
                }
            }
            if (what === 'references' && id && action === 'pick') return json(await pickVersion(target, id, (await body<{version: string}>()).version))
            if (what === 'casting') {
                const {kind, id: role, value} = await body<{kind: 'character' | 'location'; id: string; value: string}>()
                await writeCastingEntry(target, kind, role, value)
                return json({written: true})
            }
            if (what === 'singing') return json(await writeSinging(target, await body<SingingChange>()))
            if (what === 'cast') return json(await writeCast(target, await body<CastChange>()))
            if (what === 'beat-cast') return json(await writeBeatCast(target, await body<BeatCastChange>()))
            if (what === 'book' && id === 'for-cast')
                return json(await writeStoryForCast(target, await body<{proposal?: boolean; renamed?: {from: string; to: string}[]}>()))
            if (what === 'book' && id === 'drop-proposal') {
                dropStoryProposal(target)
                return json({dropped: true})
            }
            if (what === 'book') return json(await writeStory(target, (await body<{text?: unknown}>()).text))
            if (what === 'look') return json(await writeLook(target, await body<LookChange>()))
            // what a change would do, asked before it is made - or the change itself
            if (what === 'config') {
                const {change, dryRun} = await body<{change?: ConfigChange; dryRun?: boolean}>()
                if (!change || typeof change !== 'object' || Array.isArray(change)) return refused(invalid('change must be an object like {"seed": 7}'))
                return json(dryRun ? await previewConfig(target, change) : await writeConfig(target, change))
            }
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
        // renamed, described anew or put away: the command's functions (bun run library, #835)
        if (rest[0] === 'change') {
            try {
                return json(await changeLibrary((await request.json()) as LibraryChange))
            } catch (e) {
                return refused(e)
            }
        }
        if (rest[0] === 'create') {
            try {
                checkUploadSize(request)
            } catch (e) {
                return refused(e)
            }
            const form = await request.formData()
            const picture = form.get('anchor')
            const kind = form.get('kind')
            const id = String(form.get('id') ?? '')
            if (!(picture instanceof File) || (kind !== 'character' && kind !== 'location') || !libraryIdPattern.test(id))
                return refused(invalid('a picture, a kind and a usable id are needed: lowercase letters, digits and dashes'))
            // checked as every upload is, and kept for the run only (lib/editor/upload.ts)
            let upload: Awaited<ReturnType<typeof takePictureUpload>>
            try {
                upload = await takePictureUpload(picture)
            } catch (e) {
                return refused(e)
            }
            const anchor = upload.file
            const optional = (name: string) => {
                const value = String(form.get(name) ?? '').trim()
                return value ? [`--${name}=${value}`] : []
            }
            try {
                const servers = form.get('servers')
                const urls = await urlsOfChoice(servers ? JSON.parse(String(servers)) : undefined)
                return json({
                    run: runs.startTool(
                        target,
                        'tools/create-asset.ts',
                        [kind, id, `--anchor=${anchor}`, ...optional('name'), ...optional('role'), ...optional('description')],
                        urls,
                        [upload.folder],
                    ),
                })
            } catch (e) {
                upload.drop()
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
                // a new music video: `bun run init <id> …` with the form as its options
                if (parts[1] === 'projects' && parts[2] === 'new' && post) {
                    try {
                        return json(await createProject((await request.json()) as NewProject))
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
    const fetch = editorHandler()
    for (let attempt = 0; ; attempt++) {
        try {
            return Bun.serve({hostname: '127.0.0.1', port: port + attempt, idleTimeout: 0, fetch})
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE' || attempt >= 20) throw e
        }
    }
}
