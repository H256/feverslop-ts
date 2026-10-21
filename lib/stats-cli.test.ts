import {expect, test} from 'bun:test';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

function fixture(run: (call: (...args: string[]) => {exitCode: number, stdout: {toString(): string}, stderr: {toString(): string}}) => void) {
    const dir = mkdtempSync(join(tmpdir(), 'stats-cli-'))
    const file = join(dir, 'timings.jsonl')
    writeFileSync(file, [
        {at: '2026-10-20T00:00:00Z', project: 'demo', kind: 'clip', name: 'h3', seconds: 40, variant: 'v1', gpu: 'A', pixels: 1e6, frames: 121},
        {at: '2026-10-20T00:00:00Z', project: 'demo', kind: 'llm', name: 'model', seconds: 2, promptTokens: 100, completionTokens: 20},
    ].map(t => JSON.stringify(t)).join('\n'))
    try {
        run((...args) => Bun.spawnSync(['bun', join(import.meta.dir, '../tools/stats.ts'), ...args], {
            cwd: dir, stdout: 'pipe', stderr: 'pipe', env: {...process.env, NO_COLOR: '1', FEVERSLOP_TIMINGS: file, FEVERSLOP_SETTINGS: join(dir, 'settings.json')},
        }))
    } finally { rmSync(dir, {recursive: true, force: true}) }
}

test('JSON stats is a single document and all tables obey kind/project/since filters', () => fixture(call => {
    const result = call('--json', '--quiet', '--kind=clip', '--project=demo', '--since=2026-10-19')
    expect(result.exitCode).toBe(0)
    const report = JSON.parse(result.stdout.toString())
    expect(report.summary.measurements).toBe(1)
    expect(report.llm).toEqual([])
    expect(report.tokens.model).toEqual([])
    expect(result.stderr.toString()).toBe('')
}))

test('invalid stats options fail clearly, including JSON errors', () => fixture(call => {
    for (const option of ['--kind=invalid', '--top=0', '--top=2.5', '--sort=nope', '--by=toString', '--since=2026-02-30', '--baseline=missing']) {
        const result = call('--json', option)
        expect(result.exitCode).toBe(1)
        expect(result.stdout.toString()).toBe('')
        expect(JSON.parse(result.stderr.toString()).error).toContain(option.split('=')[0])
    }
}))

test('compact stats hides token tables; details restores them; empty selection remains valid JSON', () => fixture(call => {
    const compact = call().stdout.toString()
    expect(compact).toContain('OVERVIEW')
    expect(compact).toContain('p90 warm')
    expect(compact).not.toContain('Tokens per step')
    expect(call('--details').stdout.toString()).toContain('Tokens per step')
    const empty = call('--project=missing', '--json')
    expect(empty.exitCode).toBe(0)
    expect(JSON.parse(empty.stdout.toString()).summary.measurements).toBe(0)
}))
