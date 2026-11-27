import {renameHeld} from './previous-output.ts'
import {rmSync} from 'node:fs'
import {extname} from 'node:path'

/** Publish media only after its writer succeeds; retain the extension for ffmpeg's format detection. */
export async function produceMedia(target: string, produce: (partial: string) => Promise<unknown>) {
    const partial = `${target}.partial${extname(target)}`
    try {
        await produce(partial)
        renameHeld(partial, target)
    } finally {
        rmSync(partial, {force: true})
    }
}
