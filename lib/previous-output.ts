import {existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync} from "node:fs";
import {join} from "node:path";

// output/ is rebuilt on every run. The output of the run before is kept as output/.previous/ - one generation - so a run
// can say which clip requests it changed, and any one of them can be compared with `diff`.

export const PREVIOUS = '.previous'

// On Windows a folder cannot be moved or removed while any program has something in it open - the virus scanner or the
// search indexer looking at freshly written files lets go within seconds, so the move is tried again a few times
// before the run stops. In milliseconds, about 6 s in all.
const LOCK_WAITS = [100, 200, 400, 800, 1500, 3000]

/** Runs `action` again while the folder is held open (EPERM, EBUSY), then stops with what to do. */
export function whileHeld(folder: string, action: () => void, waits = LOCK_WAITS, sleep = Bun.sleepSync) {
    for (let i = 0; ; i++) {
        try {
            return action()
        } catch (e) {
            const code = (e as NodeJS.ErrnoException).code
            if (code !== 'EPERM' && code !== 'EBUSY') throw e
            if (i < waits.length) {
                sleep(waits[i]!)
                continue
            }
            // resmon only finds the path as Windows writes it
            const resmon = process.platform === 'win32' ? `; resmon (CPU → Associated Handles, search "${folder.replaceAll('/', '\\')}") shows who holds it` : ''
            throw new Error(`${folder} is held open by another program (${code}, still after ${Math.round(waits.reduce((a, b) => a + b, 0) / 1000)} s) - close what has it or a file in it open (a player, an Explorer window or preview, a terminal in it, an editor tab), then run the same command again${resmon}`)
        }
    }
}

/** Moves the current output/ to output/.previous/ (dropping the generation before it) and creates an empty output/. */
export function startOutput(outputDir: string) {
    const parked = `${outputDir}${PREVIOUS}`
    whileHeld(parked, () => rmSync(parked, {recursive: true, force: true}))
    if (existsSync(outputDir)) {
        whileHeld(outputDir, () => rmSync(join(outputDir, PREVIOUS), {recursive: true, force: true}))
        whileHeld(outputDir, () => renameSync(outputDir, parked))
    }
    mkdirSync(outputDir, {recursive: true})
    if (existsSync(parked)) whileHeld(parked, () => renameSync(parked, join(outputDir, PREVIOUS)))
}

/** The clip requests of a clips folder, by clip id: the file's text. */
export function readRequests(clipsDir: string): Map<string, string> {
    if (!existsSync(clipsDir)) return new Map()
    return new Map(readdirSync(clipsDir).filter(f => f.endsWith('.json')).sort().map(f => [f.slice(0, -'.json'.length), readFileSync(join(clipsDir, f), 'utf8')]))
}

export type RequestChanges = { changed: string[], added: string[], gone: string[] }

/** Which requests differ between two runs - undefined when there was no run before to compare with. */
export function requestChanges(outputDir: string): RequestChanges | undefined {
    if (!existsSync(join(outputDir, PREVIOUS))) return undefined
    const before = readRequests(join(outputDir, PREVIOUS, 'clips'))
    const after = readRequests(join(outputDir, 'clips'))
    return {
        changed: [...after].filter(([id, text]) => before.has(id) && before.get(id) !== text).map(([id]) => id),
        added: [...after.keys()].filter(id => !before.has(id)),
        gone: [...before.keys()].filter(id => !after.has(id)),
    }
}
