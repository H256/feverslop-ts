import {describe, expect, test} from 'bun:test'
import type {AskOptions} from './llm.ts'
import {headArea, headBoxes, headEditPrompt, headFit, MIN_HEAD} from './startframe-faces.ts'

const people = [
    {id: 'maren', name: 'Maren', reference: 'data:maren', where: 'centre of frame'},
    {id: 'kael', name: 'Kael', reference: 'data:kael', where: 'left of frame'},
    {id: 'vex', name: 'Vex', reference: 'data:vex'},
]
const answering =
    (heads: unknown[], asked: AskOptions[] = []) =>
    async <T>(options: AskOptions): Promise<T> => {
        asked.push(options)
        return {heads} as T
    }

describe('headBoxes', () => {
    test('one call with the picture first, a reference per person and where the plan puts them', async () => {
        const asked: AskOptions[] = []
        await headBoxes('data:picture', people, answering([], asked))
        expect(asked[0]!.images).toEqual(['data:picture', 'data:maren', 'data:kael', 'data:vex'])
        expect(asked[0]!.input).toContain('Maren: centre of frame; Kael: left of frame; Vex: not said')
        expect(asked[0]!.input).toContain('the box around their whole head')
        expect(await headBoxes('data:picture', [], answering([], asked))).toEqual([])
        expect(asked).toHaveLength(1)
    })
    // slot-033 shot 2 on llm3: Vex at x 1120 - off the grid; a box twice for one person, or turned round, is no box either
    test('a box off the 0-1000 grid, turned round, of nobody asked or a second one for the same person is left out', async () => {
        const boxes = await headBoxes(
            'data:picture',
            people,
            answering([
                {name: 'Maren', box: [355, 296, 423, 395]},
                {name: 'Vex', box: [1120, 445, 1185, 540]},
                {name: 'Kael', box: [227, 510, 171, 411]},
                {name: 'Maren', box: [100, 100, 200, 200]},
                {name: 'Nobody', box: [1, 1, 2, 2]},
            ]),
        )
        expect(boxes).toEqual([{id: 'maren', name: 'Maren', box: [355, 296, 423, 395]}])
    })
})

describe('headArea', () => {
    const size = {width: 2048, height: 1152}
    test('a square with room around the head, a little below it, in even pixels', () => {
        // Maren in shot 3: 139 x 114 px
        const area = headArea([355, 296, 423, 395], size)!
        expect(area.w).toBe(area.h)
        expect(area.w).toBeGreaterThanOrEqual(2 * 139)
        expect([area.x, area.y, area.w].every(v => v % 2 === 0)).toBe(true)
        const head = {top: 0.296 * 1152, bottom: 0.395 * 1152}
        // the head in it, more room below than above
        expect(area.y).toBeLessThan(head.top)
        expect(area.y + area.h - head.bottom).toBeGreaterThan(head.top - area.y)
    })
    test('moved inside the picture at its edge; a head too small to draw again has none', () => {
        const atEdge = headArea([960, 0, 1000, 90], size)!
        expect(atEdge.x + atEdge.w).toBeLessThanOrEqual(size.width)
        expect(atEdge.y).toBe(0)
        expect(headArea([500, 500, 510, 500 + Math.floor(((MIN_HEAD - 1) / 1152) * 1000)], size)).toBeUndefined()
    })
})

describe('headFit', () => {
    test('the head of the edit is scaled and moved onto the head it replaces', () => {
        // drawn 10 px higher and a fifth smaller
        const fit = headFit([100, 100, 200, 220], [110, 98, 190, 194])!
        expect(fit.scale).toBeCloseTo(1.25, 2)
        // the middle of the head lands on the middle of the one it replaces, to the pixel
        expect(Math.abs(fit.x + 150 * fit.scale - 150)).toBeLessThanOrEqual(1)
        expect(Math.abs(fit.y + 146 * fit.scale - 160)).toBeLessThanOrEqual(1)
    })
    // slot-001 shot 1: Kael the same size in both to the eye, boxes 0.86 times apart - put back as it is
    test('a head that is where it was, give or take what the boxes vary, is put back as it is', () => {
        expect(headFit([460, 210, 615, 450], [455, 195, 635, 475])).toEqual({scale: 1, x: 0, y: 0})
    })
    // slot-033 shot 3: Sera drawn again far up in her square, put back as it came she had two heads
    test('a head that moved off or changed size too much in the edit is not put back', () => {
        expect(headFit([100, 100, 200, 220], [100, 20, 200, 140])).toBeUndefined()
        expect(headFit([100, 100, 200, 220], [120, 130, 170, 190])).toBeUndefined()
    })
})

test('the edit keeps everything but the head, which takes face and hair from the portrait and the mouth from the plan', () => {
    const prompt = headEditPrompt('Maren')
    expect(prompt).toContain('the head of Maren, the person in the middle of <Picture 1>, becomes exactly the head of the person in <Picture 2>')
    expect(prompt).toContain('the same hair color, length and style')
    expect(prompt).toContain('Everything else in <Picture 1> stays exactly as it is')
    expect(prompt).toContain(': the mouth closed.')
    expect(headEditPrompt('Maren', true)).toContain(': singing, the mouth wide open as in <Picture 1>.')
})
