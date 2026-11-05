import {existsSync, readdirSync, readFileSync, statSync} from "node:fs";
import {join} from "node:path";
import {lockHolder} from "../lock.ts";
import {lastRun, runState} from "../run-record.ts";
import type {EditorKind, EditorTarget} from "./project.ts";
import {STEP_NAMES} from "../project.ts";
import {UNTIL_STAGES} from "../stages.ts";
import {FILM_STEP_NAMES} from "../film/store.ts";
import type {RunInfo, RunRequest} from '../../shared/workspace.ts';
export type {RunInfo} from '../../shared/workspace.ts';

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
    | { type: 'pictures', ids: string[], again?: boolean, newAnchor?: boolean, promptFile?: string, look?: boolean }

const pipeline = (kind: EditorKind) => kind === 'film' ? 'film.ts' : 'index.ts'

// what a command of the last run or of `status` may hold to be started from the page: rendering, nothing that asks in the terminal, no keys.
// Which servers a run goes to is chosen again on the page, so what the command said about them is left out
const SERVERS_FLAG = /^--comfy=/
const ALLOWED_FLAGS = /^--(render=[a-z,]+|only=[a-z0-9,-]+|again|new-anchor|refresh=[a-z,]+|strict|preview|retake=[a-z0-9:.,-]+|until=[a-z]+|redo=[a-zA-Z,]+)$/

/** A command line as `status` or the last run give it, when it is one the page may start: its options. */
export function allowedOptions(kind: EditorKind, id: string, command: string): string[] | undefined {
    const [bun, script, project, ...options] = command.trim().split(/\s+/)
    if (bun !== 'bun' || script !== pipeline(kind) || project !== id) return undefined
    const rendering = options.filter(option => !SERVERS_FLAG.test(option))
    return rendering.every(option => ALLOWED_FLAGS.test(option)) ? rendering : undefined
}

