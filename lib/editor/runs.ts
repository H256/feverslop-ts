import {closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync} from 'node:fs'
import {join} from 'node:path'
import {lockHolder, verifiedLockHolder} from '../lock.ts'
import {cancelJobs, jobsQueuedSince} from '../comfy-cancel.ts'
import {type ComfyServer, loadSettings} from '../settings.ts'

// how long a stopped run gets to cancel its own jobs before what is left of them is cancelled from here
const STOP_WAIT_MS = 10_000
import {lastRun, runState} from '../run-record.ts'
import type {EditorKind, EditorTarget} from './project.ts'
import {STEP_NAMES} from '../project.ts'
import {UNTIL_STAGES} from '../stages.ts'
import {FILM_STEP_NAMES} from '../film/store.ts'
import {VIDEO_NAME} from '../postwork/video.ts'
import {requestArgs} from '../command-schema.ts'
import {introCommand, labelCommand} from '../postwork/commands.ts'
import {EXPORT_FORMATS} from '../timeline-export.ts'
import type {RunEvent, RunInfo, RunRequest} from '../../shared/workspace.ts'
import {eventsFileOf} from '../run-events.ts'
import {busy, KindError} from '../service-error.ts'
import {hasQueue, notePastRun, queueRun, readQueue, takeFirst} from '../run-queue.ts'
import type {QueuedRun} from '../../shared/workspace.ts'
export type {RunInfo} from '../../shared/workspace.ts'

// Everything that renders from the workspace is the CLI, started here: a run goes through the same lock as one started in the
// terminal, so the two exclude each other, and it is asked for by what it should do - never as a command line from the page.

const ROOT = join(import.meta.dir, '..', '..')
const LINES_KEPT = 4000
export const CLIP_ID = /^[a-z]+-\d+$/
const PICTURE_ID = /^[a-z0-9][a-z0-9-]*$/

// what the page may ask for is the shared contract; a picture rendered again gets its edited prompt and its stage from the server only
export type RunAction =
    | RunRequest
    // look: a music video planned up to the look - its pictures are rendered without planning the shots first (#540)
    // anchorFile: the user's own picture as its anchor (an upload), with the description given by hand (descriptionFile) or read from it (describe)
    | {
          type: 'pictures'
          ids: string[]
          again?: boolean
          newAnchor?: boolean
          promptFile?: string
          look?: boolean
          anchorFile?: string
          descriptionFile?: string
          describe?: boolean
      }

const pipeline = (kind: EditorKind) => (kind === 'film' ? 'film.ts' : 'index.ts')

// what a command of the last run or of `status` may hold to be started from the page: rendering, nothing that asks in the terminal, no keys.
// Which servers a run goes to is chosen again on the page, so what the command said about them is left out
const SERVERS_FLAG = /^--comfy=/
const ALLOWED_FLAGS =
    /^--(render=[a-z,]+|only=[a-z0-9,-]+|beats=[a-z0-9,-]+|again|new-anchor|refresh=[a-z,]+|strict|preview|retake=[a-z0-9:.,-]+|until=[a-z]+|redo=[a-zA-Z,]+)$/

/** A command line as `status` or the last run give it, when it is one the page may start: its options. */
export function allowedOptions(kind: EditorKind, id: string, command: string): string[] | undefined {
    const [bun, script, project, ...options] = command.trim().split(/\s+/)
    if (bun !== 'bun' || script !== pipeline(kind) || project !== id) return undefined
    const rendering = options.filter(option => !SERVERS_FLAG.test(option))
    return rendering.every(option => ALLOWED_FLAGS.test(option)) ? rendering : undefined
}

