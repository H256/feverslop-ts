import {expect, test} from 'bun:test';
import {join} from 'node:path';
import {sandbox, source} from '../../tests/workspace/sandbox.ts';

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