/** The command an action comes to: script and arguments. Throws on what cannot be asked for. */
export function runCommand({id, kind}: Pick<EditorTarget, 'id' | 'kind'>, action: RunAction): { script: string, args: string[] } {
    const run = (...args: string[]) => ({script: pipeline(kind), args: [id, ...args]})
    const checked = (ids: string[], pattern: RegExp, what: string) => {
        if (!Array.isArray(ids) || !ids.length || ids.some(c => typeof c !== 'string' || !pattern.test(c))) throw new Error(`no such ${what}: ${JSON.stringify(ids)}`)
        return ids.join(',')
    }
    switch (action.type) {
        case 'clips':
            return run('--render=videos', `--only=${checked(action.ids, CLIP_ID, 'clips')}`, ...(action.again ? ['--again'] : []), ...(action.preview ? ['--preview'] : []))
        case 'pictures':
            return run('--render=images', `--only=${checked(action.ids, PICTURE_ID, 'pictures')}`, ...(action.again ? ['--again'] : []), ...(action.newAnchor ? ['--new-anchor'] : []), ...(action.promptFile ? [`--picture-prompt=${action.promptFile}`] : []), ...(action.look && kind === 'music' ? ['--until=look'] : []))
        case 'adapt-story': {
            if (kind === 'music') return {script: 'tools/story.ts', args: [id, '--adapt']}
            // a film: its screenplay told anew for the roles that come and go (#589) - one argument each, never a line of shell
            const add = action.add ?? [], remove = action.remove ?? []
            const plain = (value: unknown, max: number) => typeof value === 'string' && !!value.trim() && value.length <= max && !/[\r\n:]/.test(value)
            if (!Array.isArray(add) || add.some(a => !plain(a?.name, 80) || typeof a?.role !== 'string' || !a.role.trim() || a.role.length > 600 || /[\r\n]/.test(a.role))) throw new Error('a role added has a name (no colon) and who they are in the story')
            if (!Array.isArray(remove) || remove.some(r => typeof r !== 'string' || !PICTURE_ID.test(r))) throw new Error(`no such characters: ${JSON.stringify(remove)}`)
            if (!add.length && !remove.length) throw new Error('no role to add or take out')
            return {script: 'tools/story.ts', args: [id, '--film', '--adapt', ...add.map(a => `--add=${a.name.trim()}: ${a.role.trim()}`), ...remove.map(r => `--remove=${r}`)]}
        }
        case 'look-pictures':
            if (kind !== 'music') throw new Error('a film has its pictures from the look on: render them on the References page')
            return run('--until=look', '--render=images')
        case 'final':
            return run('--render=final', ...(action.preview ? ['--preview'] : []))
        case 'plan': {
            const steps: readonly string[] = kind === 'film' ? FILM_STEP_NAMES : STEP_NAMES
            const redo = action.redo ?? []
            if (!Array.isArray(redo) || redo.some(step => typeof step !== 'string' || !steps.includes(step))) throw new Error(`no such steps: ${JSON.stringify(redo)}`)
            if (action.until !== undefined && !(UNTIL_STAGES as readonly string[]).includes(action.until)) throw new Error(`no such stage: ${action.until}`)
            return run(...(redo.length ? [`--redo=${redo.join(',')}`] : []), ...(action.until ? [`--until=${action.until}`] : []))
        }
        case 'refresh': {
            const what = action.what.filter(w => w === 'pictures' || w === 'clips')
            if (!what.length) throw new Error('nothing to refresh')
            return run(`--render=${what.map(w => w === 'pictures' ? 'images' : 'videos').join(',')}`, `--refresh=${what.join(',')}`)
        }
        case 'retake':
            if (!CLIP_ID.test(action.clip) || !/^(\d+(\.\d+)?-\d+(\.\d+)?|shot\d+)$/.test(action.range)) throw new Error(`not a part of a clip: ${action.clip}:${action.range}`)
            return run(`--retake=${action.clip}:${action.range}`)
        case 'repeat':
        case 'next': {
            // a refinish of this project, with nothing but its own options
            const again = /^bun tools\/refinish\.ts (\S+)((?: --[a-z]+(?:=[A-Za-z0-9.,_-]+)?)*)$/.exec(action.command.trim())
            if (again && again[1] === id) return {script: 'tools/refinish.ts', args: [id, ...again[2]!.trim().split(' ').filter(option => option && !SERVERS_FLAG.test(option))]}
            const options = allowedOptions(kind, id, action.command)
            if (!options) throw new Error(`this command cannot be started from here - run it in the terminal: ${action.command}`)
            return run(...options)
        }
        case 'leak-scan':
            return {script: 'tools/leak-scan.ts', args: [id, ...(kind === 'film' ? ['--film'] : [])]}
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
        case 'add-view':
            if (kind !== 'film' || !PICTURE_ID.test(action.location) || !action.name?.trim() || !action.shows?.trim()) throw new Error('a further view is for a place of a film, with a name and what it shows')
            return {script: 'tools/add-view.ts', args: [id, action.location, `--name=${action.name.trim()}`, `--shows=${action.shows.trim()}`]}
        case 'export-asset':
            if (!PICTURE_ID.test(action.asset.replace('--', '-')) || (action.as && !PICTURE_ID.test(action.as))) throw new Error('no such asset')
            return {script: 'tools/export-asset.ts', args: [id, action.asset, ...(action.as ? [`--as=${action.as}`] : []), ...(kind === 'film' ? ['--film'] : [])]}
        case 'export-song': {
            if (kind === 'film') throw new Error('a film has no song to put into the library')
            if (action.as && !PICTURE_ID.test(action.as)) throw new Error(`"${action.as}" is no usable song id - lowercase letters, digits and dashes`)
            const name = action.name?.trim().replace(/\s+/g, ' ')
            return {script: 'tools/export-song.ts', args: [id, ...(action.as ? [`--as=${action.as}`] : []), ...(name ? [`--name=${name}`] : [])]}
        }
    }
}


