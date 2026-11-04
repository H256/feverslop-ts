import {renameSync, writeFileSync} from "node:fs";
import {whileHeld} from "./previous-output.ts";

// project.json is written next to itself first and then moved over the old one, so a crash mid-write never leaves half of
// it. On Windows that move fails (EPERM) while another program has the old file open for a moment - the virus scanner or
// the search indexer after the last save, the workspace reading it - so it is tried again a few times, as for a folder.

/** The partial file a save writes first - the process id in the name: two runs saving at once never share one. */
export const partialOf = (file: string) => `${file}.${process.pid}.partial`

/** Moves the written partial over `file`, again while `file` is held open. */
export const replaceWithPartial = (file: string) => whileHeld(file, () => renameSync(partialOf(file), file))

/** Writes `data` as JSON to `file` without ever leaving half a file. */
export function writeJsonFile(file: string, data: unknown) {
    writeFileSync(partialOf(file), JSON.stringify(data, null, 2))
    replaceWithPartial(file)
}
