import {expect, test} from 'bun:test'
import {captureProcess, runProcess} from './process.ts'
import {mkdtempSync, readFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

test('child progress goes to its log file without leaking into the parent terminal', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'process-log-'))
    try {
        const file = join(dir, 'refinement.log')
        const script = `import {runProcess} from ${JSON.stringify(join(import.meta.dir, 'process.ts'))};
            await runProcess(['bun', '-e', 'console.error("Phoneme alignment 1/2"); console.error("model failed"); process.exit(1)'],
                {stderrFile: ${JSON.stringify(file)}, errorMessage: e => e}).catch(e => console.log(e.message));`
        const result = await captureProcess(['bun', '-e', script])
        expect(result.stderr).toBe('')
        expect(readFileSync(file, 'utf8')).toContain('Phoneme alignment 1/2')
        expect(result.stdout).toContain('model failed')
    } finally {
        rmSync(dir, {recursive: true, force: true})
    }
})

test('a missing executable names the tool and how to install it', async () => {
    const message = await captureProcess(['feverslop-audit-command-that-does-not-exist']).then(
        () => 'unexpected success',
        (error: Error) => error.message,
    )
    expect(message).toContain('feverslop-audit-command-that-does-not-exist was not found')
    expect(message).toContain('make sure it is on your PATH')
})

test('a timed out process is killed and reported', async () => {
    const started = Date.now()
    const message = await runProcess(['bun', '-e', 'setTimeout(() => {}, 60_000)'], {
        timeoutMs: 100,
        errorMessage: stderr => stderr,
    }).then(
        () => 'unexpected success',
        (error: Error) => error.message,
    )

    expect(message).toContain('bun did not finish within 0.1 s and was stopped')
    expect(Date.now() - started).toBeLessThan(5_000)
})
