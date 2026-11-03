import {expect} from 'bun:test';
import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

export const source = resolve(import.meta.dir, '../..')

// A separate process is essential: importing the handler would reuse the test
// runner's cwd, settings cache and already-resolved pipeline modules.
export async function sandbox(check: (cwd: string, env: Record<string, string>) => Promise<void>) {
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
