// The steps the two replace-character wizards share (tools/replace-character.ts for a music video, tools/film-replace-character.ts
// for a film): the new picture put in place of the old one, what was built from the old one cleared, the description asked
// for, and the clips rendered with the old picture named. What a project calls its character, where its words are and what a
// cancel says stay with each tool.
import * as p from '@clack/prompts'
import {existsSync, mkdirSync, readdirSync, renameSync} from 'node:fs'
import {basename, dirname, join, relative} from 'node:path'
import {visionUrls} from './describe-picture.ts'
import {ask} from './llm.ts'
import {log} from './log.ts'
import {clipRequestsDir} from './previous-output.ts'
import {runProcess} from './process.ts'
import {characterImageDescriptionPrompt} from './prompts.ts'
import {pinnedSidecar} from './provenance.ts'
import {pictureAsset} from './compose.ts'
import {archiveFiles, versionStamp} from './archive.ts'
import {SHEET_FRAMES, SHEET_VIDEO, sequenceSheetDir, sheetAnchor} from './sequenceSheet.ts'

/** Where the new picture goes: with sequence sheets the anchor the sheet is made from, else the picture the clips use. */
export const replacedPictureFile = (dir: string, assetId: string, sequenceSheets: boolean) =>
    join(dir, sequenceSheets ? sheetAnchor(sequenceSheetDir('character', assetId)) : pictureAsset('character', assetId))

/**
 * Puts the picture at `imagePath` in place as `targetFile`, as a plain PNG, marked as the user's own (lib/provenance.ts): kept as
 * it is whatever the look prompts say later; the clips made with the old one are stale through the picture's content. The
 * picture it replaces is kept in old/ - one wrong click doesn't lose it. Says what it changed into `changes`.
 */
export async function installPicture(dir: string, assetId: string, targetFile: string, imagePath: string, changes: string[]) {
    if (existsSync(targetFile)) {
        const keep = join(dir, 'old', `${assetId}-${Date.now()}.png`)
        mkdirSync(dirname(keep), {recursive: true})
        renameSync(targetFile, keep)
        log.info(`The old picture is kept: ${keep}`)
        changes.push(`the old picture is kept as ${keep}`)
    }
    mkdirSync(dirname(targetFile), {recursive: true})
    const partial = `${targetFile}.partial.png`
    // ffmpeg reads whatever format was given and normalizes it to the plain PNG every path here expects
    await runProcess(['ffmpeg', '-y', '-v', 'error', '-i', imagePath, '-frames:v', '1', partial], {
        errorMessage: err => `ffmpeg could not read ${imagePath} as an image:\n${err}`,
    })
    renameSync(partial, targetFile)
    await Bun.write(`${targetFile}.json`, JSON.stringify(pinnedSidecar(`replaced with ${basename(imagePath)}`), null, 2))
    log.success(`Saved ${targetFile}`)
    changes.push(`the new image is saved as ${targetFile}`)
}

/** Deletes what the sequence sheet built from the old anchor: the picture the clips use, the turnaround video and its frames. True when there was any. */
export function clearSheetOfOldAnchor(dir: string, assetId: string, changes: string[]): boolean {
    const seqDir = join(dir, sequenceSheetDir('character', assetId))
    const finalPicture = join(dir, pictureAsset('character', assetId))
    const stale = [
        finalPicture,
        `${finalPicture}.json`,
        join(seqDir, SHEET_VIDEO),
        join(seqDir, `${SHEET_VIDEO}.json`),
        join(seqDir, `${SHEET_VIDEO}.pending.json`),
        join(seqDir, SHEET_FRAMES),
    ]
    const removed = stale.filter(existsSync)
    if (removed.length)
        archiveFiles(
            dir,
            `${assetId}-stale-${versionStamp()}`,
            removed.map(f => relative(dir, f)),
        )
    if (!removed.length) return false
    log.info(`Cleared ${removed.length} file(s)/folder(s) built from the old anchor`)
    changes.push('the old reference sheet and sequence video were archived')
    return true
}

/**
 * The new description of the character, asked for: from the picture by a vision-capable model (the LLM configured by
 * `configure`), typed, or none - the current one stays. `answer` is the tool's, which knows what a cancel has to say.
 */
export async function askDescription(
    picture: string,
    char: {name: string; role: string},
    configure: () => Promise<void>,
    answer: <T>(value: T) => Exclude<T, symbol>,
): Promise<string | undefined> {
    const mode = answer(
        await p.select({
            message: 'Update the description used in the clip prompts?',
            options: [
                {value: 'vision', label: 'Generate it from the image (vision-capable LLM)', hint: 'recommended'},
                {value: 'manual', label: 'Type it myself'},
                {value: 'skip', label: 'Leave the current description unchanged'},
            ],
        }),
    )
    if (mode === 'skip') return undefined
    if (mode === 'vision') {
        await configure()
        log.info('Asking the vision model - can take a while, see the spinner below')
        try {
            const generated = (await ask(characterImageDescriptionPrompt(await visionUrls([picture]), char))).trim() || undefined
            if (generated) {
                log.success('Description generated from the image:')
                log.info(generated)
                return generated
            }
        } catch (e) {
            log.warn(`Vision description failed - the connected model may not support images (${(e as Error).message})`)
        }
        return answer(await p.text({message: 'Type a description instead (leave empty to keep the current one)'})) || undefined
    }
    return answer(await p.text({message: 'New description (leave empty to keep the current one)'})) || undefined
}

/** The clips already rendered with the picture `pictureId` among their references - a swap does not touch them. */
export async function renderedClipsWith(dir: string, pictureId: string): Promise<string[]> {
    const clipsDir = clipRequestsDir(dir)
    if (!existsSync(clipsDir)) return []
    const affected: string[] = []
    for (const entry of readdirSync(clipsDir)
        .filter(e => e.endsWith('.json'))
        .sort()) {
        const clip = await Bun.file(join(clipsDir, entry)).json()
        const clipId = entry.replace(/\.json$/, '')
        if (clip.assets?.pictures?.some((pic: {id: string}) => pic.id === pictureId) && existsSync(join(dir, 'videos', `${clipId}.mp4`))) affected.push(clipId)
    }
    return affected
}
