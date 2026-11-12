import {join} from 'node:path'
import type {DryRun, RunRequest} from '../../shared/workspace.ts'
import type {EditorTarget} from './project.ts'
import {saidWrong} from './new-project.ts'
import {runCommand} from './runs.ts'

// What a plan run would do, asked before it runs (#836): the command itself with --dry-run --json - the same reasons, steps and
// estimate the terminal shows - a music video's and a film's. It only reads; nothing is locked or written.

const ROOT = join(import.meta.dir, '..', '..')

export async function dryRun(target: EditorTarget, action: Extract<RunRequest, {type: 'plan'}>): Promise<DryRun> {
    const {script, args} = runCommand(target, action)
    // --until stops a run; a dry run says what all of it would redo, the page says where it stops
    const asked = args.filter(a => !a.startsWith('--until='))
    const proc = Bun.spawn(['bun', join(ROOT, script), ...asked, '--dry-run', '--json'], {stdout: 'pipe', stderr: 'pipe', stdin: 'ignore'})
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
    if (code !== 0) {
        let said = err.trim().split('\n').at(-1) ?? ''
        try {
            said = (JSON.parse(err.trim().split('\n').at(-1) ?? '') as {error?: string}).error ?? said
        } catch {}
        throw new Error(said || `the dry run ended with code ${code}`)
    }
    return JSON.parse(out) as DryRun
}

/** What replacing a character's picture would do (#835): the command with --dry-run, its lines as the terminal shows them. Reads only. */
export async function replaceDryRun(target: EditorTarget, action: Extract<RunRequest, {type: 'replace-character'}>): Promise<{lines: string[]}> {
    const {script, args} = runCommand(target, action)
    const proc = Bun.spawn(['bun', join(ROOT, script), ...args.filter(a => a !== '--render-sheet'), '--dry-run'], {
        stdout: 'pipe',
        stderr: 'pipe',
        stdin: 'ignore',
        env: {...process.env, NO_COLOR: '1', FORCE_COLOR: '0', FEVERSLOP_QUIET: ''},
    })
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
    const lines = `${out}${err}`
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.startsWith('▸ '))
        .map(line => line.slice(2))
    if (code !== 0) throw new Error(saidWrong(`${out}${err}`))
    return {lines}
}
