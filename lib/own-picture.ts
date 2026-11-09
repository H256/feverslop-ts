// The user's own picture put in as the anchor of one reference picture (--picture-anchor), with the description the clips say of
// it given by hand (--picture-description) or read from the picture by the vision model (--describe-picture). The same for a music
// video and a film; tools/replace-character is the older, interactive way for characters.

import {existsSync, mkdirSync, renameSync} from 'node:fs'
import {basename, dirname, join} from 'node:path'
import {describeOrFail, visionFailed} from './describe-picture.ts'
import {log, styles} from './log.ts'
import {runProcess} from './process.ts'
import {isOwnFile, pinnedSidecar} from './provenance.ts'
import type {PictureJob} from './render.ts'
import {sequenceSheetDir, sheetAnchor} from './sequenceSheet.ts'

/** Where the user's own picture goes: the anchor its sheet is drawn from, or with no sheets the picture itself. */
export const ownPictureTarget = (picture: Pick<PictureJob, 'kind' | 'id' | 'file'>, sequenceSheets: boolean) =>
    sequenceSheets && picture.kind !== 'prop' ? sheetAnchor(sequenceSheetDir(picture.kind, picture.id)) : picture.file

/** Is the anchor (with no sheets: the picture) of this picture the user's own? A new sheet is drawn from it, an edited prompt does not replace it. */
export const hasOwnAnchor = (picture: Pick<PictureJob, 'kind' | 'id' | 'file'>, projectDir: string, sequenceSheets: boolean) =>
    isOwnFile(join(projectDir, ownPictureTarget(picture, sequenceSheets)))

/**
 * Puts the file in place as the picture's anchor, as a plain PNG, marked as the user's own (lib/provenance.ts) - what was there is
 * put away before (putAwayPicture). ffmpeg reads whatever it is given; what it cannot read as a picture is refused.
 */
export async function installOwnPicture(picture: PictureJob, projectDir: string, sequenceSheets: boolean, file: string): Promise<string> {
    if (picture.kind === 'prop') throw new Error(`${picture.id} is a prop: its picture is drawn from its description only`)
    const target = ownPictureTarget(picture, sequenceSheets)
    const path = join(projectDir, target)
    mkdirSync(dirname(path), {recursive: true})
    const partial = `${path}.partial.png`
    await runProcess(['ffmpeg', '-y', '-v', 'error', '-i', file, '-frames:v', '1', partial], {
        errorMessage: err => `ffmpeg could not read ${basename(file)} as a picture:\n${err}`,
    })
    renameSync(partial, path)
    await Bun.write(`${path}.json`, JSON.stringify(pinnedSidecar(`your own picture, ${basename(file)}`), null, 2))
    return target
}

type Descriptions = {
    characterDescriptions?: Record<string, string>
    characterDescriptionVariants?: Record<string, string[]>
    locationDescriptions?: Record<string, string>
}
type Cast = {characters?: {id: string; name: string; role?: string}[]; locations?: {id: string; name: string}[]}

/**
 * Where a picture's description is kept in project.json: a place's and a character's under its id - a film's other look of a
 * character (`<id>--<state>`) too - a member of a music video's group (`<id>-v<n>`) in the group's variants.
 */
export function descriptionSlot(
    data: Descriptions & {cast?: Cast},
    pictureId: string,
): {kind: 'character' | 'location'; name: string; role: string; get: () => string | undefined; set: (text: string) => void} {
    const location = data.cast?.locations?.find(l => l.id === pictureId)
    if (location) {
        if (!data.locationDescriptions) throw new Error('no descriptions of the places yet - plan up to the look first')
        const all = data.locationDescriptions
        return {
            kind: 'location',
            name: location.name,
            role: '',
            get: () => all[pictureId],
            set: text => {
                all[pictureId] = text
            },
        }
    }
    const member = /^(.+)-v(\d+)$/.exec(pictureId)
    const character =
        data.cast?.characters?.find(c => c.id === pictureId || pictureId.startsWith(`${c.id}--`)) ??
        (member ? data.cast?.characters?.find(c => c.id === member[1]) : undefined)
    if (!character) throw new Error(`no character or place ${pictureId}`)
    if (!data.characterDescriptions) throw new Error('no descriptions of the characters yet - plan up to the look first')
    const all = data.characterDescriptions
    const subject = {kind: 'character' as const, name: character.name, role: character.role ?? ''}
    if (member && character.id === member[1]) {
        const n = Number(member[2])
        const variants = (data.characterDescriptionVariants ??= {})
        return {
            ...subject,
            get: () => variants[character.id]?.[n] ?? all[character.id],
            set: text => {
                const list = (variants[character.id] ??= [])
                // the members before it keep the description they were drawn with
                for (let i = 0; i < n; i++) list[i] ??= all[character.id] ?? ''
                list[n] = text
            },
        }
    }
    return {
        ...subject,
        get: () => all[pictureId],
        set: text => {
            all[pictureId] = text
        },
    }
}

/**
 * The description given by hand, or read from the user's picture by the vision model, put into project.json before anything is
 * planned from it: the clip prompts and the sheet say it. Nothing changes when the model cannot read the picture - the run stops.
 */
export async function takeOwnDescription(
    data: Descriptions & {cast?: Cast},
    save: () => Promise<unknown>,
    pictureId: string,
    how: {text?: string; describeFrom?: string},
): Promise<void> {
    const slot = descriptionSlot(data, pictureId)
    let text = how.text?.trim()
    if (text === undefined && how.describeFrom) {
        if (!existsSync(how.describeFrom)) throw new Error(`no picture ${how.describeFrom}`)
        log.step('Describe', `${pictureId} ${styles.muted('- from your picture, by the vision model')}`)
        const {description, failed} = await describeOrFail(
            how.describeFrom,
            slot.kind === 'character' ? {kind: 'character', name: slot.name, role: slot.role} : {kind: 'location', name: slot.name},
        )
        if (failed || !description) throw new Error(visionFailed(failed ?? 'no answer'))
        text = description
    }
    if (!text) return
    slot.set(text)
    await save()
    log.box(pictureId, text)
}
