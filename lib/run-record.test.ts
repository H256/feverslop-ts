import {describe, expect, test} from "bun:test";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {commandLine, lastRun, type RunRecord, runState} from "./run-record.ts";

const run = (more: Partial<RunRecord> = {}): RunRecord => ({command: 'bun index.ts x', pid: 1, startedAt: '2026-10-31T00:00:00.000Z', ...more})
const ended = {endedAt: '2026-10-31T01:00:00.000Z', exitCode: 0}

describe('runState', () => {
    test('a live but unrelated PID does not keep a crashed run running (#665)', () => {
        expect(runState(run({pid: process.pid}))).toBe('stopped')
        expect(runState({...run({pid: process.pid}), identity: 'another-process-start'})).toBe('stopped')
    })
    test('no end: running while its process lives, stopped when it is gone', () => {
        expect(runState(run(), () => true)).toBe('running')
        expect(runState(run(), () => false)).toBe('stopped')
    })
    test('an end with failures or an error is failed, even with exit code 0', () => {
        expect(runState(run({...ended, failures: ['clip slot-001: x']}))).toBe('failed')
        expect(runState(run({...ended, exitCode: 1, error: 'x'}))).toBe('failed')
    })
    test('an end without a reason: exit code 0 finished, any other stopped', () => {
        expect(runState(run(ended))).toBe('finished')
        expect(runState(run({...ended, exitCode: 130}))).toBe('stopped')
    })
})

describe('commandLine', () => {
    test('leaves out the key and quotes what has spaces', () => {
        expect(commandLine(['bun', 'index.ts', 'x', '--llm-key=secret', '--comfy=a b'])).toBe('bun index.ts x --llm-key=… "--comfy=a b"')
    })
    test('leaves out a key given as its own argument', () => {
        expect(commandLine(['bun', 'index.ts', 'x', '--llm-key', 'secret', '--again'])).toBe('bun index.ts x --llm-key … --again')
    })
})

test('a project without a record has no last run', () => {
    expect(lastRun(mkdtempSync(join(tmpdir(), 'run-')))).toBeUndefined()
})

test('review stop is recorded as stopped without a Done footer (#642)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'review-stop-'))
    const script = `
        import {mock} from 'bun:test';
        mock.module('@clack/prompts', () => ({select: async () => 'stop', isCancel: () => false}));
        const {reviewed} = await import(${JSON.stringify(join(import.meta.dir, 'review.ts'))});
        const {cli} = await import(${JSON.stringify(join(import.meta.dir, 'cli.ts'))});
        const {startRunRecord} = await import(${JSON.stringify(join(import.meta.dir, 'run-record.ts'))});
        cli('film'); startRunRecord(${JSON.stringify(dir)}, 'review');
        await reviewed({file: 'project.json', data: {}, generated: new Set(['story']), invalidate() {}, async save() {}}, true, 'story', async () => 'story', () => {});
    `
    const child = Bun.spawn(['bun', '-e', script], {stdout: 'pipe', stderr: 'pipe'})
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    expect(code).toBe(0)
    expect(out + err).not.toContain('Done')
    expect(runState(lastRun(dir)!)).toBe('stopped')
})

test('an ended run says how, a killed one leaves no end', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'run-'))
    const script = (end: string) => `import {noteRunFailures, startRunRecord} from ${JSON.stringify(join(import.meta.dir, 'run-record.ts'))};
        startRunRecord(${JSON.stringify(dir)}, 'bun index.ts x'); noteRunFailures(['clip slot-002: x']); ${end}`
    await Bun.spawn(['bun', '-e', script('process.exit(1)')]).exited
    expect(lastRun(dir)).toMatchObject({command: 'bun index.ts x', exitCode: 1, failures: ['clip slot-002: x']})

    const killed = Bun.spawn(['bun', '-e', script('console.log("up"); setInterval(() => {}, 1000)')], {stdout: 'pipe'})
    await killed.stdout.getReader().read()
    killed.kill(9)
    await killed.exited
    expect(lastRun(dir)?.endedAt).toBeUndefined()
    expect(runState(lastRun(dir)!)).toBe('stopped')
})
