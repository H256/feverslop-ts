import {expect, test} from 'bun:test'
import {existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pruneRunLogs} from './log-retention.ts'

test('pruneRunLogs keeps the newest logs and ignores other files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'run-logs-'))
    try {
        mkdirSync(join(dir, 'nested'))
        for (const [name, stamp] of [
            ['oldest.log', 1],
            ['middle.log', 2],
            ['newest.log', 3],
        ] as const) {
            const file = join(dir, name)
            writeFileSync(file, name)
            utimesSync(file, new Date(stamp * 1000), new Date(stamp * 1000))
        }
        writeFileSync(join(dir, 'notes.txt'), 'keep')
        writeFileSync(join(dir, 'nested', 'nested.log'), 'keep')

        expect(pruneRunLogs(dir, 2)).toBe(1)
        expect(existsSync(join(dir, 'oldest.log'))).toBe(false)
        expect(existsSync(join(dir, 'middle.log'))).toBe(true)
        expect(existsSync(join(dir, 'newest.log'))).toBe(true)
        expect(existsSync(join(dir, 'notes.txt'))).toBe(true)
        expect(existsSync(join(dir, 'nested', 'nested.log'))).toBe(true)
    } finally {
        rmSync(dir, {recursive: true, force: true})
    }
})

test('pruneRunLogs protects the log currently being opened, even if its timestamp is old', () => {
    const dir = mkdtempSync(join(tmpdir(), 'run-logs-'))
    try {
        const current = join(dir, 'current.log')
        const recent = join(dir, 'recent.log')
        const middle = join(dir, 'middle.log')
        for (const [file, stamp] of [
            [current, 1],
            [middle, 2],
            [recent, 3],
        ] as const) {
            writeFileSync(file, file)
            utimesSync(file, new Date(stamp * 1000), new Date(stamp * 1000))
        }
        expect(pruneRunLogs(dir, 2, current)).toBe(1)
        expect(existsSync(current)).toBe(true)
        expect(existsSync(recent)).toBe(true)
        expect(existsSync(middle)).toBe(false)
    } finally {
        rmSync(dir, {recursive: true, force: true})
    }
})
