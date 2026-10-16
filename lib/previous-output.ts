import {existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync} from "node:fs";
import {join} from "node:path";

// output/ is rebuilt on every run. The output of the run before is kept as output/.previous/ - one generation - so a run
// can say which clip requests it changed, and any one of them can be compared with `diff`.

export const PREVIOUS = '.previous'

/** Moves the current output/ to output/.previous/ (dropping the generation before it) and creates an empty output/. */
export function startOutput(outputDir: string) {
    const parked = `${outputDir}${PREVIOUS}`
    rmSync(parked, {recursive: true, force: true})
    if (existsSync(outputDir)) {
        rmSync(join(outputDir, PREVIOUS), {recursive: true, force: true})
        renameSync(outputDir, parked)
    }
    mkdirSync(outputDir, {recursive: true})
    if (existsSync(parked)) renameSync(parked, join(outputDir, PREVIOUS))
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