type Own = {
    info: RunInfo,
    proc: Bun.Subprocess,
    lines: string[],
    dropped: number,        // lines no longer kept, so that a page that follows knows where it is
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

export class RunControl {
    private own = new Map<string, Own>()
    private key = (target: Pick<EditorTarget, 'kind' | 'id'>) => `${target.kind}/${target.id}`
    private root: string

    constructor(root = ROOT) {
        this.root = root
    }

    /** Starts what is asked for, or throws when the project is being worked on. `servers`: the URLs it may render on - none said: those of the settings. */
    start(target: EditorTarget, action: RunAction, servers?: string[]): RunInfo {
        const {script, args} = runCommand(target, action)
        return this.spawn(target, script, args, action.type !== 'export-asset' && action.type !== 'export-song' && action.type !== 'leak-scan', servers)
    }

    /** A tool that is not about one project's files, under a name of its own - the library's create-asset. */
    startTool(target: EditorTarget, script: string, args: string[], servers?: string[]): RunInfo {
        return this.spawn(target, script, args, false, servers)
    }

    private spawn(target: EditorTarget, script: string, args: string[], locks: boolean, servers?: string[]): RunInfo {
        const running = this.own.get(this.key(target))
        if (running?.info.running) throw new Error(`a run is going on here: ${running.info.command}`)
        const holder = locks ? lockHolder(target.dir) : undefined
        if (holder) throw new Error(`${target.id} is being worked on by another run (process ${holder}) - it can be followed and stopped here, a second one is not started`)
        // no terminal: nothing can be asked (stdin closed), no colours and no animation in the log
        const proc = Bun.spawn(['bun', join(this.root, script), ...args], {stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', env: {...process.env, NO_COLOR: '1', FEVERSLOP_QUIET: '', FORCE_COLOR: '0', ...(servers ? {FEVERSLOP_COMFY: servers.join(',')} : {})}})
        const own: Own = {info: {source: 'here', command: ['bun', script, ...args, ...(servers ? [`--comfy=${servers.join(',')}`] : [])].join(' '), pid: proc.pid, startedAt: new Date().toISOString(), running: true}, proc, lines: [], dropped: 0}
        const add = (text: string) => {
            own.lines.push(text)
            if (own.lines.length > LINES_KEPT) {
                own.lines.shift()
                own.dropped++
            }
        }
        followLines(proc.stdout as ReadableStream<Uint8Array>, add).catch(() => {})
        followLines(proc.stderr as ReadableStream<Uint8Array>, add).catch(() => {})
        proc.exited.then(code => {
            own.info.running = false
            own.info.code = code
        })
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
            return {source: 'terminal', command: record && runState(record) === 'running' ? record.command : `process ${holder}`, pid: holder, startedAt: record?.startedAt ?? '', running: true}
        }
        return own?.info
    }

    /** The lines from `after` on, as far as they are known: `next` is what to ask from the next time. */
    lines(target: EditorTarget, after: number): { lines: string[], next: number } {
        const own = this.own.get(this.key(target))
        if (own && (own.info.running || !lockHolder(target.dir))) {
            const from = Math.max(0, after - own.dropped)
            return {lines: own.lines.slice(from), next: own.dropped + own.lines.length}
        }
        // a run started in the terminal: its log, as it grows
        const log = newestLog(target.dir)
        if (!log || !lockHolder(target.dir)) return {lines: [], next: after}
        const all = readFileSync(log, 'utf8').split(/\r?\n/).filter(line => line.trim())
        return {lines: all.slice(after), next: all.length}
    }

    /** Stops the run of this project. Finished outputs stay, jobs on a server are picked up by the next run. */
    stop(target: EditorTarget): boolean {
        const own = this.own.get(this.key(target))
        if (own?.info.running) {
            own.proc.kill()
            return true
        }
        const holder = lockHolder(target.dir)
        if (!holder) return false
        process.kill(holder)
        return true
    }
}

function newestLog(dir: string): string | undefined {
    const logs = join(dir, 'logs')
    if (!existsSync(logs)) return undefined
    const files = readdirSync(logs).filter(f => f.endsWith('.log')).map(f => join(logs, f))
    return files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
}