/** The command an action comes to: script and arguments. Throws on what cannot be asked for. */
export function runCommand({id, kind}: Pick<EditorTarget, 'id' | 'kind'>, action: RunAction): {script: string; args: string[]} {
    const run = (...args: string[]) => ({script: pipeline(kind), args: [id, ...args]})
    const checked = (ids: string[], pattern: RegExp, what: string) => {
        if (!Array.isArray(ids) || !ids.length || ids.some(c => typeof c !== 'string' || !pattern.test(c)))
            throw new Error(`no such ${what}: ${JSON.stringify(ids)}`)
        return ids.join(',')
    }
    switch (action.type) {
        case 'direction':
            return {script: 'tools/direction.ts', args: [id, ...(kind === 'film' ? ['--film'] : []), '--preview']}
        case 'clips':
            return run(
                '--render=videos',
                `--only=${checked(action.ids, CLIP_ID, 'clips')}`,
                ...(action.again ? ['--again'] : []),
                ...(action.preview ? ['--preview'] : []),
            )
        case 'pictures':
            return run(
                '--render=images',
                `--only=${checked(action.ids, PICTURE_ID, 'pictures')}`,
                ...(action.again ? ['--again'] : []),
                ...(action.newAnchor ? ['--new-anchor'] : []),
                ...(action.promptFile ? [`--picture-prompt=${action.promptFile}`] : []),
                ...(action.anchorFile ? [`--picture-anchor=${action.anchorFile}`] : []),
                ...(action.descriptionFile ? [`--picture-description=${action.descriptionFile}`] : []),
                ...(action.describe ? ['--describe-picture'] : []),
                ...(action.look && kind === 'music' ? ['--until=look'] : []),
            )
        case 'adapt-story': {
            if (kind === 'music') return {script: 'tools/story.ts', args: [id, '--adapt']}
            // a film: its screenplay told anew for the roles that come and go (#589) - one argument each, never a line of shell
            const add = action.add ?? [],
                remove = action.remove ?? []
            const plain = (value: unknown, max: number) => typeof value === 'string' && !!value.trim() && value.length <= max && !/[\r\n:]/.test(value)
            if (
                !Array.isArray(add) ||
                add.some(a => !plain(a?.name, 80) || typeof a?.role !== 'string' || !a.role.trim() || a.role.length > 600 || /[\r\n]/.test(a.role))
            )
                throw new Error('a role added has a name (no colon) and who they are in the story')
            if (!Array.isArray(remove) || remove.some(r => typeof r !== 'string' || !PICTURE_ID.test(r)))
                throw new Error(`no such characters: ${JSON.stringify(remove)}`)
            if (!add.length && !remove.length) throw new Error('no role to add or take out')
            return {
                script: 'tools/story.ts',
                args: [id, '--film', '--adapt', ...add.map(a => `--add=${a.name.trim()}: ${a.role.trim()}`), ...remove.map(r => `--remove=${r}`)],
            }
        }
        case 'look-pictures':
            if (kind !== 'music') throw new Error('a film has its pictures from the look on: render them on the References page')
            return run('--until=look', '--render=images')
        case 'final':
            return run('--render=final', ...(action.preview ? ['--preview'] : []))
        case 'plan': {
            const steps: readonly string[] = kind === 'film' ? FILM_STEP_NAMES : STEP_NAMES
            const redo = action.redo ?? []
            if (!Array.isArray(redo) || redo.some(step => typeof step !== 'string' || !steps.includes(step)))
                throw new Error(`no such steps: ${JSON.stringify(redo)}`)
            if (action.until !== undefined && !(UNTIL_STAGES as readonly string[]).includes(action.until)) throw new Error(`no such stage: ${action.until}`)
            // the shots of these beats planned again, the others stay (#762)
            const beats = action.beats ?? []
            if (!Array.isArray(beats) || beats.some(b => typeof b !== 'string' || !PICTURE_ID.test(b)))
                throw new Error(`no such beats: ${JSON.stringify(beats)}`)
            if (beats.length && kind !== 'music') throw new Error('beats are planned again in a music video; a film plans scenes again')
            // a film's: the shots of these scenes planned again, the others stay (#836)
            const scenes = action.scenes ?? []
            if (!Array.isArray(scenes) || scenes.some(s => typeof s !== 'string' || !PICTURE_ID.test(s)))
                throw new Error(`no such scenes: ${JSON.stringify(scenes)}`)
            if (scenes.length && kind !== 'film') throw new Error('scenes are planned again in a film; a music video plans beats again')
            // a film's script repaired where it contradicts itself (#836)
            if (action.fixScript && kind !== 'film') throw new Error('a script is repaired in a film')
            const again = beats.length ? 'shotMoments' : scenes.length ? 'coverage' : undefined
            const redoSteps = again && !redo.includes(again) ? [...redo, again] : redo
            return run(
                ...(redoSteps.length ? [`--redo=${redoSteps.join(',')}`] : []),
                ...(beats.length ? [`--beats=${beats.join(',')}`] : []),
                ...(scenes.length ? [`--scenes=${scenes.join(',')}`] : []),
                ...(action.fixScript ? [`--fix-script`] : []),
                ...(action.until ? [`--until=${action.until}`] : []),
            )
        }
        case 'retake':
            if (!CLIP_ID.test(action.clip) || !/^(\d+(\.\d+)?-\d+(\.\d+)?|shot\d+)$/.test(action.range))
                throw new Error(`not a part of a clip: ${action.clip}:${action.range}`)
            return run(`--retake=${action.clip}:${action.range}`)
        case 'repeat':
        case 'next': {
            // a refinish of this project, with nothing but its own options
            const again = /^bun tools\/refinish\.ts (\S+)((?: --[a-z]+(?:=[A-Za-z0-9.,_-]+)?)*)$/.exec(action.command.trim())
            if (again && again[1] === id)
                return {
                    script: 'tools/refinish.ts',
                    args: [
                        id,
                        ...again[2]!
                            .trim()
                            .split(' ')
                            .filter(option => option && !SERVERS_FLAG.test(option)),
                    ],
                }
            const options = allowedOptions(kind, id, action.command)
            if (!options) throw new Error(`this command cannot be started from here - run it in the terminal: ${action.command}`)
            return run(...options)
        }
        case 'export': {
            if (kind !== 'music') throw new Error('a film writes its timeline (output/timeline.edl) when it is assembled')
            const formats = action.formats
            if (!Array.isArray(formats) || !formats.length || formats.some(f => !(EXPORT_FORMATS as readonly string[]).includes(f)))
                throw new Error(`no such formats: ${JSON.stringify(formats)} - ${EXPORT_FORMATS.join(', ')}`)
            return run(`--export=${formats.join(',')}`)
        }
        case 'leak-scan':
            return {script: 'tools/leak-scan.ts', args: [id, ...(kind === 'film' ? ['--film'] : [])]}
        case 'texture-chains':
            return {script: 'tools/texture-chains.ts', args: [id, ...(kind === 'film' ? ['--film'] : [])]}
        case 'check-joins':
            if (kind !== 'film') throw new Error('the cuts within a scene are checked in a film')
            return {script: 'tools/film-check-joins.ts', args: [id]}
        case 'refinish': {
            const args = [id, ...(kind === 'film' ? ['--film'] : [])]
            const say = (name: string, value: unknown, pattern: RegExp) => {
                if (value === undefined || value === '') return
                if (!pattern.test(String(value))) throw new Error(`no such ${name}: ${value}`)
                args.push(`--${name}=${value}`)
            }
            say('preset', action.preset, /^[a-z-]+$/)
            say('upscale', action.upscale, /^(none|refine|latent|model)$/)
            say('size', action.size, /^(fullhd|2x|\d+x\d+)$/)
            say('denoise', action.denoise, /^(0(\.\d+)?|1)$/)
            say('fps', action.fps, /^\d+$/)
            if (action.finish) args.push('--finish')
            if (action.only?.length) args.push(`--only=${checked(action.only, CLIP_ID, 'clips')}`)
            return {script: 'tools/refinish.ts', args}
        }
        // the options of these two are their schema's (lib/postwork/commands.ts, #826): no option is checked a second time here
        case 'label':
            return {script: labelCommand.script, args: [id, ...requestArgs(labelCommand, {...action, film: kind === 'film'})]}
        case 'intro':
            return {script: introCommand.script, args: [id, ...requestArgs(introCommand, {...action, film: kind === 'film'})]}
        case 'credits': {
            const args = [id, ...(kind === 'film' ? ['--film'] : [])]
            if (action.from !== undefined && action.from !== '') {
                if (!VIDEO_NAME.test(action.from)) throw new Error(`no such from: ${action.from}`)
                args.push(`--from=${action.from}`)
            }
            // one line of text each - the command checks the rest, as it does in the terminal
            const text = (name: string, value: string | undefined) => {
                if (value === undefined) return
                if (/[\n\r\0]/.test(value)) throw new Error(`${name}: one line of text`)
                args.push(`--${name}=${value}`)
            }
            text('title', action.title)
            text(kind === 'film' ? 'director' : 'artist', kind === 'film' ? action.director : action.artist)
            text('disclosure', action.disclosure)
            text('marker', action.marker)
            text('hardware', action.hardware)
            text('sound', action.sound)
            if (action.extra !== undefined) {
                if (!Array.isArray(action.extra)) throw new Error('extra: a list of lines')
                if (!action.extra.length) args.push('--no-lines')
                for (const line of action.extra) text('line', line)
            }
            for (const [name, on] of [
                ['opening', action.opening],
                ['end', action.end],
                ['facts', action.facts],
            ] as const)
                if (on !== undefined) args.push(on ? `--${name}` : `--no-${name}`)
            for (const [name, value] of [
                ['opening-seconds', action.openingSeconds],
                ['end-seconds', action.endSeconds],
            ] as const) {
                if (value === undefined) continue
                if (!/^\d+(\.\d+)?$/.test(String(value))) throw new Error(`no such ${name}: ${value}`)
                args.push(`--${name}=${value}`)
            }
            if (action.save) args.push('--save')
            if (action.saveDefault) args.push('--save-default')
            return {script: 'tools/credits.ts', args}
        }
        case 'description': {
            // the video is the user's choice: always said
            if (!VIDEO_NAME.test(action.from ?? '')) throw new Error(`no such from: ${action.from}`)
            const args = [id, ...(kind === 'film' ? ['--film'] : []), `--from=${action.from}`]
            const text = (name: string, value: string) => {
                if (/[\n\r\0]/.test(value)) throw new Error(`${name}: one line of text`)
                args.push(`--${name}=${value}`)
            }
            if (action.hardware !== undefined) text('hardware', action.hardware)
            if (action.extra !== undefined) {
                if (!Array.isArray(action.extra)) throw new Error('extra: a list of lines')
                if (!action.extra.length) args.push('--no-lines')
                for (const line of action.extra) text('line', line)
            }
            if (action.tags !== undefined) {
                if (!Array.isArray(action.tags)) throw new Error('tags: a list of hashtags')
                if (!action.tags.length) args.push('--no-tags')
                for (const tag of action.tags) text('tag', tag)
            }
            for (const [name, on] of [
                ['story', action.story],
                ['facts', action.facts],
            ] as const)
                if (on !== undefined) args.push(on ? `--${name}` : `--no-${name}`)
            if (action.newStory) args.push('--new-story')
            if (action.save) args.push('--save')
            if (action.saveDefault) args.push('--save-default')
            return {script: 'tools/description.ts', args}
        }
        case 'add-view':
            if (kind !== 'film' || !PICTURE_ID.test(action.location) || !action.name?.trim() || !action.shows?.trim())
                throw new Error('a further view is for a place of a film, with a name and what it shows')
            return {script: 'tools/add-view.ts', args: [id, action.location, `--name=${action.name.trim()}`, `--shows=${action.shows.trim()}`]}
        case 'export-asset':
            if (!PICTURE_ID.test(action.asset.replace('--', '-')) || (action.as && !PICTURE_ID.test(action.as))) throw new Error('no such asset')
            return {
                script: 'tools/export-asset.ts',
                args: [id, action.asset, ...(action.as ? [`--as=${action.as}`] : []), ...(kind === 'film' ? ['--film'] : [])],
            }
        case 'export-song': {
            if (kind === 'film') throw new Error('a film has no song to put into the library')
            if (action.as && !PICTURE_ID.test(action.as)) throw new Error(`"${action.as}" is no usable song id - lowercase letters, digits and dashes`)
            const name = action.name?.trim().replace(/\s+/g, ' ')
            return {script: 'tools/export-song.ts', args: [id, ...(action.as ? [`--as=${action.as}`] : []), ...(name ? [`--name=${name}`] : [])]}
        }
    }
}

