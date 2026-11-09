import {expect, test} from 'bun:test'
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {RunControl} from './runs.ts'
import type {EditorTarget} from './project.ts'

test('Stop refuses a legacy lock whose PID cannot be authenticated (#647)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stop-identity-'))
    // Stub the signal so this regression cannot terminate the test runner.
    const original = process.kill
    const signals: (number | string | undefined)[] = []
    process.kill = ((_pid: number, signal?: number | string) => {
        signals.push(signal)
        return true
    }) as typeof process.kill
    try {
        writeFileSync(join(dir, '.lock'), String(process.pid))
        expect(() => new RunControl().stop({dir, id: 'test', kind: 'music'} as EditorTarget)).toThrow('identity')
        expect(signals.every(signal => signal === 0)).toBe(true)
    } finally {
        process.kill = original
        rmSync(dir, {recursive: true, force: true})
    }
})
