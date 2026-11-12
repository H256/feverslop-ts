import {closeSync, openSync, readSync, rmSync, statSync} from 'node:fs'
import {join} from 'node:path'
import {lockHolder, verifiedLockHolder} from '../lock.ts'
import {validProjectId} from '../project-setup.ts'
import {cancelJobs, jobsQueuedSince} from '../comfy-cancel.ts'
import {type ComfyServer, loadSettings} from '../settings.ts'

// how long a stopped run gets to cancel its own jobs before what is left of them is cancelled from here
const STOP_WAIT_MS = 10_000
import {lastRun, runState} from '../run-record.ts'
import type {EditorKind, EditorTarget} from './project.ts'
import {UNTIL_STAGES} from '../stages.ts'
import {requestArgs} from '../command-schema.ts'
import {creditsCommand, descriptionCommand, introCommand, labelCommand} from '../postwork/commands.ts'
import {refinishCommand} from '../refinish-command.ts'
import {EXPORT_FORMATS} from '../timeline-export.ts'
import type {RunEvent, RunInfo, RunRequest} from '../../shared/workspace.ts'
import {newestLog, newestRunEvents} from '../run-events.ts'
import {busy, KindError} from '../service-error.ts'
import {hasQueue, notePastRun, queueRun, readQueue, takeFirst} from '../run-queue.ts'
import type {QueuedRun} from '../../shared/workspace.ts'
import {KINDS} from './kinds.ts'
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

const pipeline = (kind: EditorKind) => KINDS[kind].pipeline

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
            return {script: 'tools/direction.ts', args: [id, ...KINDS[kind].flag, '--preview']}
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
            const steps = KINDS[kind].stepNames
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
            return {script: 'tools/leak-scan.ts', args: [id, ...KINDS[kind].flag]}
        case 'texture-chains':
            return {script: 'tools/texture-chains.ts', args: [id, ...KINDS[kind].flag]}
        case 'check-joins':
            if (kind !== 'film') throw new Error('the cuts within a scene are checked in a film')
            return {script: 'tools/film-check-joins.ts', args: [id]}
        case 'refinish':
            // the clips as a list in the request, one option on the command line
            return {
                script: refinishCommand.script,
                args: [id, ...requestArgs(refinishCommand, {...action, only: action.only?.join(','), film: KINDS[kind].film})],
            }
        // the options of these two are their schema's (lib/postwork/commands.ts, #826): no option is checked a second time here
        case 'label':
            return {script: labelCommand.script, args: [id, ...requestArgs(labelCommand, {...action, film: KINDS[kind].film})]}
        case 'intro':
            return {script: introCommand.script, args: [id, ...requestArgs(introCommand, {...action, film: KINDS[kind].film})]}
        case 'credits': {
            // a music video names its artist, a film its director: the other field is not this kind's
            const {artist, director, ...rest} = action
            const asked = {...rest, ...(kind === 'film' ? {director} : {artist}), film: KINDS[kind].film}
            return {script: creditsCommand.script, args: [id, ...requestArgs(creditsCommand, asked)]}
        }
        case 'description':
            // the video is the user's choice: always said
            if (!action.from) throw new Error(`no such from: ${action.from}`)
            return {script: descriptionCommand.script, args: [id, ...requestArgs(descriptionCommand, {...action, film: KINDS[kind].film})]}
        case 'add-view':
            if (kind !== 'film' || !PICTURE_ID.test(action.location) || !action.name?.trim() || !action.shows?.trim())
                throw new Error('a further view is for a place of a film, with a name and what it shows')
            return {script: 'tools/add-view.ts', args: [id, action.location, `--name=${action.name.trim()}`, `--shows=${action.shows.trim()}`]}
        case 'replace-character': {
            if (!PICTURE_ID.test(action.character)) throw new Error(`no such character: ${action.character}`)
            // the picture is a file on this machine - the page and the server are the same machine; one line each
            for (const [name, value] of [
                ['picture', action.picture],
                ['description', action.description],
            ] as const)
                if (typeof value !== 'string' || !value.trim() || /[\n\r\0]/.test(value)) throw new Error(`${name}: one line of text`)
            return {
                script: kind === 'film' ? 'tools/film-replace-character.ts' : 'tools/replace-character.ts',
                args: [
                    id,
                    `--character=${action.character}`,
                    `--picture=${action.picture.trim()}`,
                    `--description=${action.description.trim()}`,
                    ...(action.renderSheet ? ['--render-sheet'] : []),
                ],
            }
        }
        case 'import-asset': {
            if (kind !== 'music') throw new Error('a film takes a character or place from the library on the Casting page')
            if (![action.asset, action.from].every(a => PICTURE_ID.test(a)) || !validProjectId(action.project) || action.project === id)
                throw new Error('no such asset of another project')
            if (!['source', 'vision', 'keep'].includes(action.description)) throw new Error(`no such description: ${action.description}`)
            return {
                script: 'tools/import-asset.ts',
                args: [id, action.asset, `--from=${action.project}:${action.from}`, `--description=${action.description}`],
            }
        }
        case 'export-asset':
            if (!PICTURE_ID.test(action.asset.replace('--', '-')) || (action.as && !PICTURE_ID.test(action.as))) throw new Error('no such asset')
            return {
                script: 'tools/export-asset.ts',
                args: [id, action.asset, ...(action.as ? [`--as=${action.as}`] : []), ...KINDS[kind].flag],
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
        return newestRunEvents(target.dir)
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
