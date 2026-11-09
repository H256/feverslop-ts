import {readdirSync, rmSync, statSync} from 'node:fs'
import {join, resolve} from 'node:path'

/** Keep the most recent run logs in a project; inaccessible files are left alone. */
export function pruneRunLogs(dir: string, keep = 20, preserve?: string): number {
    const logs = readdirSync(dir, {withFileTypes: true})
        .filter(entry => entry.isFile() && entry.name.endsWith('.log'))
        .flatMap(entry => {
            try {
                return [{path: join(dir, entry.name), mtime: statSync(join(dir, entry.name)).mtimeMs}]
            } catch {
                return []
            }
        })
        .sort((a, b) => b.mtime - a.mtime || b.path.localeCompare(a.path))
    let removed = 0
    const protectedPath = preserve && resolve(preserve)
    const candidates = logs.filter(log => resolve(log.path) !== protectedPath)
    const limit = Math.max(0, keep - (protectedPath ? 1 : 0))
    for (const log of candidates.slice(limit)) {
        try {
            rmSync(log.path)
            removed++
        } catch {
            /* best effort; never stop a run over old logs */
        }
    }
    return removed
}
