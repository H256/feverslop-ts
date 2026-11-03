import {describe, expect, test} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";

// CLI first: whatever the workspace changes, a command changes the same way. The pages either start a command (RunControl) or call
// the very function a command calls - one place for what a change does, so that the page and the terminal cannot drift apart.
// This reads the server's POST routes and fails on a function they call that no command (tools/*.ts, index.ts, film.ts) calls.

const root = join(import.meta.dir, '..', '..')
const read = (file: string) => readFileSync(join(root, file), 'utf8')

// what a POST route may call that changes nothing of a project by itself: the request, the answer, starting a command, estimates
const NOT_A_CHANGE = new Set(['body', 'json', 'refused', 'notFound', 'started', 'urlsOfChoice', 'estimateClips', 'estimatePictures', 'readPictureJobs', 'picturesFile', 'atLook'])

/** The functions the POST part of the project routes calls. */
function postCalls(): string[] {
    const server = read('lib/editor/server.ts')
    const from = server.indexOf("const started = (run: unknown) => json({run})")
    const to = server.indexOf('const libraryApi', from)
    expect(from).toBeGreaterThan(0)
    expect(to).toBeGreaterThan(from)
    const post = server.slice(from, to)
    // runs.start / runs.stop start and stop a command: the command is what changes the project
    return [...new Set([...post.matchAll(/(?<![.\w])([a-z][A-Za-z]+)\(/g)].map(m => m[1]!))]
        .filter(name => !NOT_A_CHANGE.has(name) && !['if', 'return', 'await', 'catch', 'for', 'switch', 'join', 'mkdtempSync', 'writeFileSync', 'tmpdir'].includes(name))
}

describe('CLI first', () => {
    test('every function a workspace route changes a project with is one a command calls too', () => {
        const commands = [...readdirSync(join(root, 'tools')).filter(f => f.endsWith('.ts')).map(f => read(`tools/${f}`)), read('index.ts'), read('film.ts')].join('\n')
        const calls = postCalls()
        // the reading of the routes still finds them
        for (const name of ['writeCast', 'writeLook', 'writeStory', 'writeSinging', 'writeTiming', 'pickVersion', 'writeOverride', 'writeCastingEntry', 'writeConfig']) expect(calls).toContain(name)
        const pageOnly = calls.filter(name => !new RegExp(`\\b${name}\\(`).test(commands))
        expect(pageOnly).toEqual([])
    })
})
