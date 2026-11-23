// The head pass of a start picture (#1187, config.startFrameFaces): MiniMax H3-Image draws faces of its own - Maren of
// tides-261115 came out younger, rounder and blond instead of silver - and a picture pinned at a shot's first frame hands its
// faces to the clip: the second pass at denoise 0.2 does not bring the person's face back. So each person's head is found in
// the picture by the vision model, cut out with room around it, drawn again by H3-Image after the person's portrait, and put
// back with a soft edge. By hand on slot-033 (2026-11-20) it brought Maren's face, age and hair back.
//
// The model reads the picture, the code only counts: where a head is comes as a box from the vision model, next to each
// person's reference picture and with where the shot plan puts them as a hint. The head, not the face: the hair is part of
// who they are, and it was what came out wrong. Tried on the four start pictures of slot-033: llm2 (Qwen3.8-27B) put all 13
// boxes on the right heads; llm3 (iq3_s) put one off the grid (x 1120) and one above the drummer.

import {askJson, type AskOptions} from './llm.ts'

export type HeadPerson = {id: string; name: string; reference: string; where?: string}
/** A head in the picture, on a 0-1000 grid of its width and height. */
export type HeadBox = {id: string; name: string; box: [number, number, number, number]}

/** The heads of the people in a picture (picture and references as data URLs). A box that is not on the grid is left out. */
export async function headBoxes(picture: string, people: HeadPerson[], ask: <T>(options: AskOptions) => Promise<T> = askJson): Promise<HeadBox[]> {
    if (!people.length) return []
    const answer = await ask<{heads?: {name?: unknown; box?: unknown}[]}>({
        maxTokens: 4096,
        images: [picture, ...people.map(p => p.reference)],
        input: `The first image is one picture of a music video. Each image after it shows one person: ${people.map((p, n) => `image ${n + 2} ${p.name}`).join(', ')}.
${people.some(p => p.where) ? `Where the shot plan puts them in the picture (a hint - the picture decides): ${people.map(p => `${p.name}: ${p.where ?? 'not said'}`).join('; ')}.\n` : ''}For each of these people who is in the first image, give the box around their whole head in the first image - from the top of the hair to the chin, and as wide as the head and the hair beside the face - as [x1, y1, x2, y2] on a 0-1000 grid of its width and height. Leave out who is not in it, and who is seen only from behind; crowds are not listed.
Answer only with JSON: {"heads": [{"name": "...", "box": [x1, y1, x2, y2]}]}`,
        instructions: 'You locate heads in pictures. Answer only with JSON.',
        schema: {
            type: 'object',
            additionalProperties: false,
            required: ['heads'],
            properties: {
                heads: {
                    type: 'array',
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['name', 'box'],
                        properties: {
                            name: {type: 'string', enum: people.map(p => p.name)},
                            box: {type: 'array', minItems: 4, maxItems: 4, items: {type: 'integer'}},
                        },
                    },
                },
            },
        },
    })
    const seen = new Set<string>()
    return (answer.heads ?? []).flatMap(h => {
        const person = people.find(p => p.name === h.name)
        const box = Array.isArray(h.box) ? h.box.map(Number) : []
        const [x1, y1, x2, y2] = box as [number, number, number, number]
        // off the grid, turned round or a second box for the same person: left out, that head keeps what the picture drew
        if (!person || seen.has(person.id) || box.length !== 4 || box.some(v => !Number.isFinite(v) || v < 0 || v > 1000) || x2 <= x1 || y2 <= y1) return []
        seen.add(person.id)
        return [{id: person.id, name: person.name, box: [x1, y1, x2, y2] as HeadBox['box']}]
    })
}

/** A part of the picture in pixels. */
export type Area = {x: number; y: number; w: number; h: number}

/**
 * The part around a head that is drawn again: a square of HEAD_ROOM times the head's larger side, a little lower than the
 * head (the neck and the long hair below it), moved inside the picture where it would go over its edge. Under MIN_HEAD
 * pixels high a head is left as it is - upscaled that far, the picture model has nothing to keep of the pose.
 */
export const HEAD_ROOM = 2.2
export const MIN_HEAD = 40
export function headArea(box: HeadBox['box'], size: {width: number; height: number}): Area | undefined {
    const [x1, y1, x2, y2] = [(box[0] / 1000) * size.width, (box[1] / 1000) * size.height, (box[2] / 1000) * size.width, (box[3] / 1000) * size.height]
    if (y2 - y1 < MIN_HEAD) return undefined
    const side = Math.min(Math.round(Math.max(x2 - x1, y2 - y1) * HEAD_ROOM), size.width, size.height)
    const cx = (x1 + x2) / 2
    const cy = (y1 + y2) / 2 + (y2 - y1) * 0.25
    const clamp = (v: number, max: number) => Math.max(0, Math.min(Math.round(v), max))
    // even numbers: ffmpeg's crop and overlay of a yuv picture round odd ones
    const even = (v: number) => v - (v % 2)
    return {x: even(clamp(cx - side / 2, size.width - side)), y: even(clamp(cy - side / 2, size.height - side)), w: even(side), h: even(side)}
}

/**
 * How the head drawn again is laid over the one it replaces, both boxes in pixels of the cut-out: scaled by `scale` and put
 * with its top left corner at (x, y). H3-Image does not keep the framing of what it edits - on slot-033 shot 3 it drew Sera's
 * head higher up in the square, and put back as it came, the picture had her head twice. A head moved further than SHIFT of its
 * size, or grown or shrunk past SCALE, is not the same head any more: none, the picture keeps what it drew.
 */
export const HEAD_SHIFT = 0.35
export const HEAD_SCALE = 1.35
export type Box = [number, number, number, number]
export function headFit(was: Box, now: Box): {scale: number; x: number; y: number} | undefined {
    const [ww, wh, nw, nh] = [was[2] - was[0], was[3] - was[1], now[2] - now[0], now[3] - now[1]]
    const scale = Math.sqrt((ww * wh) / (nw * nh))
    if (scale > HEAD_SCALE || scale < 1 / HEAD_SCALE) return undefined
    const centre = (b: Box) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] as const
    const [[wx, wy], [nx, ny]] = [centre(was), centre(now)]
    if (Math.hypot(wx - nx, wy - ny) > HEAD_SHIFT * Math.max(ww, wh)) return undefined
    return {scale, x: Math.round(wx - nx * scale), y: Math.round(wy - ny * scale)}
}

/**
 * What H3-Image is asked to do with the cut-out head (<Picture 1>) and the person's portrait (<Picture 2>). The mouth is said, from
 * the shot plan: told only to keep the expression of <Picture 1>, Maren singing in slot-033 came back with the closed mouth of
 * her portrait.
 */
export function headEditPrompt(name: string, sings = false): string {
    const mouth = sings ? 'singing, the mouth wide open as in <Picture 1>' : 'the mouth closed'
    return `Edit <Picture 1>: the head of ${name}, the person in the middle of <Picture 1>, becomes exactly the head of the person in <Picture 2> - the same face shape, nose, eyes, brows, lips, skin, age, and the same hair color, length and style - seen at the angle and in the light of <Picture 1>, with the expression of <Picture 1>, not the calm one of <Picture 2>: ${mouth}. The head stays exactly where and as big as it is in <Picture 1>. Everything else in <Picture 1> stays exactly as it is: the body, the costume, the hands, whatever they hold, the background and the framing.`
}
