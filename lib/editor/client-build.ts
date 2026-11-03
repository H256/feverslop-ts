import {cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {basename, dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';

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

// What a build is made from: the client's sources and settings, the contracts it shares with the server, and the release
// number it shows. The installed build keeps the stamp of what it was made from; another stamp means another client.
const CLIENT_SOURCES = ['index.html', 'package.json', 'bun.lock', 'vite.config.ts', 'tsconfig.json', 'src', 'public']
const STAMP = '.build-stamp'

function filesIn(path: string): string[] {
    if (!existsSync(path)) return []
    if (!lstatSync(path).isDirectory()) return [path]
    return readdirSync(path).sort().flatMap(entry => filesIn(join(path, entry)))
}

/** One hash over the client's sources, `shared/` and the repository's package.json. Tests and build output do not count. */
export function clientSourceStamp(root: string) {
    const hash = createHash('sha256')
    const files = [...CLIENT_SOURCES.map(name => join(root, 'client', name)), join(root, 'shared'), join(root, 'package.json')].flatMap(filesIn)
    for (const file of files) hash.update(`${relative(root, file).replaceAll(sep, '/')}\n`).update(readFileSync(file)).update('\n')
    return hash.digest('hex')
}

export const installedStamp = (publicDir: string) => existsSync(join(publicDir, STAMP)) ? readFileSync(join(publicDir, STAMP), 'utf8').trim() : undefined

/** current: the installed build is made from these sources. stale or missing: build it. prebuilt: a build without its sources, used as it is. */
export function clientBuildState(root: string, publicDir: string): 'current' | 'stale' | 'missing' | 'prebuilt' {
    const built = existsSync(join(publicDir, 'index.html'))
    if (!existsSync(join(root, 'client', 'src'))) return built ? 'prebuilt' : 'missing'
    if (!built) return 'missing'
    return installedStamp(publicDir) === clientSourceStamp(root) ? 'current' : 'stale'
}

/**
 * Install the client's packages as its lockfile says, build it, install the build and stamp it. Output goes to this terminal. The
 * packages are installed before every build, not only when node_modules is missing: a pull that changed the lockfile would otherwise
 * be built with the packages there were before. With nothing to change the install takes a moment.
 */
export function buildClient(root: string, publicDir: string, spawn: typeof Bun.spawnSync = Bun.spawnSync) {
    const client = join(root, 'client')
    const run = (args: string[], what: string, script: string) => {
        const result = spawn([process.execPath, ...args], {cwd: client, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit'})
        if (result.exitCode !== 0) throw new Error(`${what} failed. Run it on its own to see why: bun run ${script}`)
    }
    const stamp = clientSourceStamp(root)
    run(['install', '--frozen-lockfile'], 'Installing the client packages', 'client:install')
    run(['run', 'build'], 'Building the client', 'client:build')
    installClientBuild(join(client, 'dist'), publicDir)
    writeFileSync(join(publicDir, STAMP), stamp)
}
