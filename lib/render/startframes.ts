import {copyFileSync, existsSync, mkdirSync, renameSync} from 'node:fs'
import {basename, dirname, extname, join, relative} from 'node:path'
import {visionUrls} from '../describe-picture.ts'
import {countPeople, describeCounts, notOnce} from '../startframe-check.ts'
import {type Box, headArea, headBoxes, headEditPrompt, headFit, type HeadBox} from '../startframe-faces.ts'
import {messageOf} from '../text.ts'
import {resolveSeed, type PixelSize} from '../../comfy/helpers.ts'
import h3StartFrame from '../../comfy/workflows/h3-startframe.ts'
import {pictureAsset} from '../compose.ts'
import {log, styles} from '../log.ts'
import {fileFingerprint, freshness} from '../provenance.ts'
import {type RenderSpec, specId} from '../render-spec.ts'
import type {Renderer} from '../render.ts'
import {CHARACTER_SHEET_VIEWS, sequenceSheetDir, sheetFrame, sheetLayout} from '../sequenceSheet.ts'
import {START_PICTURE_MEGAPIXELS, type StartFrameRequest, type StartPicture} from '../startframe-prompt.ts'

// The start pictures of the shots (#1187, lib/startframe-prompt.ts): one MiniMax H3-Image still per shot, in startframes/, made
// only with --render=startframes. What each picture is made from is in its sidecar, like every other render (lib/provenance.ts).

export const START_FRAME_WORKFLOW = 'h3-startframe'
import {startFrameFile} from '../shot-pictures.ts'
export {startFrameFile}
const START_CHECK_WIDTH = 1280
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

// the head pass (config.startFrameFaces, lib/startframe-faces.ts): the picture as it was drawn, and the heads cut out and drawn again
const RAW = 'startframes/raw'
const HEADS = 'startframes/heads'
const HEAD_SIZE: PixelSize = {width: 1024, height: 1024}
// the edited head is put back in an ellipse HEAD_OVAL times its box, opaque to 1 - HEAD_FEATHER of it and fading out to its rim: only
// the head - the square around it, put back whole, brought the edit's own shoulders and background along
const HEAD_OVAL = 1.4
const HEAD_FEATHER = 0.3

/**
 * A person's reference for the head pass: the 2x2 turnaround grid of their own sheet - face close-up, front, side and back - also
 * where the start picture took the front view alone; else the reference picture the start picture took. The face close-up alone
 * gave every head the size and the straight-on look of a portrait (slot-001 shot 1: four heads too big, all looking at the camera).
 */
async function portraitOf(projectDir: string, picture: StartPicture, reference: string) {
    if (!picture.small) return reference
    return startReference(projectDir, {kind: picture.kind, id: picture.id, file: picture.file, label: picture.label})
}

async function ffmpeg(args: string[], what: string) {
    const proc = Bun.spawn(['ffmpeg', '-v', 'error', '-y', ...args], {stderr: 'pipe'})
    if ((await proc.exited) !== 0) throw new Error(`${what}: ${await new Response(proc.stderr).text()}`)
}

/**
 * Each person's head in the start picture found by the vision model, drawn again by H3-Image after their portrait and put back.
 * Works on the picture as it was drawn (kept in startframes/raw/), so a pass again starts from the same picture. A person seen
 * from behind, a crowd, a head the model did not find or too small to draw again keeps what the picture has.
 */
