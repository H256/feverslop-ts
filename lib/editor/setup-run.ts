import {join} from 'node:path'
import type {SetupChange} from '../../shared/workspace.ts'
import {saidWrong} from './new-project.ts'

// A change of the servers from the workspace's Machine panel (#831): `bun run setup <command> --<option>=…`, the same command as in the
// terminal (CLI first). It only writes the settings file, in an instant - waited for and answered, not followed as a run.

const ROOT = join(import.meta.dir, '..', '..')
const OPTIONS: Record<SetupChange['command'], string[]> = {
    llm: ['url', 'key', 'model', 'parallel'],
    vision: ['url', 'key', 'model', 'off'],
    comfy: ['add', 'name', 'token', 'remove'],
}

/** The arguments of `bun run setup` a change of the page comes to. Throws on what is no usable value. */
export function setupArgs(change: SetupChange): string[] {
    const allowed = OPTIONS[change?.command]
    if (!allowed) throw new Error('setup: llm, vision or comfy')
    const args: string[] = [change.command]
    for (const [name, value] of Object.entries(change.options ?? {})) {
        if (!allowed.includes(name)) throw new Error(`setup ${change.command} has no option --${name}`)
        if (value === true) args.push(`--${name}`)
        else if (typeof value === 'string' && value.trim() && value.length < 2000 && !/[\r\n]/.test(value)) args.push(`--${name}=${value.trim()}`)
        else if (value !== false && value !== '') throw new Error(`--${name}: a line of text`)
    }
    if (args.length === 1) throw new Error('nothing to change')
    return args
}

/** Runs it and answers with what it said it saved, or throws with what the command said was wrong. */
export async function runSetup(change: SetupChange, root = ROOT): Promise<{said: string[]}> {
    const proc = Bun.spawn(['bun', join(root, 'tools', 'setup.ts'), ...setupArgs(change)], {
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
        env: {...process.env, NO_COLOR: '1', FORCE_COLOR: '0', FEVERSLOP_QUIET: ''},
    })
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
    if (code !== 0) throw new Error(saidWrong(`${out}${err}`))
    const said = `${out}${err}`
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => /^▸ (Saved|Warning|Server)/.test(line))
        .map(line => line.replace(/^▸ /, ''))
    return {said}
}
