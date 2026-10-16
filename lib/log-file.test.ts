import {describe, expect, test} from "bun:test";
import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

// keepLogIn changes console and the streams of the whole process - so it runs in a child process here
describe('the log of a run', () => {
    test('everything printed, without colours and without the status line', () => {
        const dir = mkdtempSync(join(tmpdir(), 'fs-log-'))
        const file = join(dir, 'logs', 'run.log')
        try {
            const script = `
                import {keepLogIn, log, startSpinner} from ${JSON.stringify(join(import.meta.dir, 'log.ts'))}
                keepLogIn(${JSON.stringify(file)})
                log.step('Step', 'one')
                console.log('plain', 2)
                process.stdout.write('\\r\\x1b[2Kstatus line')
                process.stdout.write('\\r\\x1b[2K')
                log.warn('careful')
                log.fatal('broken')`
            const child = Bun.spawnSync(['bun', '-e', script], {stdout: 'pipe', stderr: 'pipe'})
            expect(child.exitCode).toBe(1)
            const text = readFileSync(file, 'utf8')
            expect(text).toContain('▸ Step one\n')
            expect(text).toContain('plain 2\n')
            expect(text).toContain('▸ Warning careful')
            expect(text).toContain('broken')
            expect(text).toContain(`The whole run: ${file}`)
            expect(text).not.toContain('\x1b')
            expect(text).not.toContain('status line')
        } finally {
            rmSync(dir, {recursive: true, force: true})
        }
    })
})
