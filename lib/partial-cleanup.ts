import {readdirSync, rmSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {processAlive} from './process-identity.ts';

/** Called under the project write lock. Never follows symlinks or touches pending jobs/final outputs. */
export function sweepPartials(dir: string): number {
    let removed = 0
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
        if (entry.isSymbolicLink()) continue
        const file = join(dir, entry.name)
        if (entry.isDirectory()) {
            if (!['old', '.git', 'node_modules'].includes(entry.name)) removed += sweepPartials(file)
            continue
        }
        const json = /^project\.json\.(\d+)\.partial$/.exec(entry.name)
        const partial = /\.partial\.(mp4|wav|png)$/.test(entry.name)
        const retakeTemp = /(?:\.small\.png|\.splice\.mp4|\.pending\.json\.partial)$/.test(entry.name)
        if (!json && !partial && !retakeTemp) continue
        if (json && processAlive(Number(json[1]))) continue
        try {
            if (Date.now() - statSync(file).mtimeMs < 24 * 60 * 60 * 1000) continue
            rmSync(file)
            removed++
        } catch { /* best-effort housekeeping: another process may hold the file */ }
    }
    return removed
}
