import {expect, test} from "bun:test";
import {clipsGoingOn, renderAll} from "./batch.ts";

test('clips going on from a selected clip are named, through a whole chain, unless they are selected too', () => {
    const clips = [{id: 'a'}, {id: 'b', startsFrom: 'a'}, {id: 'c', startsFrom: 'b'}, {id: 'd'}, {id: 'e', startsFrom: 'd'}]
    const [a, b, c, d] = clips
    expect(clipsGoingOn([a!], clips)).toEqual(['b', 'c'])
    expect(clipsGoingOn([a!, b!], clips)).toEqual(['c'])
    expect(clipsGoingOn([a!, c!], clips)).toEqual(['b'])
    expect(clipsGoingOn([d!, a!], clips)).toEqual(['e', 'b', 'c'])
    expect(clipsGoingOn([c!], clips)).toEqual([])
})

test('the failure names each failed render by the first line of its error', async () => {
    const failing = (message: string) => () => Promise.reject(new Error(message))
    const items = [failing('clip slot-001: out of memory\nTIPS: a long tip'), failing('clip slot-002: gone'), () => Promise.resolve()]
    const message = await renderAll(items, item => item()).catch((e: Error) => e.message)
    expect(message).toContain('2 of 3 renders failed')
    expect(message).toContain('clip slot-001: out of memory')
    expect(message).toContain('clip slot-002: gone')
    expect(message).not.toContain('TIPS')
})
