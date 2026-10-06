import {existsSync, mkdirSync, renameSync} from "node:fs";
import {basename, join} from "node:path";

/**
 * Puts files of a project away in <project>/old/attempts/<name>/ - for something that is rendered again (--again) and whose old version
 * is still wanted: to compare, or to put back (move the files back to where they were). Files that do not exist are skipped.
 */
export function archiveFiles(projectDir: string, name: string, files: string[]) {
    const keep = join(projectDir, 'old', 'attempts', name)
    mkdirSync(keep, {recursive: true})
    for (const file of files) {
        const from = join(projectDir, file)
        if (existsSync(from)) renameSync(from, join(keep, basename(file)))
    }
    return keep
}

/** A label for a version that is put away: the time, sortable and safe in a file name. */
export const versionStamp = () => new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')
