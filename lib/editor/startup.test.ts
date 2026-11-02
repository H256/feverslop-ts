import {expect, test} from 'bun:test';
import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

const source = resolve(import.meta.dir, '../..')

// A separate process is essential: importing the handler would reuse the test
// runner's cwd, settings cache and already-resolved pipeline modules.
async function sandbox(check: (cwd: string, env: Record<string, string>) => Promise<void>) {
    const cwd = mkdtempSync(join(tmpdir(), 'workspace-startup-'))
    const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) =>
        value !== undefined && !/^(FEVERSLOP_|COMFY$|NODE_OPTIONS$|BUN_OPTIONS$)/i.test(key))) as Record<string, string>
    env.FEVERSLOP_SETTINGS = join(cwd, 'missing-settings.json')
    env.NO_COLOR = '1'
    try {
        await check(cwd, env)
        expect(existsSync(env.FEVERSLOP_SETTINGS)).toBe(false)
        for (const folder of ['projects', 'films', 'library']) expect(existsSync(join(cwd, folder))).toBe(false)
    } finally {
        rmSync(cwd, {recursive: true, force: true})
    }
}

test('CLI help and missing-project errors work with no machine settings or projects', async () => {
    await sandbox(async (cwd, env) => {
        for (const entry of ['index.ts', 'film.ts', 'editor.ts']) {
            const result = Bun.spawnSync([process.execPath, join(source, entry), '--help'], {
                cwd, env, stdout: 'pipe', stderr: 'pipe', timeout: 10_000,
            })
            expect({entry, code: result.exitCode, stderr: result.stderr.toString()}).toEqual({entry, code: 0, stderr: ''})
            expect(result.stdout.toString()).toContain('Usage:')
        }
        for (const args of [['missing'], ['missing', '--film']]) {
            const result = Bun.spawnSync([process.execPath, join(source, 'editor.ts'), ...args], {
                cwd, env, stdout: 'pipe', stderr: 'pipe', timeout: 10_000,
            })
            expect(result.exitCode).toBe(1)
            expect(result.stderr.toString()).toContain(args.includes('--film') ? 'No film' : 'No project')
        }
    })
}, 60_000)

test('real editor serves an empty workspace and tolerates an unavailable render server', async () => {
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
            const get = (path: string) => fetch(`${base}${path}`, {signal: AbortSignal.timeout(5_000)})
            for (const path of ['/', '/library']) {
                const response = await get(path)
                expect(response.status).toBe(200)
                expect(response.headers.get('content-type')).toContain('text/html')
                expect(await response.text()).toContain('<title>Workspace</title>')
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
