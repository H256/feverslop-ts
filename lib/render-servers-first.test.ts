import {expect, test} from 'bun:test'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {loadProjectConfig} from './config.ts'
import {Renderer} from './render.ts'

// #816: a run that puts a clip or a picture away before rendering it again asks the servers first - with none reachable it
// fails there, and nothing of the project was moved.
test('serversFirst fails when no ComfyUI server answers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'servers-first-'))
    try {
        // a port that was free a moment ago: the connection is refused
        const gone = Bun.serve({port: 0, fetch: () => new Response('')})
        const url = `http://127.0.0.1:${gone.port}`
        await gone.stop(true)
        using renderer = new Renderer('servers-first', dir, await loadProjectConfig(dir), [{name: 'gone', url}])
        const error = await renderer.serversFirst().catch((e: unknown) => e)
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toContain('No ComfyUI server reachable')
        expect((error as Error).message).toContain('bun run setup comfy')
    } finally {
        rmSync(dir, {recursive: true, force: true})
    }
})
