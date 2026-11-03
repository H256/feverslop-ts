import {cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync} from 'node:fs';
import {basename, dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {randomUUID} from 'node:crypto';

function inside(root: string, file: string) {
    const path = relative(root, file)
    return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

/** Reject links even when they currently point inside: only ordinary build files are copied. */
function ordinaryTree(dir: string) {
    if (lstatSync(dir).isSymbolicLink() || !lstatSync(dir).isDirectory()) throw new Error(`Not a build directory: ${dir}`)
    for (const entry of readdirSync(dir)) {
        const file = join(dir, entry), stat = lstatSync(file)
        if (stat.isSymbolicLink()) throw new Error(`Linked build file: ${file}`)
        if (stat.isDirectory()) ordinaryTree(file)
        else if (!stat.isFile()) throw new Error(`Not an ordinary build file: ${file}`)
    }
}

/** Validate both Vite's dependency graph and HTML asset references before touching the installed build. */
export function validateClientBuild(source: string) {
    const root = resolve(source)
    ordinaryTree(root)
    const file = (name: unknown) => {
        if (typeof name !== 'string' || !name || /[\\:\0?#]/.test(name) || name.startsWith('/') || name.split('/').some(p => p === '..' || p === '.')) throw new Error(`Invalid build path: ${String(name)}`)
        const path = resolve(root, name)
        if (!inside(root, path) || !existsSync(path) || !lstatSync(path).isFile()) throw new Error(`Missing build file: ${name}`)
        return path
    }
    const html = readFileSync(file('index.html'), 'utf8')
    const manifest: unknown = JSON.parse(readFileSync(file('.vite/manifest.json'), 'utf8'))
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Invalid Vite manifest')
    const entries = manifest as Record<string, {file?: unknown, isEntry?: boolean, imports?: string[], dynamicImports?: string[], css?: string[], assets?: string[]}>
    if (!entries['index.html']?.isEntry) throw new Error('Vite manifest has no index.html entry')
    for (const entry of Object.values(entries)) {
        file(entry.file)
        for (const asset of [...(entry.css ?? []), ...(entry.assets ?? [])]) file(asset)
        for (const key of [...(entry.imports ?? []), ...(entry.dynamicImports ?? [])]) {
            if (!Object.hasOwn(entries, key)) throw new Error(`Missing manifest dependency: ${key}`)
        }
    }
    let scripts = 0
    for (const match of html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)) {
        const url = match[1]!
        if (!url.startsWith('/workspace-assets/')) throw new Error(`Non-local entry asset: ${url}`)
        file(url.slice('/workspace-assets/'.length))
        if (url.endsWith('.js')) scripts++
    }
    if (!scripts) throw new Error('Client HTML has no bundled script')
}

/** Install while the editor is stopped. A failed build/copy leaves the previous public directory intact. */
export function installClientBuild(source: string, destination: string, move: typeof renameSync = renameSync) {
    const dist = resolve(source), target = resolve(destination)
    if (dist === target || inside(dist, target) || inside(target, dist) || basename(target) !== 'public') throw new Error('Build source and public destination must be separate directories')
    validateClientBuild(dist)
    if (existsSync(target)) ordinaryTree(target)
    const parent = dirname(target)
    mkdirSync(parent, {recursive: true})
    // Every recursively removed path below is an exact, locally-created sibling of this public directory.
    const staging = mkdtempSync(join(parent, '.public-staging-'))
    const backup = join(parent, `.public-backup-${randomUUID()}`)
    let backedUp = false
    try {
        cpSync(dist, staging, {recursive: true, dereference: false})
        validateClientBuild(staging)
        if (existsSync(target)) { move(target, backup); backedUp = true }
        try { move(staging, target) }
        catch (error) {
            if (backedUp) { move(backup, target); backedUp = false }
            throw error
        }
        if (backedUp) { rmSync(backup, {recursive: true, force: true}); backedUp = false }
    } finally {
        rmSync(staging, {recursive: true, force: true})
        // If restoration failed, leave the backup for recovery instead of deleting it.
    }
}