async function headPass(r: Renderer, request: Omit<StartFrameRequest, 'lighter'>, references: string[], size: PixelSize, id: string, seed: number) {
    const file = startFrameFile(request.clip, request.shot)
    const target = join(r.projectDir, file)
    const people = request.pictures.flatMap((picture, i) =>
        picture.kind === 'character' && !picture.group && !picture.hidden ? [{picture, reference: references[i]!}] : [],
    )
    if (!people.length) return []
    const raw = join(r.projectDir, RAW, basename(file))
    mkdirSync(dirname(raw), {recursive: true})
    copyFileSync(target, raw)
    let boxes: HeadBox[]
    try {
        const [picture] = await visionUrls([raw], START_CHECK_WIDTH)
        const refs = await visionUrls(people.map(p => join(r.projectDir, p.reference)))
        boxes = await headBoxes(
            picture!,
            people.map(({picture: p}, n) => ({id: p.id, name: p.name ?? p.id, reference: refs[n]!, ...(p.where ? {where: p.where} : {})})),
        )
    } catch (e) {
        log.warn(`${file}: the heads could not be found (${messageOf(e)}) - the connected model may not take images; the picture stays as drawn`)
        return []
    }
    const missed = people.filter(p => !boxes.some(b => b.id === p.picture.id)).map(p => p.picture.name ?? p.picture.id)
    if (missed.length) log.warn(`${file}: no head found for ${missed.join(', ')} - kept as drawn`)
    mkdirSync(join(r.projectDir, HEADS), {recursive: true})
    const done: {id: string; box: HeadBox['box']}[] = []
    for (const box of boxes) {
        const area = headArea(box.box, size)
        if (!area) {
            log.step('Head', styles.muted(`${box.name} in ${file}: too small to draw again - kept as drawn`))
            continue
        }
        const person = people.find(p => p.picture.id === box.id)!
        const portrait = await portraitOf(r.projectDir, person.picture, person.reference)
        const crop = `${HEADS}/${id}-${box.id}-crop.png`
        const drawn = `${HEADS}/${id}-${box.id}.png`
        await ffmpeg(
            [
                '-i',
                raw,
                '-vf',
                `crop=${area.w}:${area.h}:${area.x}:${area.y},scale=${HEAD_SIZE.width}:${HEAD_SIZE.height}:flags=lanczos`,
                join(r.projectDir, crop),
            ],
            `the head of ${box.name} could not be cut out of ${file}`,
        )
        const prompt = headEditPrompt(box.name, !!person.picture.sings)
        const spec: RenderSpec = {
            kind: 'startframe',
            id: `${id}-head-${box.id}`,
            parts: [prompt, HEAD_SIZE, START_FRAME_WORKFLOW, fileFingerprint(join(r.projectDir, crop)), fileFingerprint(join(r.projectDir, portrait)), seed],
        }
        await r.freeMemory()
        await r.render(
            {label: `head of ${box.name} in ${id}`, spec, kind: 'picture', workflow: START_FRAME_WORKFLOW},
            join(r.projectDir, drawn),
            '.png',
            async () => {
                const remote = [crop, portrait].map(f => `${r.remoteDir}/${f}`)
                const result = h3StartFrame({prompt, seed, pictures: remote, size: HEAD_SIZE, filenamePrefix: `${r.remoteDir}/${HEADS}/${spec.id}`})
                return {result, uploads: [crop, portrait].map((f, i) => ({from: join(r.projectDir, f), to: remote[i]!})), meta: {seed}}
            },
        )
        // where the head is in the edit: laid over where it was, or - moved or resized too far - not put back at all. Both found in
        // the cut-out at the same size: the box in the whole picture is rough for a small head - Maren in the wide slot-001 shot 1
        // came twice as big as in the cut-out, and every head was turned down
        const px = (v: number, of: number, from: number) => (v / 1000) * of - from
        let was: Box = [
            px(box.box[0], size.width, area.x),
            px(box.box[1], size.height, area.y),
            px(box.box[2], size.width, area.x),
            px(box.box[3], size.height, area.y),
        ]
        let fit: ReturnType<typeof headFit>
        try {
            const [before, edited, face] = await visionUrls(
                [join(r.projectDir, crop), join(r.projectDir, drawn), join(r.projectDir, portrait)],
                HEAD_SIZE.width,
            )
            const inCrop = async (picture: string) =>
                (await headBoxes(picture, [{id: box.id, name: box.name, reference: face!}]))[0]?.box.map(v => (v / 1000) * area.w) as Box | undefined
            was = (await inCrop(before!)) ?? was
            const now = await inCrop(edited!)
            fit = now && headFit(was, now)
        } catch (e) {
            log.warn(`${file}: the head of ${box.name} could not be found in its edit (${messageOf(e)}) - kept as drawn`)
            continue
        }
        if (!fit) {
            log.warn(`${file}: ${box.name}'s head moved or changed size in its edit (${drawn}) - kept as drawn`)
            continue
        }
        const side = Math.round(area.w * fit.scale)
        const [cx, cy] = [(was[0] + was[2]) / 2 - fit.x, (was[1] + was[3]) / 2 - fit.y]
        const [rx, ry] = [((was[2] - was[0]) / 2) * HEAD_OVAL, ((was[3] - was[1]) / 2) * HEAD_OVAL]
        const alpha = `255*clip((1-hypot((X-${cx.toFixed(1)})/${rx.toFixed(1)},(Y-${cy.toFixed(1)})/${ry.toFixed(1)}))/${HEAD_FEATHER},0,1)`
        const next = `${target}.head.png`
        await ffmpeg(
            [
                '-i',
                target,
                '-i',
                join(r.projectDir, drawn),
                '-filter_complex',
                `[1]scale=${side}:${side}:flags=lanczos,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${alpha}'[head];[0][head]overlay=${area.x + fit.x}:${area.y + fit.y}`,
                next,
            ],
            `the head of ${box.name} could not be put back into ${file}`,
        )
        renameSync(next, target)
        done.push({id: box.id, box: box.box})
        log.step('Head', `${box.name} in ${file} ${styles.muted(`drawn again after ${portrait}`)}`)
    }
    return done
}

/** The heads done, in the start picture's sidecar: a picture with them is not passed again. */
async function noteHeads(target: string, heads: {id: string; box: HeadBox['box']}[]) {
    const sidecar = `${target}.json`
    const record = existsSync(sidecar) ? ((await Bun.file(sidecar).json()) as Record<string, unknown>) : {}
    await Bun.write(sidecar, JSON.stringify({...record, heads}, null, 2))
}

async function startSpec(r: Renderer, request: Omit<StartFrameRequest, 'lighter'>, size: PixelSize) {
    const references = await Promise.all(request.pictures.map(picture => startReference(r.projectDir, picture)))
    const spec: RenderSpec = {
        kind: 'startframe',
        id: `${request.clip}-shot${request.shot + 1}`,
        parts: [request.prompt, size, START_FRAME_WORKFLOW, references.map(ref => fileFingerprint(join(r.projectDir, ref)))],
    }
    return {references, spec}
}