type Own = {
    info: RunInfo
    proc: Bun.Subprocess
    lines: string[]
    dropped: number // lines no longer kept, so that a page that follows knows where it is
}

/** A stream of text as lines. A line a progress bar keeps rewriting (\r) counts as one each time. */
async function followLines(stream: ReadableStream<Uint8Array>, line: (text: string) => void) {
    const decoder = new TextDecoder()
    let rest = ''
    for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
        rest += decoder.decode(chunk, {stream: true})
        const parts = rest.split(/\r\n|\r|\n/)
        rest = parts.pop()!
        for (const part of parts) if (part.trim()) line(part)
    }
    if (rest.trim()) line(rest)
}

const dropFolders = (folders: string[]) => {
    for (const folder of folders) rmSync(folder, {recursive: true, force: true})
}

export class RunControl {
    private own = new Map<string, Own>()
    private key = (target: Pick<EditorTarget, 'kind' | 'id'>) => `${target.kind}/${target.id}`
    private root: string

    constructor(root = ROOT) {
        this.root = root
    }

    /**
     * Starts what is asked for, or throws when the project is being worked on. `servers`: the URLs it may render on - none said: those
     * of the settings. `temporary`: folders of what the run is given (an upload, an edited prompt) - they go when it has ended, or
     * right away when it is not started.
     */
    start(target: EditorTarget, action: RunAction, servers?: string[], temporary: string[] = []): RunInfo {
        return this.dropping(temporary, () => {
            const {script, args} = runCommand(target, action)
            return this.spawn(target, script, args, !['export-asset', 'export-song', 'leak-scan', 'texture-chains'].includes(action.type), servers, temporary)
        })
    }

