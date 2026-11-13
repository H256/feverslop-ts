import {mkdtempSync, statSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import type {DirectionEdit, DirectionRule} from '../../shared/direction.ts'
import type {BeatCastChange, LibraryChange, ProjectStatus, RunHistory} from '../../shared/workspace.ts'
import {clipVersions} from '../archive.ts'
import type {ClipRequest} from '../compose.ts'
import {dropDirection, readDirection, restoreDirection, setDirectionEdits, setDirectionRules, shotPeople, takeDirection} from '../direction/service.ts'
import {libraryIdPattern} from '../library.ts'
import {configureLlm, picturesReadable} from '../llm.ts'
import {clipEstimate, clipFailureRisks, pictureEstimate, readClipRequests, readPictureJobs} from '../render-state.ts'
import {pastRuns, readQueue, unqueue} from '../run-queue.ts'
import {busy, invalid, missing} from '../service-error.ts'
import {loadSettings} from '../settings.ts'
import {readTimings} from '../timings.ts'
import {readFineWaveform} from '../waveform.ts'
import {assetSources} from './asset-sources.ts'
import {writeBeatCast} from './beat-cast.ts'
import {pickVersion, writeOverride} from './choices.ts'
import {dryRun, replaceDryRun} from './dry-run.ts'
import {json, mediaFile, readWaveform, runEvents, stripColors} from './http.ts'
import {kindOf} from './kinds.ts'
import {changeLibrary, readCasting, readLibrary, writeCastingEntry} from './library.ts'
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
import {clipRequestId, type EditorOverride, type EditorTarget, readEditorFreshness, readEditorProject, waveformSource} from './project.ts'
import {type ConfigChange, previewConfig, readConfig, writeConfig} from './projectconfig.ts'
import {picturesFile, readReferences} from './references.ts'
import type {RunAction, RunControl} from './runs.ts'
import {urlsOfChoice} from './servers.ts'
import {readSinging, type SingingChange, writeSinging} from './singing.ts'
import {readTiming, type TimingChange, writeTiming} from './timing.ts'
import {checkUploadSize, takePictureUpload} from './upload.ts'
import {textOf} from '../text.ts'

// The routes of a project's API (/p/<kind>/<id>/api/…) and of the library's (/api/library/…) as tables (#840): the server finds the
// route and answers with it. A POST route says what it changes a project with - the functions, which a command calls too, or that it
// starts a command (a run) - and lib/editor/cli-first.test.ts reads that here, not out of the source.

/** What a route is handed: the project, the part of its path at ':id', the request, and the server's runs and waveform cache. */
export type RouteContext = {
    target: EditorTarget
    id: string
    request: Request
    url: URL
    body: <T>() => Promise<T>
    runs: RunControl
    waveform: (key: string, make: () => Promise<number[] | undefined>) => Promise<number[] | undefined>
}

/** A change of a project the page makes: the function it is made with, which a command calls too (CLI first). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any function: only its identity and name are read
export type Change = (...args: any[]) => unknown

export type Route = {
    method: 'GET' | 'POST'
    /** after api/: words, and ':id' for the part that names a clip, a picture or the like */
    path: string
    /**
     * POST only - what the route changes a project with: the functions (a command calls them too), 'run' when it starts a command
     * that makes the change, or 'nothing' when it only reads (a dry run, an estimate).
     */
    changes?: readonly Change[] | 'run' | 'nothing'
    handle: (c: RouteContext) => Promise<Response> | Response
}

/** The route of a method and a path, and the part of the path at ':id'. */
export function findRoute(routes: readonly Route[], method: string, parts: readonly string[]): {route: Route; id: string} | undefined {
    for (const route of routes) {
        if (route.method !== method) continue
        const path = route.path.split('/')
        if (path.length !== parts.length) continue
        let id = ''
        const fits = path.every((part, n) => {
            if (part !== ':id') return part === parts[n]
            id = parts[n]!
            return id !== ''
        })
        if (fits) return {route, id}
    }
    return undefined
}

