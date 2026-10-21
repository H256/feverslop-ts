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
            expect(text.match(/plain 2/g)).toHaveLength(1)
            expect(text).toContain('▸ Warning careful')
            expect(text).toContain('broken')
            expect(text).toContain(`The whole run: ${file}`)
            expect(text).not.toContain('\x1b')
            expect(text).not.toContain('status line')
        } finally {
            rmSync(dir, {recursive: true, force: true})
        }
    })

    test('the details of a cached step: only in the file, unless shown', () => {
        const dir = mkdtempSync(join(tmpdir(), 'fs-log-'))
        const file = join(dir, 'run.log')
        try {
            const script = (show: string) => `
                import {keepLogIn, log, setOutput} from ${JSON.stringify(join(import.meta.dir, 'log.ts'))}
                keepLogIn(${JSON.stringify(file)})
                setOutput({show: [${show}]})
                log.cached('story', '3 · CRAFTING THE STORY')
                log.box('Story', 'Once upon a time')
                log.warn('a warning is always shown')
                log.section('4 · NEXT')
                log.step('Fresh', 'shown')`
            const child = Bun.spawnSync(['bun', '-e', script('')], {stdout: 'pipe', stderr: 'pipe'})
            const quiet = child.stdout.toString()
            expect(quiet).toContain('3 · CRAFTING THE STORY')
            expect(quiet).not.toContain('Once upon a time')
            expect(child.stderr.toString()).toContain('a warning is always shown')
            expect(quiet).toContain('Fresh')
            expect(readFileSync(file, 'utf8')).toContain('Once upon a time')
            const shown = Bun.spawnSync(['bun', '-e', script("'story'")], {stdout: 'pipe', stderr: 'pipe'}).stdout.toString()
            expect(shown).toContain('Once upon a time')
        } finally {
            rmSync(dir, {recursive: true, force: true})
        }
    })
})

test('concurrent TTY board stays out of the persisted log', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fs-board-'))
    const file = join(dir, 'run.log')
    try {
        const child = Bun.spawnSync(['bun', '-e', `
            import {keepLogIn, log, startSpinner} from ${JSON.stringify(join(import.meta.dir, 'log.ts'))}
            Object.defineProperty(process.stdout, 'isTTY', {value: true})
            Object.defineProperty(process.stdout, 'columns', {value: 60})
            keepLogIn(${JSON.stringify(file)})
            const a = startSpinner(() => 'clip-one running')
            const b = startSpinner(() => 'clip-two loading')
            await Bun.sleep(120)
            log.info('persistent event')
            a(); b()
        `], {stdout: 'pipe', stderr: 'pipe'})
        expect(child.exitCode).toBe(0)
        expect(child.stdout.toString()).toContain('clip-one running')
        expect(child.stdout.toString()).toContain('clip-two loading')
        const saved = readFileSync(file, 'utf8')
        expect(saved).toBe('persistent event\n')
    } finally { rmSync(dir, {recursive: true, force: true}) }
})
