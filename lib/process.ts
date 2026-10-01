// How long a quick helper call (ffprobe, one frame, one short cut) may take before it counts as hung - the long
// ones (stem separation, transcription, the final encode) have no limit, they legitimately run for minutes.
export const SHORT_PROCESS_TIMEOUT_MS = 2 * 60 * 1000

type CaptureOptions = { stdout?: 'pipe' | 'ignore', stderr?: 'pipe' | 'inherit', timeoutMs?: number }

// Runs a child process to completion, capturing stdout and stderr.
async function capture(cmd: string[], opts: CaptureOptions = {}) {
    const tool = cmd[0]!
    let proc: Bun.Subprocess<'ignore', 'pipe' | 'ignore', 'pipe' | 'inherit'>
    try {
        proc = Bun.spawn(cmd, {stdout: opts.stdout ?? 'pipe', stderr: opts.stderr ?? 'pipe'}) as typeof proc
    } catch (e) {
        // a missing executable surfaces as a bare ENOENT / "Executable not found in $PATH"
        const message = e instanceof Error ? e.message : String(e)
        if ((e as { code?: string }).code === 'ENOENT' || /not found|ENOENT/i.test(message)) {
            throw new Error(`${tool} was not found - install it and make sure it is on your PATH (see Requirements in the README)`)
        }
        throw new Error(`could not start ${tool}: ${message}`)
    }
    let timedOut = false
    const timer = opts.timeoutMs ? setTimeout(() => {
        timedOut = true
        proc.kill()
    }, opts.timeoutMs) : undefined
    try {
        const [stdout, stderr, code] = await Promise.all([
            opts.stdout === 'ignore' ? Promise.resolve('') : new Response(proc.stdout as ReadableStream).text(),
            opts.stderr === 'inherit' ? Promise.resolve('') : new Response(proc.stderr as ReadableStream).text(),
            proc.exited,
        ])
        if (timedOut) throw new Error(`${tool} did not finish within ${opts.timeoutMs! / 1000} s and was stopped (${cmd.slice(1).join(' ')})`)
        return {stdout, stderr, code}
    } finally {
        clearTimeout(timer)
    }
}

export {capture as captureProcess}

/** Runs a process and throws `errorMessage(stderr)` on a non-zero exit code - returns stdout on success. */
export async function runProcess(cmd: string[], opts: CaptureOptions & { errorMessage: (stderr: string) => string }): Promise<string> {
    const {stdout, stderr, code} = await capture(cmd, opts)
    if (code !== 0) throw new Error(opts.errorMessage(stderr))
    return stdout
}
