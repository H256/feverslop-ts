import {closeSync, openSync, readFileSync, rmSync, writeSync} from "node:fs";
import {join} from "node:path";

// Every save writes the whole project.json from the state the run loaded: two runs on one project would silently drop
// each other's steps. So a run that writes holds a lock file with its process id for as long as it lives.

export const processAlive = (pid: number) => {
    try {
        process.kill(pid, 0)
        return true
    } catch (e) {
        // EPERM: the process exists, it is only not ours
        return (e as NodeJS.ErrnoException).code === 'EPERM'
    }
}

/** Takes the project's lock or throws, naming the run that holds it. A lock of a process that is gone is taken over. */
export function lockProject(dir: string, what: string): () => void {
    const file = join(dir, '.lock')
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const fd = openSync(file, 'wx')
            writeSync(fd, String(process.pid))
            closeSync(fd)
            const release = () => rmSync(file, {force: true})
            process.on('exit', release)
            return release
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
            const holder = Number(readFileSync(file, 'utf8').trim())
            if (Number.isInteger(holder) && holder !== process.pid && processAlive(holder)) {
                throw new Error(`${what} is being worked on by another run (process ${holder}) - wait for it to finish; if it is not running any more, delete ${file}`)
            }
            rmSync(file, {force: true})
        }
    }
    throw new Error(`could not lock ${what} - delete ${file} and run again`)
}
