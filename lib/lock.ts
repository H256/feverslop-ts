import {closeSync, openSync, readFileSync, rmSync, writeSync} from 'node:fs'
import {join} from 'node:path'
import {sweepPartials} from './partial-cleanup.ts'
import {ownProcessIdentity, processAlive, processIdentity, sameProcess} from './process-identity.ts'
import {busy} from './service-error.ts'

// Every save writes the whole project.json from the state the run loaded: two runs on one project would silently drop
// each other's steps. So a run that writes holds a lock file with its process id for as long as it lives.

export {processAlive} from './process-identity.ts'

/** The process that holds the project's lock now - undefined when it is free, or held by a process that is gone. */
export function lockHolder(dir: string): number | undefined {
    const holder = readLock(dir)
    if (!holder || !processAlive(holder.pid)) return undefined
    const actual = holder.identity ? processIdentity(holder.pid) : undefined
    // A failed OS query is not evidence that a live holder is stale: keep excluding other writers.
    return actual && holder.identity !== actual ? undefined : holder.pid
}

function readLock(dir: string): {pid: number; identity?: string} | undefined {
    try {
        const text = readFileSync(join(dir, '.lock'), 'utf8').trim()
        const value = JSON.parse(text)
        const pid = typeof value === 'number' ? value : value?.pid
        if (!Number.isSafeInteger(pid) || pid <= 0) return undefined
        return {pid, ...(typeof value?.identity === 'string' ? {identity: value.identity} : {})}
    } catch {
        return undefined
    }
}

/** Only verified locks may authorize a destructive signal. Legacy locks still exclude concurrent writers. */
export function verifiedLockHolder(dir: string): number | undefined {
    const holder = readLock(dir)
    return holder && sameProcess(holder.pid, holder.identity) ? holder.pid : undefined
}

function takeLock(dir: string, what: string): () => void {
    const file = join(dir, '.lock')
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const fd = openSync(file, 'wx')
            try {
                writeSync(fd, JSON.stringify({pid: process.pid, identity: ownProcessIdentity()}))
            } finally {
                closeSync(fd)
            }
            return () => rmSync(file, {force: true})
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
            const holder = lockHolder(dir)
            if (holder !== undefined && holder !== process.pid) {
                throw busy(
                    `${what} is being worked on by another run (process ${holder}) - wait for it to finish; if it is not running any more, delete ${file}`,
                )
            }
            rmSync(file, {force: true})
        }
    }
    throw new Error(`could not lock ${what} - delete ${file} and run again`)
}

/** Takes the project's lock or throws, naming the run that holds it. A lock of a process that is gone is taken over. */
export function lockProject(dir: string, what: string): () => void {
    const release = takeLock(dir, what)
    process.on('exit', release)
    try {
        sweepPartials(dir)
    } catch {
        /* cleanup must not stop a run */
    }
    return release
}

/** Does `work` under the project's lock, for a process that lives on after it (the workspace): no other run starts meanwhile, and none is running. */
export async function withProjectLock<T>(dir: string, what: string, work: () => T | Promise<T>): Promise<T> {
    const release = takeLock(dir, what)
    try {
        return await work()
    } finally {
        release()
    }
}
