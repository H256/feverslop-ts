import {existsSync, mkdirSync} from 'node:fs'
import {basename, dirname, extname, join} from 'node:path'
import {resolveSeed, type PixelSize} from '../../comfy/helpers.ts'
import h3StartFrame from '../../comfy/workflows/h3-startframe.ts'
import {pictureAsset} from '../compose.ts'
import {log, styles} from '../log.ts'
import {fileFingerprint} from '../provenance.ts'
import {type RenderSpec, specId} from '../render-spec.ts'
import type {Renderer} from '../render.ts'
import {CHARACTER_SHEET_VIEWS, sequenceSheetDir, sheetFrame, sheetLayout} from '../sequenceSheet.ts'
import {START_PICTURE_MEGAPIXELS, type StartFrameRequest, type StartPicture} from '../startframe-prompt.ts'

// The start pictures of the shots (#1187, lib/startframe-prompt.ts): one MiniMax H3-Image still per shot, in startframes/, made
// only with --render=startframes. What each picture is made from is in its sidecar, like every other render (lib/provenance.ts).

export const START_FRAME_WORKFLOW = 'h3-startframe'
import {startFrameFile} from '../shot-pictures.ts'
export {startFrameFile}
// the reference pictures as the start pictures take them (see startReference), made from the project's own pictures
const REFS = 'startframes/refs'
// a character sheet's top row as a share of its width: two panels of 288x512 (sheetLayout)
const SHEET_ROW = (sheetLayout('character').panel.height / (2 * sheetLayout('character').panel.width)).toFixed(4)

/** The size of a start picture: the area the picture model draws well (about 2.4 MP) in the video's aspect, on its 32 px grid. */
export function startFrameSize(aspect: `${number}:${number}`): PixelSize {
    const [w, h] = aspect.split(':').map(Number) as [number, number]
    const area = 2048 * 1152
    const side = (n: number) => Math.round(n / 32) * 32
    return {width: side(Math.sqrt((area * w) / h)), height: side(Math.sqrt((area * h) / w))}
}

/**
 * A reference picture as a start picture takes it. MiniMaxH3ImageConditioning brings every picture to a 1024 px short edge for its
 * text encoder - up as well as down - so a tall picture costs many tokens and a small one is blown up: a 576x1536 character sheet
 * became 1024x2730 (2.8 MP) with its 288 px faces broken, and nine of them ran the 32 GB Radeon out of memory.
 * - a character with a turnaround (assets/sequence/characters/<id>/frames): its face close-up, front, left profile and rear in
 *   a 2x2 grid at the frames' own size - sharp, about 1.9 MP, and a start picture from the side or from behind has its views
 * - a prop: the middle square of its picture, 1 MP
 * - the place, and a character without a turnaround: its picture as it is
 */
/**
 * What a reference picture costs the text encoder, in megapixels after its 1024 px short edge - as startReference will make it:
 * a turnaround grid (2x 704x1248) 1.86, the top row of a character sheet without one (576x512) 1.18, a place frame (16:9) 1.82, a
 * prop's square 1.
 */
export const startPictureMegapixels =
    (projectDir: string) =>
    (picture: {kind: string; id: string; file: string; small?: true}): number => {
        if (picture.kind === 'prop') return 1
        if (picture.kind === 'location') return 1.82
        const turnaround =
            picture.file === pictureAsset('character', picture.id) && existsSync(join(projectDir, sheetFrame(sequenceSheetDir('character', picture.id), 0)))
        return turnaround ? (picture.small ? 1.4 : 1.86) : 1.18
    }