/**
 * The start picture of a shot. Where the text encoder runs out of memory, the shot is drawn without its prop pictures (the
 * request's lighter one): slot-001 of tides - a place, five people and the drum kit (9.8 MP) with 3490 characters of prompt - ran
 * out of memory on the 32 GB Radeon every time; slot-033 with the same pictures and 3141 characters went through. A picture
 * drawn so is kept in the next run, not tried again with the props.
 */
export async function renderStartFrame(r: Renderer, request: StartFrameRequest, size: PixelSize) {
    const file = startFrameFile(request.clip, request.shot)
    const lighter = request.lighter
    const drawnLighter = async () =>
        !!lighter && existsSync(join(r.projectDir, file)) && freshness(join(r.projectDir, file), specId((await startSpec(r, lighter, size)).spec)) === 'current'
    if (await drawnLighter()) return drawStartFrame(r, lighter!, size)
    try {
        await drawStartFrame(r, request, size)
    } catch (e) {
        if (!lighter || !/out of memory/i.test(messageOf(e))) throw e
        log.warn(`${file}: out of memory with its prop pictures - drawn without them, the props from their words`)
        await r.freeMemory()
        await drawStartFrame(r, lighter, size)
    }
}

async function drawStartFrame(r: Renderer, request: Omit<StartFrameRequest, 'lighter'>, size: PixelSize) {
    const file = startFrameFile(request.clip, request.shot)
    if (request.megapixels > START_PICTURE_MEGAPIXELS)
        log.warn(
            `${file}: its people alone are ${request.megapixels} MP of reference pictures (the budget is ${START_PICTURE_MEGAPIXELS}) - a 32 GB Radeon runs out of memory on that; a card with more room may draw it`,
        )
    const target = join(r.projectDir, file)
    const {references, spec} = await startSpec(r, request, size)
    const current = specId(spec)
    // the head pass of a picture made before it was on is done on that picture, not by drawing it again
    const heads = async (seed: number) => {
        if (r.config.startFrameFaces) await noteHeads(target, await headPass(r, request, references, size, spec.id, seed))
    }
    if (existsSync(target) && !r.staleFile('startframes', file, current, [file, `${file}.json`])) {
        log.step('Exists', styles.muted(file))
        const record = existsSync(`${target}.json`) ? ((await Bun.file(`${target}.json`).json()) as {seed?: number; heads?: unknown}) : {}
        if (r.config.startFrameFaces && !record.heads) await heads(record.seed ?? resolveSeed(r.config.seed))
        return
    }
    mkdirSync(dirname(target), {recursive: true})
    const draw = async (forced?: number) => {
        const {seed} = await r.render({label: `start picture ${spec.id}`, spec, kind: 'picture', workflow: START_FRAME_WORKFLOW}, target, '.png', async () => {
            const seed = forced ?? resolveSeed(r.config.seed)
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
        return seed
    }
    const seed = await draw()
    await heads(seed)
    // everybody once (lib/startframe-check.ts): a person drawn twice or missing is drawn so in the whole shot. "qaRetries" draws
    // such a picture again with another seed, as it renders a black or standing clip again; the take before goes to old/qa/
    const people = request.pictures.flatMap((p, i) => (p.kind === 'character' && !p.group ? [{id: p.id, name: p.name ?? p.id, reference: references[i]!}] : []))
    const check = async () => {
        try {
            // the picture wide enough for the small people of a wide shot: at 512 px Sera drawn twice was read as once (slot-033)
            const [picture] = await visionUrls([target], START_CHECK_WIDTH)
            const refs = await visionUrls(people.map(p => join(r.projectDir, p.reference)))
            return notOnce(
                await countPeople(
                    picture!,
                    people.map((p, n) => ({...p, reference: refs[n]!})),
                ),
            )
        } catch (e) {
            log.warn(`${file}: who is in it could not be checked (${messageOf(e)}) - the connected model may not take images`)
            return []
        }
    }
    let wrong = await check()
    for (let k = 1, taken = seed; k <= r.config.qaRetries && wrong.length; k++) {
        const kept = join(r.projectDir, 'old', 'qa', `${spec.id}-seed-${taken}`)
        mkdirSync(kept, {recursive: true})
        for (const suffix of ['', '.json']) renameSync(target + suffix, join(kept, basename(target) + suffix))
        log.warn(
            `${file}: ${describeCounts(wrong)} - drawn again (${k} of ${r.config.qaRetries}); this take is in ${relative(r.projectDir, kept).replace(/\\/g, '/')}`,
        )
        taken = await draw(seed + 7919 * k)
        await heads(taken)
        wrong = await check()
    }
    if (wrong.length)
        log.warn(
            `${file}: ${describeCounts(wrong)}${r.config.qaRetries ? '' : ' - "qaRetries": 1 in config.json draws such a picture again with another seed'}; --again draws it anew`,
        )
}
