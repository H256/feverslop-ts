import {existsSync, realpathSync, statSync} from 'node:fs';
import {extname, isAbsolute, join, relative, resolve, sep} from 'node:path';

export const CLIENT_PUBLIC = join(import.meta.dir, 'public')
export type EditorOptions = {publicDir?: string}

const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
    '.woff': 'font/woff', '.woff2': 'font/woff2',
}
const missing = () => new Response('Not found', {status: 404})
const buildMissing = () => new Response('Workspace client is not built. Run: bun run client:build', {status: 503, headers: {'Cache-Control': 'no-cache'}})

/** The caller decodes once. Never serve metadata, maps, paths outside public, or non-build file types. */
export function clientStatic(publicDir = CLIENT_PUBLIC) {
    return async (request: Request, path: string): Promise<Response> => {
        if (request.method !== 'GET' && request.method !== 'HEAD') return missing()
        if (!path || /[\\:\0]/.test(path) || path.startsWith('/') || path.split('/').some(part => !part || part.startsWith('.'))) return missing()
        const type = MIME[extname(path)]
        if (!type || (extname(path) === '.html' && path !== 'index.html')) return missing()
        let file: string
        try {
            const root = realpathSync(publicDir)
            file = realpathSync(resolve(root, path))
            const within = relative(root, file)
            if (!within || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within) || !statSync(file).isFile()) return missing()
        } catch {
            return path === 'index.html' ? buildMissing() : missing()
        }
        const headers = {
            'Content-Type': type,
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': path.startsWith('assets/') && /-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache',
        }
        return new Response(request.method === 'HEAD' ? null : Bun.file(file), {headers})
    }
}

export function requireClientBuild(publicDir = CLIENT_PUBLIC) {
    if (!existsSync(join(publicDir, 'index.html'))) throw new Error('Workspace client is not built. Run: bun run client:build')
}
