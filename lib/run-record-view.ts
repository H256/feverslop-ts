import {log, styles} from "./log.ts";
import {commandLine, type RunRecord, runState, startRunRecord} from "./run-record.ts";

/** What is to say about a run that did not simply finish, line by line. */
export function lastRunLines(run: RunRecord): string[] {
    const when = new Date(run.startedAt).toLocaleString()
    const command = styles.muted(run.command)
    switch (runState(run)) {
        case 'running':
            return [`still running, started ${when} (process ${run.pid}): ${command}`]
        case 'stopped':
            return [`started ${when}, ended without a result - stopped or crashed: ${command}`]
        case 'failed':
            return [`started ${when}, failed: ${command}`, ...(run.failures?.length ? run.failures : [run.error ?? '']).map(line => `  ${styles.warning(line)}`)]
        case 'finished':
            return []
    }
}

/** At the start of a run that writes: its command goes into the terminal and the log, with what went wrong in the run before. */
export function beginRun(dir: string, script: string) {
    const command = commandLine(['bun', script, ...Bun.argv.slice(2)])
    const previous = startRunRecord(dir, command)
    log.step('Command', styles.muted(command))
    if (!previous) return
    for (const line of lastRunLines(previous)) log.step('Last run', line)
    if (runState(previous) === 'stopped') log.step('Last run', styles.muted('finished outputs are kept, what is missing is rendered again'))
}
