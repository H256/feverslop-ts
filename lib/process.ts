// Runs a child process to completion, capturing stdout and stderr.
async function capture(cmd: string[], opts: { stdout?: 'pipe' | 'ignore', stderr?: 'pipe' | 'inherit' } = {}) {
    const proc = Bun.spawn(cmd, {stdout: opts.stdout ?? 'pipe', stderr: opts.stderr ?? 'pipe'})
    const [stdout, stderr, code] = await Promise.all([
        opts.stdout === 'ignore' ? Promise.resolve('') : new Response(proc.stdout).text(),
        opts.stderr === 'inherit' ? Promise.resolve('') : new Response(proc.stderr).text(),
        proc.exited,
    ])
    return {stdout, stderr, code}
}

export {capture as captureProcess}

/** Runs a process and throws `errorMessage(stderr)` on a non-zero exit code - returns stdout on success. */
export async function runProcess(cmd: string[], opts: { stdout?: 'pipe' | 'ignore', stderr?: 'pipe' | 'inherit', errorMessage: (stderr: string) => string }): Promise<string> {
    const {stdout, stderr, code} = await capture(cmd, opts)
    if (code !== 0) throw new Error(opts.errorMessage(stderr))
    return stdout
}