    /**
     * Starts it now, or - while this project is worked on - puts it behind the run that goes on (#837): logs/queue.json, started in
     * order as the project is free (see startQueued). What cannot run at all is refused now, not when its turn comes.
     */
    startOrQueue(target: EditorTarget, action: RunAction, servers?: string[]): {run: RunInfo} | {queued: QueuedRun} {
        try {
            return {run: this.start(target, action, servers)}
        } catch (e) {
            if (!(e instanceof KindError) || e.kind !== 'busy') throw e
            const {script, args} = runCommand(target, action)
            return {queued: queueRun(target.dir, {request: action, command: ['bun', script, ...args].join(' '), ...(servers ? {servers} : {})})}
        }
    }

    /** The first run of the queue, started when nothing goes on in the project; one that cannot start any more is taken out and said. */
    startQueued(target: EditorTarget): RunInfo | undefined {
        if (this.own.get(this.key(target))?.info.running || lockHolder(target.dir) || !hasQueue(target.dir)) return undefined
        const next = takeFirst(target.dir)
        if (!next) return undefined
        try {
            return this.start(target, next.request as unknown as RunAction, next.servers)
        } catch (e) {
            console.error(`the queued run of ${target.id} was not started: ${next.command} - ${e instanceof Error ? e.message : String(e)}`)
            return undefined
        }
    }

