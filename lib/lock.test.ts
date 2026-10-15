import {describe, expect, test} from "bun:test";
import {mkdtempSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {lockProject} from "./lock.ts";

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
