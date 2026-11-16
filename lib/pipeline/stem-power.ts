import {existsSync} from 'node:fs'
import {join} from 'node:path'
import type {StemPower} from '../compose.ts'
import {stemLoudDb} from '../instrument-parts.ts'
import {STEM_FRAME_SEC, stemFramePower} from '../music.ts'
import type {MusicMap} from '../project.ts'

/**
 * The stems of the players as the shots read them (#1024): decoded once, each with its own playing level. A stem that is not on
 * disk (a project made before the instrument stems, a file moved away) is left out - the shots then say nothing of how it is heard.
 * `files`: the stem files of the project by name, relative to its folder.
 */
export async function playerStemPowers(
    dir: string,
    files: Record<string, string | undefined>,
    names: string[],
    music: Pick<MusicMap, 'downbeats' | 'durationSec'>,
): Promise<Record<string, StemPower>> {
    const edges = [...music.downbeats, music.durationSec]
    const out: Record<string, StemPower> = {}
    for (const name of names) {
        const file = files[name]
        if (!file || !existsSync(join(dir, file))) continue
        const power = await stemFramePower(join(dir, file))
        out[name] = {power, hopSec: STEM_FRAME_SEC, loudDb: stemLoudDb(power, STEM_FRAME_SEC, edges)}
    }
    return out
}