    /** Looks for queued runs every few seconds - also those left by an editor before this one; the projects are asked anew each time. */
    watchQueues(targets: () => EditorTarget[], every = 3000): () => void {
        const timer = setInterval(() => {
            for (const target of targets()) if (readQueue(target.dir).length) this.startQueued(target)
        }, every)
        return () => clearInterval(timer)
    }

    /** A tool that is not about one project's files, under a name of its own - the library's create-asset. */
    startTool(target: EditorTarget, script: string, args: string[], servers?: string[], temporary: string[] = []): RunInfo {
        return this.dropping(temporary, () => this.spawn(target, script, args, false, servers, temporary))
    }

    private dropping(temporary: string[], start: () => RunInfo): RunInfo {
        try {
            return start()
        } catch (e) {
            dropFolders(temporary)
            throw e
        }
    }

    private spawn(target: EditorTarget, script: string, args: string[], locks: boolean, servers?: string[], temporary: string[] = []): RunInfo {
        const running = this.own.get(this.key(target))
        if (running?.info.running) throw busy(`a run is going on here: ${running.info.command}`)
        const holder = locks ? lockHolder(target.dir) : undefined
        if (holder)
            throw busy(`${target.id} is being worked on by another run (process ${holder}) - it can be followed and stopped here, a second one is not started`)
        // no terminal: nothing can be asked (stdin closed), no colours and no animation in the log
        const proc = Bun.spawn(['bun', join(this.root, script), ...args], {
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'pipe',
            env: {...process.env, NO_COLOR: '1', FEVERSLOP_QUIET: '', FORCE_COLOR: '0', ...(servers ? {FEVERSLOP_COMFY: servers.join(',')} : {})},
        })
        const own: Own = {
            info: {
                source: 'here',
                command: ['bun', script, ...args, ...(servers ? [`--comfy=${servers.join(',')}`] : [])].join(' '),
                pid: proc.pid,
                startedAt: new Date().toISOString(),
                running: true,
            },
            proc,
            lines: [],
            dropped: 0,
        }
        const add = (text: string) => {
            own.lines.push(text)
            if (own.lines.length > LINES_KEPT) {
                own.lines.shift()
                own.dropped++
            }
        }
        followLines(proc.stdout as ReadableStream<Uint8Array>, add).catch(() => {})
        followLines(proc.stderr as ReadableStream<Uint8Array>, add).catch(() => {})
        void proc.exited
            .then(code => {
                own.info.running = false
                own.info.code = code
                // a tool that keeps no record of its own (leak-scan, texture-chains, ...): the editor puts it in the history (#837)
                if (lastRun(target.dir)?.pid !== proc.pid)
                    notePastRun(target.dir, {
                        command: own.info.command,
                        startedAt: own.info.startedAt,
                        endedAt: new Date().toISOString(),
                        state: code === 0 ? 'finished' : 'failed',
                    })
            })
            .finally(() => dropFolders(temporary))
        this.own.set(this.key(target), own)
        return own.info
    }

