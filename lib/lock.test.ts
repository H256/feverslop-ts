import {describe, expect, test} from "bun:test";
import {mkdtempSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {lockHolder, lockProject, processAlive} from "./lock.ts";

test('invalid lock PIDs are never live holders (#641)', () => {
    for (const value of ['', '0', '-1', '1.5', 'garbage']) {
        const dir = mkdtempSync(join(tmpdir(), 'invalid-lock-'))
        writeFileSync(join(dir, '.lock'), value)
        expect(lockHolder(dir)).toBeUndefined()
        lockProject(dir, 'invalid lock')()
    }
    expect(processAlive(0)).toBe(false)
    expect(processAlive(-1)).toBe(false)
})

test('a structured lock with a reused PID is not a live holder (#647)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'identity-lock-'))
    writeFileSync(join(dir, '.lock'), JSON.stringify({pid: process.pid, identity: 'another-process-start'}))
    expect(lockHolder(dir)).toBeUndefined()
    lockProject(dir, 'stale identity')()
})

describe('lockProject', () => {
    test('a second lock on the same project is refused until the first is released', () => {
        const dir = mkdtempSync(join(tmpdir(), 'lock-'))
        writeFileSync(join(dir, '.lock'), String(process.ppid))
        expect(() => lockProject(dir, 'project x')).toThrow('another run')
    })
    test('the lock of a process that is gone is taken over', () => {
        const dir = mkdtempSync(join(tmpdir(), 'lock-'))
        writeFileSync(join(dir, '.lock'), '2147483646')
        const release = lockProject(dir, 'project x')
        expect(() => lockProject(dir, 'project x')).not.toThrow()   // our own pid: same run
        release()
    })
})
