import {expect, test} from 'bun:test';
import {join} from 'node:path';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {bannerLines, fitLine} from './log.ts';

const root = join(import.meta.dir, '..')
const run = (file: string, ...args: string[]) => Bun.spawnSync(['bun', file, ...args], {cwd: root, stdout: 'pipe', stderr: 'pipe', env: {...process.env, NO_COLOR: '1'}})

test('all package CLI entry points provide help without starting work', async () => {
    const {scripts} = await Bun.file(join(root, 'package.json')).json()
    const entries = [...new Set<string>(['index.ts', ...Object.values<string>(scripts).filter(s => /^bun .*\.ts$/.test(s)).map(s => s.slice(4))])]
    for (const entry of entries) {
        const result = run(entry, '--help')
        expect({entry, code: result.exitCode, error: result.stderr.toString()}).toEqual({entry, code: 0, error: ''})
        expect(result.stdout.toString()).toContain('--quiet')
        expect(result.stdout.toString()).toContain('--debug')
    }
})

test('quiet preserves failures and prints no human stdout', () => {
    const result = run('tools/status.ts', 'nonexistent-cli-test-project', '--quiet')
    expect(result.exitCode).toBe(1)
    expect(result.stdout.toString()).toBe('')
    expect(result.stderr.toString()).toContain('No project')
})

test('JSON failures are structured on stderr with no human output', () => {
    const result = run('tools/status.ts', 'nonexistent-cli-test-project', '--json')
    expect(result.stdout.toString()).toBe('')
    expect(JSON.parse(result.stderr.toString()).error).toContain('No project')
})

test('common flags work for positional tools without turning into project IDs', () => {
    const result = run('tools/inspect.ts', '--verbose', '--debug', 'nonexistent-cli-test-project')
    expect(result.exitCode).toBe(1)
    expect(result.stderr.toString()).toContain('No project "nonexistent-cli-test-project"')
})

test('inspect emits a single JSON document, including in quiet mode', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-inspect-'))
    try {
        const clips = join(dir, 'projects', 'demo', 'output', 'clips')
        mkdirSync(clips, {recursive: true})
        writeFileSync(join(clips, 'slot-001.json'), JSON.stringify({id: 'slot-001', beatId: 'b1', prompt: 'A scene', assets: {pictures: [], audio: []}}))
        const result = Bun.spawnSync(['bun', join(root, 'tools/inspect.ts'), 'demo', 'slot-001', '--json', '--quiet'], {cwd: dir, stdout: 'pipe', stderr: 'pipe'})
        expect(result.exitCode).toBe(0)
        expect(JSON.parse(result.stdout.toString())).toMatchObject({project: 'demo', clip: {id: 'slot-001'}, render: {state: 'missing'}})
    } finally { rmSync(dir, {recursive: true, force: true}) }
})

test('banner and truncation fit narrow, wide and Unicode terminals', () => {
    for (const width of [1, 20, 40, 60, 80, 120]) {
        expect(bannerLines(width).every(line => Bun.stringWidth(line) <= width)).toBe(true)
        expect(Bun.stringWidth(fitLine('render 中文 🎬 '.repeat(10), width))).toBeLessThanOrEqual(width)
    }
    expect(bannerLines(120).length).toBeGreaterThan(5)
    expect(bannerLines(20)[0]).toBe('FEVERSLOP')
})

test('quiet keeps prompt instructions and diagnostics; cancellation has no success footer', () => {
    for (const quiet of [false, true]) {
    const child = Bun.spawnSync(['bun', '-e', `
        import {cli} from ${JSON.stringify(join(import.meta.dir, 'cli.ts'))}
        import {log} from ${JSON.stringify(join(import.meta.dir, 'log.ts'))}
        Bun.argv.splice(0, Bun.argv.length, 'bun', 'test.ts', ...${JSON.stringify(quiet ? ['--quiet'] : [])})
        cli('init')
        log.prompt('Type the lyrics; end with two empty lines')
        log.error('compiler diagnostic')
        log.cancel('No project selected')
    `], {stdout: 'pipe', stderr: 'pipe'})
    expect(child.exitCode).toBe(0)
    if (quiet) expect(child.stdout.toString()).toBe('')
    expect(child.stdout.toString()).not.toContain('Done')
    expect(child.stderr.toString()).toContain('end with two empty lines')
    expect(child.stderr.toString()).toContain('compiler diagnostic')
    expect(child.stderr.toString()).not.toContain('Done')
    }
})

test('nonterminal init failure remains actionable under quiet', () => {
    for (const entry of ['tools/init.ts', 'tools/film-init.ts']) {
        const result = run(entry, '--quiet')
        expect(result.exitCode).toBe(1)
        expect(result.stderr.toString()).toContain('No terminal')
    }
})