export const RENDER_ACTIONS = new Set<RunAction['type']>([
    'clips',
    'final',
    'plan',
    'retake',
    'repeat',
    'next',
    'leak-scan',
    'texture-chains',
    'check-joins',
    'export',
    'export-asset',
    'replace-character',
    'import-asset',
    'import-prop',
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
export const atLook = (target: EditorTarget) => target.kind === 'music' && stageOf(target) === 'look'

/** What rendering these clips is expected to cost: the time, what can go wrong, and that a fixed seed gives the same clip. */
export async function estimateClips(target: EditorTarget, ids: string[]) {
    const requests = await readClipRequests<ClipRequest & {frames: number}>(target.dir)
    const clips = requests.filter(c => ids.includes(c.id))
    const {renderConfig, llmModel} = kindOf(target)
    const projectConfig = await renderConfig(target.dir)
    const servers = (await loadSettings({projectModel: await llmModel(target.dir)})).comfy.map(s => s.name)
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
export async function picturesReadableFor(target: EditorTarget) {
    configureLlm((await loadSettings({projectModel: await kindOf(target).llmModel(target.dir)})).llm)
    return picturesReadable()
}

export async function estimatePictures(target: EditorTarget, count: number) {
    const {renderConfig, llmModel} = kindOf(target)
    const projectConfig = await renderConfig(target.dir)
    const servers = (await loadSettings({projectModel: await llmModel(target.dir)})).comfy.map(s => s.name)
    return {estimate: stripColors(await pictureEstimate(count, projectConfig, servers)), fixedSeed: projectConfig.seed !== -1 ? projectConfig.seed : undefined}
}

const started = (run: unknown) => json({run})

type Rebuild = {rebuild?: boolean; servers?: string[]}
const refuseWhileRunning = (c: RouteContext, asked: Rebuild) => {
    if (asked.rebuild && c.runs.current(c.target)?.running) throw busy('a run is going on')
}
/** The view of a change and - when asked, and `when` - the plan run that builds the prompts from it, started at once (#830). */
const rebuilt = async <V extends object>(c: RouteContext, asked: Rebuild, view: V, when = true) =>
    asked.rebuild && when ? {...view, run: c.runs.start(c.target, {type: 'plan'}, await urlsOfChoice(asked.servers))} : view
const pick = async (c: RouteContext) => json(await pickVersion(c.target, c.id, (await c.body<{version: string}>()).version))

/** The routes of one project. */
export const PROJECT_ROUTES: readonly Route[] = [
    {method: 'GET', path: 'project', handle: async c => json(await readEditorProject(c.target))},
    {method: 'GET', path: 'freshness', handle: async c => json(await readEditorFreshness(c.target))},
    {
        method: 'GET',
        path: 'status',
        handle: async c => {
            const {render, next, steps, changed} = await kindOf(c.target).status(c.target.id)
            return json({
                steps,
                changed,
                pictures: {total: render.pictures.length, missing: render.missingPictures.length, stale: render.stalePictures.length},
                clips: {total: render.clips.length, missing: render.missingClips.length, stale: render.staleClips.length},
                final: render.finalState,
                next: {...next, why: stripColors(next.why), estimate: next.estimate && stripColors(next.estimate)},
            } satisfies ProjectStatus)
        },
    },
    {
        method: 'GET',
        path: 'waveform',
        handle: async c => {
            const source = waveformSource(await readEditorProject(c.target))
            const file = source && mediaFile(c.target.dir, source)
            if (!file) return json({peaks: null})
            const key = `${file}:${statSync(file).mtimeMs}`
            return json({peaks: (await c.waveform(key, () => readWaveform(file).catch(() => undefined))) ?? null})
        },
    },
    {method: 'GET', path: 'run-events', handle: c => runEvents(c.runs, c.target, c.request, Number(c.url.searchParams.get('after') ?? 0))},
    // the runs waiting behind the one that goes on, and those that ended (#837): bun run runs
    {method: 'GET', path: 'runs', handle: c => json({queue: readQueue(c.target.dir), past: pastRuns(c.target.dir)} satisfies RunHistory)},
    {
        method: 'GET',
        path: 'versions/:id',
        handle: async c => {
            const current = await clipRequestId(c.target, c.id)
            return json({
                versions: clipVersions(c.target.dir, c.id).map(version => ({
                    ...version,
                    v: Math.round(version.made),
                    fromThisPlan: version.fingerprint === undefined ? undefined : version.fingerprint === current,
                })),
            })
        },
    },
    {method: 'GET', path: 'references', handle: async c => json({references: await readReferences(c.target)})},
    {method: 'GET', path: 'singing', handle: async c => json({singing: c.target.kind === 'music' ? ((await readSinging(c.target)) ?? null) : null})},
    {method: 'GET', path: 'timing', handle: async c => json({timing: c.target.kind === 'music' ? ((await readTiming(c.target)) ?? null) : null})},
    {
        method: 'GET',
        path: 'timing-wave',
        handle: async c => {
            const audio = c.target.kind === 'music' ? (await readTiming(c.target))?.audio : undefined
            const file = audio && mediaFile(c.target.dir, audio.file)
            if (!file) return json({peaks: null})
            const key = `fine:${file}:${statSync(file).mtimeMs}`
            return json({peaks: (await c.waveform(key, () => readFineWaveform(file, 100).catch(() => undefined))) ?? null})
        },
    },
    // the finished characters or places of the other music videos, to take over on the Casting page (#835): bun run import-asset
    {
        method: 'GET',
        path: 'asset-sources',
        handle: c => {
            const kind = c.url.searchParams.get('kind')
            if (kind !== 'character' && kind !== 'location') throw invalid('kind: character or location')
            return json({sources: c.target.kind === 'music' ? assetSources(c.target.id, kind) : []})
        },
    },
    {method: 'GET', path: 'casting', handle: async c => json(await readCasting(c.target, (await readEditorProject(c.target)).clips))},
    {method: 'GET', path: 'casting-redo', handle: async c => json(await castingRedo(c.target))},
    {method: 'GET', path: 'cast', handle: c => json({cast: readCast(c.target) ?? null})},
    {method: 'GET', path: 'book', handle: c => json(readBook(c.target))},
    {method: 'GET', path: 'direction', handle: c => json(readDirection(c.target))},
    {method: 'GET', path: 'look', handle: c => json(readLook(c.target))},
    {method: 'GET', path: 'config', handle: async c => json(await readConfig(c.target))},
    {method: 'GET', path: 'vision', handle: async c => json({readable: await picturesReadableFor(c.target)})},

    {
        method: 'POST',
        path: 'run',
        changes: 'run',
        handle: async c => {
            const {action: wanted, servers, queue} = await c.body<{action: RunAction; servers?: string[]; queue?: boolean}>()
            if (!wanted || (!RENDER_ACTIONS.has(wanted.type) && wanted.type !== 'pictures' && wanted.type !== 'direction')) throw invalid('no such action')
            // a prompt or a picture comes in through its own route below, never as a path from the page
            if (wanted.type === 'pictures') {
                delete wanted.promptFile
                delete wanted.anchorFile
                delete wanted.descriptionFile
                delete wanted.describe
                wanted.look = atLook(c.target)
            }
            // queue: while a run goes on, it waits behind it (#837)
            if (queue) return json(c.runs.startOrQueue(c.target, wanted, await urlsOfChoice(servers)))
            return started(c.runs.start(c.target, wanted, await urlsOfChoice(servers)))
        },
    },
    // a queued run taken out: bun run runs <id> --remove=<queued id>
    {
        method: 'POST',
        path: 'runs',
        changes: [unqueue],
        handle: async c => {
            const {remove} = await c.body<{remove?: string}>()
            if (typeof remove !== 'string' || !unqueue(c.target.dir, remove)) throw missing('no such run in the queue - it may have started already')
            return json({queue: readQueue(c.target.dir)})
        },
    },
    {method: 'POST', path: 'stop', changes: 'run', handle: async c => json({stopped: await c.runs.stop(c.target)})},
    // the direction: its rules, its edits, a proposal taken, dropped or restored. `rebuild`: the clip prompts are built again right after
    // the change, as the command does it (bun run direction --take, without --no-rebuild) - one request, so that a change is never taken
    // with the prompts left as they were (#830). Refused before anything is changed while a run goes on: the build could not start.
    {
        method: 'POST',
        path: 'direction',
        changes: [setDirectionRules],
        handle: async c => {
            const asked = await c.body<{rules?: DirectionRule[]} & Rebuild>()
            refuseWhileRunning(c, asked)
            return json(await setDirectionRules(c.target, {rules: asked.rules ?? []}))
        },
    },
    {
        method: 'POST',
        path: 'direction/edits',
        changes: [setDirectionEdits],
        handle: async c => {
            const asked = await c.body<{edits?: DirectionEdit[]} & Rebuild>()
            refuseWhileRunning(c, asked)
            // edits that still wait for their words (a preview writes them) build nothing yet
            const view = await setDirectionEdits(c.target, {edits: asked.edits ?? []})
            return json(await rebuilt(c, asked, view, !view.pending && !view.unresolved.length))
        },
    },
    {
        method: 'POST',
        path: 'direction/take',
        changes: [takeDirection],
        handle: async c => {
            const asked = await c.body<{despiteConflicts?: boolean} & Rebuild>()
            refuseWhileRunning(c, asked)
            return json(await rebuilt(c, asked, await takeDirection(c.target, {despiteConflicts: !!asked.despiteConflicts})))
        },
    },
    // a drop rebuilds only when asked: people taken out for a proposal to write were not built yet
    {
        method: 'POST',
        path: 'direction/drop',
        changes: [dropDirection],
        handle: async c => {
            const asked = await c.body<Rebuild>()
            refuseWhileRunning(c, asked)
            return json(await rebuilt(c, asked, await dropDirection(c.target)))
        },
    },
    // people into one shot or out of it, and the run that follows - one request (#830): bun run direction --scope=shot:… --with|--without
    {
        method: 'POST',
        path: 'direction/people',
        changes: [shotPeople],
        handle: async c => {
            const asked = await c.body<{shotId?: string; add?: string[]; remove?: string[]; words?: string; servers?: string[]}>()
            if (c.runs.current(c.target)?.running) throw busy('a run is going on')
            const {view, propose} = await shotPeople(c.target, {
                shotId: asked.shotId ?? '',
                ...(asked.add ? {add: asked.add} : {}),
                ...(asked.remove ? {remove: asked.remove} : {}),
                ...(asked.words ? {words: asked.words} : {}),
            })
            const run = c.runs.start(c.target, propose ? {type: 'direction'} : {type: 'plan'}, await urlsOfChoice(asked.servers))
            return json({...view, run, proposing: propose})
        },
    },
    {
        method: 'POST',
        path: 'direction/restore',
        changes: [restoreDirection],
        handle: async c => {
            const asked = await c.body<{version?: string} & Rebuild>()
            refuseWhileRunning(c, asked)
            return json(await rebuilt(c, asked, await restoreDirection(c.target, asked.version ?? '')))
        },
    },
    // what replacing a character's picture would do, before it is asked for (#835): the command's --dry-run
    {
        method: 'POST',
        path: 'replace-dry-run',
        changes: 'nothing',
        handle: async c => {
            const asked = await c.body<Omit<Extract<RunAction, {type: 'replace-character'}>, 'type'>>()
            return json(await replaceDryRun(c.target, {type: 'replace-character', ...asked}))
        },
    },
    // what a plan run would do, before it is asked for: the command's --dry-run --json (#836)
    {
        method: 'POST',
        path: 'dry-run',
        changes: 'nothing',
        handle: async c => {
            const asked = await c.body<{redo?: string[]; until?: string; beats?: string[]; scenes?: string[]}>()
            return json({dryRun: await dryRun(c.target, {type: 'plan', ...asked})})
        },
    },
    {
        method: 'POST',
        path: 'estimate',
        changes: 'nothing',
        handle: async c => {
            const asked = await c.body<{clips?: string[]; pictures?: number}>()
            return json(asked.clips ? await estimateClips(c.target, asked.clips) : await estimatePictures(c.target, asked.pictures ?? 1))
        },
    },
    {method: 'POST', path: 'versions/:id/pick', changes: [pickVersion], handle: pick},
    {
        method: 'POST',
        path: 'references/:id/rerender',
        changes: 'run',
        handle: async c => {
            const {newAnchor, prompt, servers} = await c.body<{newAnchor?: boolean; prompt?: string; servers?: string[]}>()
            const job = (await readPictureJobs(picturesFile(c.target))).find(p => p.id === c.id)
            if (!job) throw missing(`no picture ${c.id}`)
            const urls = await urlsOfChoice(servers)
            // the edited prompt as a file of its own, for this run only: it goes when the run has ended, or is not started
            const folder = prompt !== undefined && prompt.trim() !== job.prompt.trim() ? mkdtempSync(join(tmpdir(), 'workspace-prompt-')) : undefined
            const promptFile = folder && join(folder, `${c.id}.txt`)
            if (promptFile) writeFileSync(promptFile, prompt!)
            return started(
                c.runs.start(
                    c.target,
                    {type: 'pictures', ids: [c.id], again: true, newAnchor, promptFile, look: atLook(c.target)},
                    urls,
                    folder ? [folder] : [],
                ),
            )
        },
    },
    // the user's own picture as the anchor, uploaded: checked (lib/editor/upload.ts), kept for the run only, then put in by the CLI
    {
        method: 'POST',
        path: 'references/:id/own-anchor',
        changes: 'run',
        handle: async c => {
            checkUploadSize(c.request)
            const form = await c.request.formData()
            const job = (await readPictureJobs(picturesFile(c.target))).find(p => p.id === c.id)
            if (!job) throw missing(`no picture ${c.id}`)
            if (job.kind === 'prop') throw invalid(`${job.name} is a prop: its picture is drawn from its description only`)
            const library = (await readReferences(c.target)).find(r => r.id === c.id)?.library
            if (library) throw invalid(`${job.name} is played by library:${library} - change it on the Casting page`)
            const prompt = textOf(form.get('prompt'))
            const description = textOf(form.get('description')).trim()
            const describe = form.get('describe') === 'true'
            if (prompt.length > 8000 || description.length > 8000) throw invalid('the prompt and the description are at most 8000 characters')
            if (description && describe) throw invalid('a description given by hand, or read from the picture - not both')
            const upload = await takePictureUpload(form.get('picture'))
            try {
                const promptFile = prompt.trim() && prompt.trim() !== job.prompt.trim() ? await upload.text('prompt', prompt) : undefined
                const descriptionFile = description ? await upload.text('description', description) : undefined
                const servers = form.get('servers')
                const urls = await urlsOfChoice(servers ? JSON.parse(textOf(servers)) : undefined)
                return started(
                    c.runs.start(
                        c.target,
                        {type: 'pictures', ids: [c.id], again: true, anchorFile: upload.file, promptFile, descriptionFile, describe, look: atLook(c.target)},
                        urls,
                        [upload.folder],
                    ),
                )
            } catch (e) {
                upload.drop()
                throw e
            }
        },
    },
    {method: 'POST', path: 'references/:id/pick', changes: [pickVersion], handle: pick},
    {
        method: 'POST',
        path: 'casting',
        changes: [writeCastingEntry],
        handle: async c => {
            const {kind, id: role, value} = await c.body<{kind: 'character' | 'location'; id: string; value: string}>()
            await writeCastingEntry(c.target, kind, role, value)
            return json({written: true})
        },
    },
    {method: 'POST', path: 'singing', changes: [writeSinging], handle: async c => json(await writeSinging(c.target, await c.body<SingingChange>()))},
    {method: 'POST', path: 'cast', changes: [writeCast], handle: async c => json(await writeCast(c.target, await c.body<CastChange>()))},
    {method: 'POST', path: 'beat-cast', changes: [writeBeatCast], handle: async c => json(await writeBeatCast(c.target, await c.body<BeatCastChange>()))},
    {
        method: 'POST',
        path: 'book/for-cast',
        changes: [writeStoryForCast],
        handle: async c => json(await writeStoryForCast(c.target, await c.body<{proposal?: boolean; renamed?: {from: string; to: string}[]}>())),
    },
    {
        method: 'POST',
        path: 'book/drop-proposal',
        changes: [dropStoryProposal],
        handle: c => {
            dropStoryProposal(c.target)
            return json({dropped: true})
        },
    },
    {method: 'POST', path: 'book', changes: [writeStory], handle: async c => json(await writeStory(c.target, (await c.body<{text?: unknown}>()).text))},
    {method: 'POST', path: 'look', changes: [writeLook], handle: async c => json(await writeLook(c.target, await c.body<LookChange>()))},
    // what a change would do, asked before it is made - or the change itself
    {
        method: 'POST',
        path: 'config',
        changes: [writeConfig],
        handle: async c => {
            const {change, dryRun: preview} = await c.body<{change?: ConfigChange; dryRun?: boolean}>()
            if (!change || typeof change !== 'object' || Array.isArray(change)) throw invalid('change must be an object like {"seed": 7}')
            return json(preview ? await previewConfig(c.target, change) : await writeConfig(c.target, change))
        },
    },
    {method: 'POST', path: 'timing', changes: [writeTiming], handle: async c => json(await writeTiming(c.target, await c.body<TimingChange>()))},
    {
        method: 'POST',
        path: 'override/:id',
        changes: [writeOverride],
        handle: async c => {
            await writeOverride(c.target, c.id, await c.body<EditorOverride | null>())
            return json({written: true})
        },
    },
]

/** The routes of the library (/api/library/…): its assets, the lines of its runs, and a change or a new asset by its commands. */
export const LIBRARY_ROUTES: readonly Route[] = [
    {method: 'GET', path: 'assets', handle: async () => json(await readLibrary())},
    {method: 'GET', path: 'run-events', handle: c => runEvents(c.runs, c.target, c.request, Number(c.url.searchParams.get('after') ?? 0))},
    // renamed, described anew or put away: the command's functions (bun run library, #835)
    {method: 'POST', path: 'change', changes: [changeLibrary], handle: async c => json(await changeLibrary(await c.body<LibraryChange>()))},
    // a new asset from a picture: bun run create-asset, the picture checked as every upload is and kept for the run only
    {
        method: 'POST',
        path: 'create',
        changes: 'run',
        handle: async c => {
            checkUploadSize(c.request)
            const form = await c.request.formData()
            const picture = form.get('anchor')
            const kind = form.get('kind')
            const id = textOf(form.get('id'))
            if (!(picture instanceof File) || (kind !== 'character' && kind !== 'location') || !libraryIdPattern.test(id))
                throw invalid('a picture, a kind and a usable id are needed: lowercase letters, digits and dashes')
            const upload = await takePictureUpload(picture)
            const optional = (name: string) => {
                const value = textOf(form.get(name)).trim()
                return value ? [`--${name}=${value}`] : []
            }
            try {
                const servers = form.get('servers')
                const urls = await urlsOfChoice(servers ? JSON.parse(textOf(servers)) : undefined)
                return started(
                    c.runs.startTool(
                        c.target,
                        'tools/create-asset.ts',
                        [kind, id, `--anchor=${upload.file}`, ...optional('name'), ...optional('role'), ...optional('description')],
                        urls,
                        [upload.folder],
                    ),
                )
            } catch (e) {
                upload.drop()
                throw e
            }
        },
    },
]
