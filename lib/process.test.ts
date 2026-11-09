import {expect, test} from 'bun:test'
import {captureProcess, runProcess} from './process.ts'

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
