import {describe, expect, test} from 'bun:test'
import {readdirSync, readFileSync} from 'node:fs'
import {join} from 'node:path'

// CLI first: whatever the workspace changes, a command changes the same way. The pages either start a command (RunControl) or call
// the very function a command calls - one place for what a change does, so that the page and the terminal cannot drift apart.
// This reads the server's POST routes and fails on a function they call that no command (tools/*.ts, index.ts, film.ts) calls.

const root = join(import.meta.dir, '..', '..')
const read = (file: string) => readFileSync(join(root, file), 'utf8')

// what a POST route may call that changes nothing of a project by itself: the request, the answer, starting a command, estimates
const NOT_A_CHANGE = new Set([
    'body',
    'json',
    'refused',
    'invalid',
    'busy',
    'missing',
    'notFound',
    'started',
    'urlsOfChoice',
    'estimateClips',
    // the command itself with --dry-run: it reads only
    'dryRun',
    'replaceDryRun',
    'estimatePictures',
    'readPictureJobs',
    'picturesFile',
    'atLook',
    // the plan run started with a change of the direction (#830): the command does the same after --take
    'rebuilt',
    // an upload checked and kept for the run that puts it in (lib/editor/upload.ts), and what is read to refuse one
    'checkUploadSize',
    'takePictureUpload',
    'readReferences',
])

/** The functions the POST part of the project routes and of the library's calls. */
function postCalls(): string[] {
    const server = read('lib/editor/server.ts')
    const from = server.indexOf('const started = (run: unknown) => json({run})')
    const to = server.indexOf('const libraryApi', from)
    expect(from).toBeGreaterThan(0)
    expect(to).toBeGreaterThan(from)
    // and the library's POST routes (#835): from its change on, up to the handler of all requests
    const library = server.slice(server.indexOf("if (rest[0] === 'change')", to), server.indexOf('return async (request: Request)', to))
    expect(library).toContain('changeLibrary')
    const post = server.slice(from, to) + library
    // runs.start / runs.stop start and stop a command: the command is what changes the project
    return [...new Set([...post.matchAll(/(?<![.\w])([a-z][A-Za-z]+)\(/g)].map(m => m[1]!))].filter(
        name =>
            !NOT_A_CHANGE.has(name) && !['if', 'return', 'await', 'catch', 'for', 'switch', 'join', 'mkdtempSync', 'writeFileSync', 'tmpdir'].includes(name),
    )
}

describe('CLI first', () => {
    test('every function a workspace route changes a project with is one a command calls too', () => {
        const commands = [
            ...readdirSync(join(root, 'tools'))
                .filter(f => f.endsWith('.ts'))
                .map(f => read(`tools/${f}`)),
            read('index.ts'),
            read('film.ts'),
        ].join('\n')
        const calls = postCalls()
        // the reading of the routes still finds them
        for (const name of [
            'writeCast',
            'writeLook',
            'writeStory',
            'writeSinging',
            'writeTiming',
            'pickVersion',
            'writeOverride',
            'writeCastingEntry',
            'writeConfig',
        ])
            expect(calls).toContain(name)
        const pageOnly = calls.filter(name => !new RegExp(`\\b${name}\\(`).test(commands))
        expect(pageOnly).toEqual([])
    })
    // #830: a change of the direction and the build of the prompts are one request - a page never takes, restores, drops or edits
    // and then starts the plan run itself: a failure or a closed page in between would leave the prompts as they were
    test('no page starts the plan run itself after changing the direction', () => {
        const changes = ['saveDirection', 'saveDirectionEdits', 'takeDirection', 'dropDirection', 'restoreDirection', 'shotPeople']
        const files: string[] = []
        const walk = (dir: string) => {
            for (const entry of readdirSync(join(root, dir), {withFileTypes: true}))
                if (entry.isDirectory()) walk(`${dir}/${entry.name}`)
                else if (/\.(vue|ts)$/.test(entry.name)) files.push(`${dir}/${entry.name}`)
        }
        walk('client/src')
        const found = files.flatMap(file =>
            read(file)
                // one action: a declaration of the page's script
                .split(/\n(?=const |function |async function )/)
                .filter(action => changes.some(name => action.includes(`api.${name}(`)) && action.includes("start({type: 'plan'"))
                .map(action => `${file}: ${action.split('\n')[0]}`),
        )
        expect(found).toEqual([])
    })
})
