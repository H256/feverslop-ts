import {describe, expect, test} from "bun:test";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {commandLine, lastRun, type RunRecord, runState} from "./run-record.ts";

const run = (more: Partial<RunRecord> = {}): RunRecord => ({command: 'bun index.ts x', pid: 1, startedAt: '2026-10-31T00:00:00.000Z', ...more})
const ended = {endedAt: '2026-10-31T01:00:00.000Z', exitCode: 0}

describe('runState', () => {
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
})

test('a project without a record has no last run', () => {
    expect(lastRun(mkdtempSync(join(tmpdir(), 'run-')))).toBeUndefined()
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
