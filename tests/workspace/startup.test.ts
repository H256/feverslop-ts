import {expect, test} from 'bun:test';
import {join} from 'node:path';
import {sandbox, source} from './sandbox.ts';

// The real editor with its built page: bun run test:workspace builds it first.
test('real editor serves its built page over an empty workspace and tolerates an unavailable render server', async () => {
    await sandbox(async (cwd, env) => {
        // A local stand-in prevents probing the user's default GPU on port 8188.
        const unavailable = Bun.serve({hostname: '127.0.0.1', port: 0, fetch: () => new Response('offline', {status: 503})})
        env.FEVERSLOP_COMFY = unavailable.url.origin
        const reservation = Bun.serve({hostname: '127.0.0.1', port: 0, fetch: () => new Response()})
        const port = reservation.port!
        reservation.stop(true)
        const child = Bun.spawn([process.execPath, join(source, 'editor.ts'), `--port=${port}`], {
            cwd, env, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore',
        })
        let output = ''
        const stderr = new Response(child.stderr).text()
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
            // Read the advertised address, since the CLI may choose the next free port.
            const ready = (async () => {
                for await (const chunk of child.stdout) {
                    output += new TextDecoder().decode(chunk)
                    const address = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]
                    if (address) return address
                }
                throw new Error(`Editor exited before startup: ${output}\n${await stderr}`)
            })()
            const base = await Promise.race([ready, new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error(`Editor startup timed out: ${output}`)), 10_000)
            })])
            clearTimeout(timer)
            // test:workspace has just built the page: the editor takes it as it is
            expect(output).not.toContain('Build')
            const get = (path: string) => fetch(`${base}${path}`, {signal: AbortSignal.timeout(5_000)})
            for (const path of ['/', '/library']) {
                const response = await get(path)
                expect(response.status).toBe(200)
                expect(response.headers.get('content-type')).toContain('text/html')
                const html = await response.text()
                expect(html).toContain('<title>Workspace</title>')
                // the built Vue page, served by Bun, with no build started for it
                expect(html).toContain('/workspace-assets/assets/')
            }
            const projects = await get('/api/projects')
            expect(projects.status).toBe(200)
            expect(await projects.json()).toEqual({projects: []})
            const library = await get('/api/library/assets')
            expect(library.status).toBe(200)
            expect(await library.json()).toMatchObject({dir: join(cwd, 'library'), assets: []})
            const servers = await get('/api/servers')
            expect(servers.status).toBe(200)
            const data = await servers.json() as {servers: unknown[]}
            expect(data.servers).toHaveLength(1)
            expect(data.servers[0]).toMatchObject({reachable: false, running: 0, pending: 0})
            for (const path of ['/p/music/missing/', '/p/film/missing/', '/api/nothing']) {
                expect((await get(path)).status).toBe(404)
            }
        } finally {
            clearTimeout(timer)
            child.kill()
            await child.exited
            await stderr
            unavailable.stop(true)
        }
    })
}, 45_000)
