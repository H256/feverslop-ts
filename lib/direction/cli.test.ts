import {test, expect, afterEach} from 'bun:test';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
const folders: string[] = [];
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, {recursive: true, force: true}); });

test('CLI JSON includes review state and round-trips rules; orphan flags fail', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'direction-cli-')); folders.push(cwd);
    const dir = join(cwd, 'projects', 'demo'); mkdirSync(dir, {recursive: true});
    writeFileSync(join(dir, 'project.json'), JSON.stringify({cast: {characters: [], locations: []}}));
    const script = resolve(import.meta.dir, '../../tools/direction.ts');
    const run = async (...args: string[]) => {
        const child = Bun.spawn([process.execPath, script, 'demo', ...args], {cwd, stdout: 'pipe', stderr: 'pipe'});
        const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        return {out, err, code};
    };
    const added = await run('--add=Move gently', '--json'); expect(added.code).toBe(0);
    const view = JSON.parse(added.out);
    expect(view.rules[0].text).toBe('Move gently');
    expect(view.pending).toBe(true); expect(view.shots).toEqual([]);
    const exported = join(cwd, 'direction.json'); writeFileSync(exported, added.out);
    expect((await run(`--set=${exported}`, '--json')).code).toBe(0);
    expect((await run('--text=Lost instruction')).code).not.toBe(0);
    expect((await run('--scope=shot:missing')).code).not.toBe(0);
});