export async function startReference(projectDir: string, picture: StartPicture): Promise<string> {
    const target = `${REFS}/${picture.kind}-${basename(picture.file, extname(picture.file))}${picture.small ? '-front' : ''}.png`
    if (picture.kind === 'location') return picture.file
    // only the character's own sheet: another look of it, or a member of a group, is not what the turnaround shows
    const own = picture.file === pictureAsset('character', picture.id)
    const frames =
        picture.kind === 'character' && own
            ? (picture.small
                  ? [CHARACTER_SHEET_VIEWS.front]
                  : [CHARACTER_SHEET_VIEWS.face, CHARACTER_SHEET_VIEWS.front, CHARACTER_SHEET_VIEWS.left, CHARACTER_SHEET_VIEWS.rear]
              ).map(n => sheetFrame(sequenceSheetDir('character', picture.id), n))
            : []
    // without a turnaround (another look, a member of a group): the top row of its sheet - the full figure from the front and the face
    const sheetOnly = picture.kind === 'character' && (!own || !frames.every(file => existsSync(join(projectDir, file))))
    const sources = picture.kind === 'character' && !sheetOnly ? frames : [picture.file]
    if (!sources.every(file => existsSync(join(projectDir, file)))) return picture.file
    // made again when one of its sources changed: their fingerprints are in its name's sidecar
    const made = join(projectDir, target)
    const from = sources.map(file => fileFingerprint(join(projectDir, file))).join(',')
    if (existsSync(made) && existsSync(`${made}.json`) && ((await Bun.file(`${made}.json`).json()) as {from?: string}).from === from) return target
    mkdirSync(dirname(made), {recursive: true})
    const filter =
        picture.kind === 'character' && !sheetOnly
            ? picture.small
                ? "crop=iw:'min(ih,iw*4/3)':0:0"
                : '[0][1]hstack[top];[2][3]hstack[bottom];[top][bottom]vstack'
            : sheetOnly
              ? `crop=iw:'min(ih,iw*${SHEET_ROW})':0:0`
              : "crop='min(iw,ih)':'min(iw,ih)'"
    const proc = Bun.spawn(
        [
            'ffmpeg',
            '-v',
            'error',
            '-y',
            ...sources.flatMap(file => ['-i', join(projectDir, file)]),
            ...(sources.length > 1 ? ['-filter_complex'] : ['-vf']),
            filter,
            made,
        ],
        {stderr: 'pipe'},
    )
    if ((await proc.exited) !== 0) throw new Error(`the reference picture ${target} could not be made: ${await new Response(proc.stderr).text()}`)
    await Bun.write(`${made}.json`, JSON.stringify({from}, null, 2))
    return target
}

export async function renderStartFrame(r: Renderer, request: StartFrameRequest, size: PixelSize) {
    const file = startFrameFile(request.clip, request.shot)
    if (request.megapixels > START_PICTURE_MEGAPIXELS)
        log.warn(
            `${file}: its people alone are ${request.megapixels} MP of reference pictures (the budget is ${START_PICTURE_MEGAPIXELS}) - a 32 GB Radeon runs out of memory on that; a card with more room may draw it`,
        )
    const target = join(r.projectDir, file)
    const references = await Promise.all(request.pictures.map(picture => startReference(r.projectDir, picture)))
    const spec: RenderSpec = {
        kind: 'startframe',
        id: `${request.clip}-shot${request.shot + 1}`,
        parts: [request.prompt, size, START_FRAME_WORKFLOW, references.map(ref => fileFingerprint(join(r.projectDir, ref)))],
    }
    const current = specId(spec)
    if (existsSync(target) && !r.staleFile('startframes', file, current, [file, `${file}.json`])) return log.step('Exists', styles.muted(file))
    mkdirSync(dirname(target), {recursive: true})
    const {seed} = await r.render({label: `start picture ${spec.id}`, spec, kind: 'picture', workflow: START_FRAME_WORKFLOW}, target, '.png', async () => {
        const seed = resolveSeed(r.config.seed)
        const remote = references.map(ref => `${r.remoteDir}/${ref}`)
        const result = h3StartFrame({prompt: request.prompt, seed, pictures: remote, size, filenamePrefix: `${r.remoteDir}/startframes/${spec.id}`})
        return {result, uploads: references.map((ref, i) => ({from: join(r.projectDir, ref), to: remote[i]!})), meta: {seed}}
    })
    await Bun.write(
        `${target}.json`,
        JSON.stringify(
            {workflow: START_FRAME_WORKFLOW, seed, size, at: request.at, prompt: request.prompt, pictures: references, fingerprint: current},
            null,
            2,
        ),
    )
    log.step('Saved', `${file} ${styles.muted(r.took(target))}`)
}