    /** The run of this project: the one started here, or one started in the terminal that holds its lock. */
    current(target: EditorTarget): RunInfo | undefined {
        const own = this.own.get(this.key(target))
        if (own?.info.running) return own.info
        const holder = lockHolder(target.dir)
        if (holder) {
            const record = lastRun(target.dir)
            return {
                source: 'terminal',
                command: record && runState(record) === 'running' ? record.command : `process ${holder}`,
                pid: holder,
                startedAt: record?.startedAt ?? '',
                running: true,
            }
        }
        return own?.info
    }

    /** The lines from `after` on, as far as they are known: `next` is what to ask from the next time. */
    lines(target: EditorTarget, after: number): {lines: string[]; next: number} {
        const own = this.own.get(this.key(target))
        if (own && (own.info.running || !lockHolder(target.dir))) {
            const from = Math.max(0, after - own.dropped)
            return {lines: own.lines.slice(from), next: own.dropped + own.lines.length}
        }
        // a run started in the terminal: its log, as it grows
        const log = newestLog(target.dir)
        if (!log || !lockHolder(target.dir)) return {lines: [], next: after}
        const all = this.terminalLog(this.key(target), log)
        return {lines: all.slice(after), next: all.length}
    }

    /**
     * The events of the newest run of this project (#829), started here or in the terminal: the file next to its newest log. `file`
     * names it, so that a follower sees when another run began.
     */
    events(target: EditorTarget): {file?: string; events: RunEvent[]} {
        const log = newestLog(target.dir)
        if (!log) return {events: []}
        const file = eventsFileOf(log)
        if (!existsSync(file)) return {file, events: []}
        const events: RunEvent[] = []
        // only whole lines: a line still being written is read when it is complete
        for (const line of readFileSync(file, 'utf8').split('\n').slice(0, -1)) {
            try {
                events.push(JSON.parse(line) as RunEvent)
            } catch {
                // a line that is not an event is skipped, not the run
            }
        }
        return {file, events}
    }

