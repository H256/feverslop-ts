import {join} from 'node:path'
import {validProjectId} from '../project-setup.ts'
import type {NewProject} from '../../shared/workspace.ts'

// A new music video from the workspace (#831): the page's form becomes the options of `bun run init`, which asks nothing when it is
// given them (lib/init-options.ts) - the same command as in the terminal, CLI first. It only writes the project's folder, in an
// instant, so it is waited for and answered, not followed as a run.

const ROOT = join(import.meta.dir, '..', '..')
// what the page may say: text fields, each an option of the command
const FIELDS = {
    song: 'song',
    idea: 'idea',
    lyrics: 'lyrics',
    storyIdea: 'story-idea',
    style: 'style',
    musicStyle: 'music-style',
    singers: 'singers',
    language: 'language',
} as const

/** The arguments of `bun run init` a request of the page comes to. Throws on what is no usable value. */
export function initArgs(request: NewProject): string[] {
    if (typeof request.id !== 'string' || !validProjectId(request.id)) throw new Error('the id of a project: lowercase letters, digits and "-"')
    const args = [request.id]
    for (const [field, option] of Object.entries(FIELDS) as [keyof typeof FIELDS, string][]) {
        const value = request[field]
        if (value === undefined || value === '') continue
        if (typeof value !== 'string' || value.includes('\0') || value.length > 100_000) throw new Error(`${option}: a text`)
        // the song is a file on this machine (the page and the server are the same machine); everything else is the text itself
        if (!value.trim()) continue
        args.push(`--${option}=${field === 'song' ? value.trim() : value}`)
    }
    if (args.length === 1) throw new Error('a song with its lyrics or a story idea, or an idea to make a song from')
    return args
}

/** What the command said was wrong, from its output: the line after its heading. */
export function saidWrong(output: string): string {
    const lines = output
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
    const at = lines.findIndex(line => /BAD USAGE|FAILED|Failed/.test(line))
    const said = at < 0 ? lines.at(-1) : lines[at]!.replace(/^.*?(BAD USAGE|FAILED|✗ Failed)\s*/, '') || lines[at + 1]
    return said || 'the project could not be created'
}

/** Runs `bun run init <id> …` and answers with the id, or throws with what the command said. */
export async function createProject(request: NewProject, root = ROOT): Promise<{id: string}> {
    const proc = Bun.spawn(['bun', join(root, 'tools', 'init.ts'), ...initArgs(request)], {
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
        env: {...process.env, NO_COLOR: '1', FORCE_COLOR: '0', FEVERSLOP_QUIET: ''},
    })
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
    if (code !== 0) throw new Error(saidWrong(`${out}\n${err}`))
    return {id: request.id}
}
