import {expect, test} from 'bun:test'
import {mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {clientStatic} from './static.ts'
import {editorHandler} from './server.ts'

async function fixture(check: (dir: string, root: string) => Promise<void>) {
    const root = mkdtempSync(join(tmpdir(), 'client-static-')),
        dir = join(root, 'public')
    mkdirSync(join(dir, 'assets'), {recursive: true})
    writeFileSync(join(dir, 'index.html'), '<title>Vue fixture</title>')
    writeFileSync(join(dir, 'assets/app-12345678.js'), 'export {}')
    writeFileSync(join(dir, 'assets/app-12345678.js.map'), 'private map')
    writeFileSync(join(dir, 'icon.svg'), '<svg/>')
    writeFileSync(join(root, 'secret.js'), 'secret')
    try {
        await check(dir, root)
    } finally {
        rmSync(root, {recursive: true, force: true})
    }
}

test('HTML and assets have correct MIME, caching and HEAD behavior', () =>
    fixture(async dir => {
        const serve = clientStatic(dir)
        const html = await serve(new Request('http://localhost/'), 'index.html')
        expect(html.status).toBe(200)
        expect(html.headers.get('cache-control')).toBe('no-cache')
        const js = await serve(new Request('http://localhost/workspace-assets/assets/app-12345678.js'), 'assets/app-12345678.js')
        expect(js.headers.get('content-type')).toContain('javascript')
        expect(js.headers.get('cache-control')).toContain('immutable')
        const head = await serve(new Request('http://localhost/', {method: 'HEAD'}), 'index.html')
        expect(head.headers.get('content-type')).toBe(html.headers.get('content-type'))
        expect(await head.text()).toBe('')
        expect((await serve(new Request('http://localhost/'), 'icon.svg')).headers.get('cache-control')).toBe('no-cache')
    }))

test('missing files, private metadata, traversal and linked directories are not served', () =>
    fixture(async (dir, root) => {
        symlinkSync(root, join(dir, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
        const serve = clientStatic(dir)
        for (const path of [
            '../secret.js',
            '..\\secret.js',
            '/secret.js',
            'C:/secret.js',
            '.vite/manifest.json',
            'assets/app-12345678.js.map',
            'missing.js',
            'linked/secret.js',
            'a\0.js',
        ]) {
            expect((await serve(new Request('http://localhost/'), path)).status).toBe(404)
        }
    }))

test('the built page cannot swallow API errors or bypass host/origin checks', () =>
    fixture(async dir => {
        const handler = editorHandler(undefined, {publicDir: dir})
        expect(await (await handler(new Request('http://localhost/library'))).text()).toContain('Vue fixture')
        expect((await handler(new Request('http://localhost/api/nothing'))).status).toBe(404)
        expect((await handler(new Request('http://localhost/workspace-assets/missing.js'))).status).toBe(404)
        expect((await handler(new Request('http://evil.example/workspace-assets/assets/app-12345678.js'))).status).toBe(403)
        expect((await handler(new Request('http://localhost/api/run', {method: 'POST', headers: {origin: 'http://evil.example'}}))).status).toBe(403)
        expect((await handler(new Request('http://localhost/workspace-assets/assets/app-12345678.js', {method: 'POST'}))).status).toBe(404)
    }))

test('missing build gives actionable 503 for UI but leaves API routing intact', () =>
    fixture(async (dir, root) => {
        const handler = editorHandler(undefined, {publicDir: join(root, 'missing')})
        const response = await handler(new Request('http://localhost/'))
        expect(response.status).toBe(503)
        expect(await response.text()).toContain('bun run client:build')
        expect((await handler(new Request('http://localhost/api/nothing'))).status).toBe(404)
    }))