    // the lines of the log being followed, per project: only the bytes appended since the last poll are read
    private logs = new Map<string, {file: string; bytes: number; lines: string[]}>()

    private terminalLog(key: string, file: string): string[] {
        let seen = this.logs.get(key)
        const size = statSync(file).size
        if (!seen || seen.file !== file || size < seen.bytes) this.logs.set(key, (seen = {file, bytes: 0, lines: []}))
        if (size > seen.bytes) {
            const chunk = Buffer.alloc(size - seen.bytes)
            const fd = openSync(file, 'r')
            try {
                readSync(fd, chunk, 0, chunk.length, seen.bytes)
            } finally {
                closeSync(fd)
            }
            // only whole lines: a line still being written is read when it is complete
            const end = chunk.lastIndexOf(10) + 1
            seen.bytes += end
            for (const line of chunk.subarray(0, end).toString('utf8').split(/\r?\n/)) if (line.trim()) seen.lines.push(line)
        }
        return seen.lines
    }

    /**
     * Stops the run of this project and cancels the ComfyUI jobs it queued or took up (#736) - a stop is meant: the jobs would keep
     * the servers busy. Finished outputs stay. A process that gets a signal cancels its own jobs (lib/cli.ts); on Windows it is ended
     * at once, so whatever is still pending of this run is cancelled here, once the process is gone or has had its time.
     */
    async stop(target: EditorTarget, servers?: Pick<ComfyServer, 'name' | 'url' | 'credentials'>[]): Promise<boolean> {
        const own = this.own.get(this.key(target))
        let started: number
        let ended: Promise<unknown>
        if (own?.info.running) {
            started = Date.parse(own.info.startedAt)
            own.proc.kill()
            ended = own.proc.exited
        } else {
            const holder = lockHolder(target.dir)
            if (!holder) return false
            if (verifiedLockHolder(target.dir) !== holder)
                throw new Error('Cannot verify the process identity of this lock; stop the run in its original terminal')
            started = Date.parse(lastRun(target.dir)?.startedAt ?? '')
            process.kill(holder)
            ended = (async () => {
                while (lockHolder(target.dir) === holder) await Bun.sleep(200)
            })()
        }
        await Promise.race([ended, Bun.sleep(STOP_WAIT_MS)])
        if (Number.isFinite(started)) await cancelJobs(await jobsQueuedSince(target.dir, started, servers ?? (await loadSettings()).comfy))
        return true
    }
}

function newestLog(dir: string): string | undefined {
    const logs = join(dir, 'logs')
    if (!existsSync(logs)) return undefined
    const files = readdirSync(logs)
        .filter(f => f.endsWith('.log'))
        .map(f => join(logs, f))
    return files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
}
