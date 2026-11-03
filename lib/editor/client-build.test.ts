import {expect, test} from 'bun:test';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {installClientBuild} from './client-build.ts';

function fixture(check: (dist: string, target: string, root: string) => void) {
    const root = mkdtempSync(join(tmpdir(), 'client-build-'))
    const dist = join(root, 'dist'), target = join(root, 'public')
    mkdirSync(join(dist, '.vite'), {recursive: true})
    mkdirSync(join(dist, 'assets'))
    mkdirSync(target)
    writeFileSync(join(target, 'index.html'), 'previous')
    writeFileSync(join(target, 'old.js'), 'previous chunk')
    writeFileSync(join(dist, 'index.html'), '<script type="module" src="/workspace-assets/assets/app-12345678.js"></script>')
    writeFileSync(join(dist, 'assets/app-12345678.js'), 'export {}')
    writeFileSync(join(dist, '.vite/manifest.json'), JSON.stringify({'index.html': {file: 'assets/app-12345678.js', isEntry: true}}))
    try { check(dist, target, root) } finally { rmSync(root, {recursive: true, force: true}) }
}

test('installs the complete validated build and removes obsolete files', () => fixture((dist, target, root) => {
    installClientBuild(dist, target)
    expect(readFileSync(join(target, 'index.html'), 'utf8')).toContain('/workspace-assets/assets/')
    expect(readFileSync(join(target, 'assets/app-12345678.js'), 'utf8')).toBe('export {}')
    expect(existsSync(join(target, 'old.js'))).toBe(false)
    expect(readdirSync(root).sort()).toEqual(['dist', 'public'])
}))

test('missing or escaped manifest dependencies preserve the prior build', () => {
    for (const entry of [{file: 'assets/missing.js', isEntry: true}, {file: '../outside.js', isEntry: true},
        {file: 'assets/app-12345678.js', isEntry: true, imports: ['absent']},
        {file: 'assets/app-12345678.js', isEntry: true, css: ['assets/missing.css']}]) {
        fixture((dist, target) => {
            writeFileSync(join(dist, '.vite/manifest.json'), JSON.stringify({'index.html': entry}))
            expect(() => installClientBuild(dist, target)).toThrow()
            expect(readFileSync(join(target, 'index.html'), 'utf8')).toBe('previous')
            expect(readFileSync(join(target, 'old.js'), 'utf8')).toBe('previous chunk')
        })
    }
})

test('rejects a missing entry document and inconsistent HTML', () => fixture((dist, target) => {
    writeFileSync(join(dist, 'index.html'), '<script src="/workspace-assets/assets/missing.js"></script>')
    expect(() => installClientBuild(dist, target)).toThrow()
    rmSync(join(dist, 'index.html'))
    expect(() => installClientBuild(dist, target)).toThrow()
    expect(readFileSync(join(target, 'index.html'), 'utf8')).toBe('previous')
}))

test('rejects linked directories and overlapping source/destination before replacing files', () => fixture((dist, target, root) => {
    const outside = join(root, 'outside')
    mkdirSync(outside)
    symlinkSync(outside, join(dist, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    expect(() => installClientBuild(dist, target)).toThrow()
    expect(() => installClientBuild(dist, dist)).toThrow()
    expect(() => installClientBuild(dist, join(dist, 'public'))).toThrow()
    expect(readFileSync(join(target, 'index.html'), 'utf8')).toBe('previous')
}))

test('restores the previous build when the final directory move fails', () => fixture((dist, target, root) => {
    expect(() => installClientBuild(dist, target, (from, to) => {
        if (String(from).includes('.public-staging-') && to === target) throw new Error('simulated sharing violation')
        renameSync(from, to)
    })).toThrow('simulated sharing violation')
    expect(readFileSync(join(target, 'index.html'), 'utf8')).toBe('previous')
    expect(readFileSync(join(target, 'old.js'), 'utf8')).toBe('previous chunk')
    expect(readdirSync(root).sort()).toEqual(['dist', 'public'])
}))
