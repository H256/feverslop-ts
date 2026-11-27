import {existsSync} from 'node:fs'
import {join} from 'node:path'
import {renderAll, warnFixedSeed} from '../batch.ts'
import type {RenderConfig} from '../config.ts'
import {pictureSeed} from '../film/pictures.ts'
import {log, styles} from '../log.ts'
import {hasOwnAnchor, installOwnPicture} from '../own-picture.ts'
import {namedPictures, type PictureJob, pinEditedPicture, putAwayPicture, type Renderer} from '../render.ts'
import {pictureEstimate} from '../render-state.ts'

// --render=images for both pipelines (#1149): the pictures named in --only (all without it), again with --again, from an edited
// prompt with --picture-prompt, your own with --picture-anchor. The music video and the film had a copy each.

/** What the run asked of its pictures. */
export type PictureAsk = {
    again: boolean
    'new-anchor': boolean
    'picture-prompt'?: string
    'picture-anchor'?: string
}

export type PictureRun = {
    dir: string
    config: Pick<RenderConfig, 'sequenceSheets' | 'sequenceWorkflow' | 'imageWorkflow' | 'imageResolution' | 'seed' | 'renderEngine'>
    servers: string[]
    render: Set<string>
    only: Set<string>
    args: PictureAsk
}

/** A picture with `baseId` is another look of that character: drawn after it, with its seed - that keeps the face. */
export async function renderPictures(renderer: Renderer, pictures: (PictureJob & {baseId?: string})[], run: PictureRun) {
    const {dir, config, servers, render, only, args} = run
    log.step('Pictures', `${pictures.length}${config.sequenceSheets ? styles.muted(' (multi-angle reference sheets)') : ''}`)
    const named = namedPictures(pictures, only, args.again && !render.has('videos'))
    // an edited prompt: this one picture, from these words, kept as it is from then on
    const edited = args['picture-prompt'] ? await Bun.file(args['picture-prompt']).text() : undefined
    if (edited !== undefined && named.length !== 1) throw new Error('--picture-prompt goes with one picture in --only')
    const chosen = edited === undefined ? named : named.map(p => ({...p, prompt: edited}))
    // --again always comes with --only (lib/run-options.ts): it is about the pictures among them
    if (args.again && pictures.some(p => only.has(p.id))) {
        warnFixedSeed(config.seed)
        // a new anchor for an edited prompt - but the user's own anchor stays, its prompt is a note (lib/own-picture.ts)
        const newAnchor = (picture: PictureJob) =>
            args['new-anchor'] || !!args['picture-anchor'] || (edited !== undefined && !hasOwnAnchor(picture, dir, config.sequenceSheets))
        for (const picture of chosen)
            log.step('Again', `${picture.id} ${styles.muted(`- the old one is in ${putAwayPicture(picture, dir, config, newAnchor(picture))}`)}`)
    }
    if (args['picture-anchor'])
        log.step(
            'Own',
            `${chosen[0]!.id} ${styles.muted(`- your picture is ${await installOwnPicture(chosen[0]!, dir, config.sequenceSheets, args['picture-anchor'])}`)}`,
        )
    const todo = chosen.filter(p => !existsSync(join(dir, p.file)))
    log.step('Estimate', styles.muted(await pictureEstimate(todo.length, config, servers)))
    // a reference sheet is made from an H3 turnaround video, which has no wan2gp form: a wan2gp project gets single pictures (#1211) -
    // what its clips take anyway (a person's single picture, not the 2x3 sheet, #1214)
    const sheets = config.sequenceSheets && config.renderEngine !== 'wan2gp'
    if (config.sequenceSheets && !sheets) log.step('Sheets', styles.muted('single pictures - reference sheets have no wan2gp form yet'))
    const renderOne = (picture: PictureJob) => (sheets && picture.kind !== 'prop' ? renderer.renderSequenceSheet(picture) : renderer.renderPicture(picture))
    await renderAll(
        chosen.filter(p => !p.baseId),
        renderOne,
    )
    await renderAll(
        chosen.filter(p => p.baseId),
        p => renderOne({...p, seed: pictureSeed(dir, p.baseId!)}),
    )
    if (edited !== undefined) pinEditedPicture(chosen[0]!, dir, edited)
}
