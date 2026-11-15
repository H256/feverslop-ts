import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

/** A test that gets a temp folder named `prefix`-… and has it removed afterwards, whatever the test does (#1006). */
export const inTemp = (prefix: string, run: (dir: string) => void | Promise<void>) => async () => {
    const dir = mkdtempSync(join(tmpdir(), `${prefix}-`))
    try {
        await run(dir)
    } finally {
        rmSync(dir, {recursive: true, force: true})
    }
}
