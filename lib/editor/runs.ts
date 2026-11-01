import {existsSync, readdirSync, readFileSync, statSync} from "node:fs";
import {join} from "node:path";
import {lockHolder} from "../lock.ts";
import {lastRun, runState} from "../run-record.ts";
import type {EditorKind, EditorTarget} from "./project.ts";

// Everything that renders from the workspace is the CLI, started here: a run goes through the same lock as one started in the
// terminal, so the two exclude each other, and it is asked for by what it should do - never as a command line from the page.

const ROOT = join(import.meta.dir, '..', '..')
const LINES_KEPT = 4000
const CLIP_ID = /^[a-z]+-\d+$/
const PICTURE_ID = /^[a-z0-9][a-z0-9-]*$/

export type RunAction =
    | { type: 'clips', ids: string[], again?: boolean, preview?: boolean }
    | { type: 'pictures', ids: string[], again?: boolean, newAnchor?: boolean, promptFile?: string }
    | { type: 'final', preview?: boolean }
    | { type: 'plan' }
    | { type: 'refresh', what: ('pictures' | 'clips')[] }
    | { type: 'retake', clip: string, range: string }
    | { type: 'repeat', command: string }
    | { type: 'next', command: string }
    | { type: 'leak-scan' }
    | { type: 'export-asset', asset: string, as?: string }

const pipeline = (kind: EditorKind) => kind === 'film' ? 'film.ts' : 'index.ts'

// what a command of the last run or of `status` may hold to be started from the page: rendering, nothing that asks in the terminal, no servers or keys
const ALLOWED_FLAGS = /^--(render=[a-z,]+|only=[a-z0-9,-]+|again|new-anchor|refresh=[a-z,]+|strict|preview|retake=[a-z0-9:.,-]+)$/

/** A command line as `status` or the last run give it, when it is one the page may start: its options. */
export function allowedOptions(kind: EditorKind, id: string, command: string): string[] | undefined {
    const [bun, script, project, ...options] = command.trim().split(/\s+/)
    if (bun !== 'bun' || script !== pipeline(kind) || project !== id) return undefined
    return options.every(option => ALLOWED_FLAGS.test(option)) ? options : undefined
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
            return run('--render=images', `--only=${checked(action.ids, PICTURE_ID, 'pictures')}`, ...(action.again ? ['--again'] : []), ...(action.newAnchor ? ['--new-anchor'] : []), ...(action.promptFile ? [`--picture-prompt=${action.promptFile}`] : []))
        case 'final':
            return run('--render=final', ...(action.preview ? ['--preview'] : []))
        case 'plan':
            return run()
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
            const options = allowedOptions(kind, id, action.command)
            if (!options) throw new Error(`this command cannot be started from here - run it in the terminal: ${action.command}`)
            return run(...options)
        }
        case 'leak-scan':
            return {script: 'tools/leak-scan.ts', args: [id, ...(kind === 'film' ? ['--film'] : [])]}
        case 'export-asset':
            if (!PICTURE_ID.test(action.asset.replace('--', '-')) || (action.as && !PICTURE_ID.test(action.as))) throw new Error('no such asset')
            return {script: 'tools/export-asset.ts', args: [id, action.asset, ...(action.as ? [`--as=${action.as}`] : []), ...(kind === 'film' ? ['--film'] : [])]}
    }
}

export type RunInfo = {
    source: 'here' | 'terminal',
    command: string,
    pid: number,
    startedAt: string,
    running: boolean,
    code?: number,
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

    /** Starts what is asked for, or throws when the project is being worked on. */
    start(target: EditorTarget, action: RunAction): RunInfo {
        const {script, args} = runCommand(target, action)
        return this.spawn(target, script, args, action.type !== 'export-asset' && action.type !== 'leak-scan')
    }

    /** A tool that is not about one project's files, under a name of its own - the library's create-asset. */
    startTool(target: EditorTarget, script: string, args: string[]): RunInfo {
        return this.spawn(target, script, args, false)
    }

    private spawn(target: EditorTarget, script: string, args: string[], locks: boolean): RunInfo {
        const running = this.own.get(this.key(target))
        if (running?.info.running) throw new Error(`a run is going on here: ${running.info.command}`)
        const holder = locks ? lockHolder(target.dir) : undefined
        if (holder) throw new Error(`${target.id} is being worked on by another run (process ${holder}) - it can be followed and stopped here, a second one is not started`)
        // no terminal: nothing can be asked (stdin closed), no colours and no animation in the log
        const proc = Bun.spawn(['bun', join(this.root, script), ...args], {stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', env: {...process.env, NO_COLOR: '1', FEVERSLOP_QUIET: '', FORCE_COLOR: '0'}})
        const own: Own = {info: {source: 'here', command: ['bun', script, ...args].join(' '), pid: proc.pid, startedAt: new Date().toISOString(), running: true}, proc, lines: [], dropped: 0}
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
