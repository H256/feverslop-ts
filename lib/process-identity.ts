import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

/** OS process creation identity. Never substitute liveness if the identity cannot be read. */
export function processIdentity(pid: number): string | undefined {
    if (!Number.isSafeInteger(pid) || pid <= 0) return undefined
    try {
        if (process.platform === 'linux') {
            const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
            const start = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]
            return `${readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()}:${start}`
        }
        const value = process.platform === 'win32'
            ? execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`], {encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore']}).trim()
            : execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], {encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore']}).trim()
        return value || undefined
    } catch { return undefined }
}

let own: string | undefined
export const ownProcessIdentity = () => own ??= processIdentity(process.pid)
export const sameProcess = (pid: number, identity: string | undefined) => !!identity && identity === processIdentity(pid)
