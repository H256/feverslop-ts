import {expect, test} from 'bun:test'
import h3StartFrame from './h3-startframe.ts'

type Node = {class_type: string; inputs: Record<string, unknown>}

// #1187: the clip's pictures as <Picture 1>, <Picture 2>, ... and the text encoder unloaded before the DiT samples - on a 32 GB card
// the two together ran out of memory (Radeon) or hung at step 0 (a 5090 that is also the desktop's card)
test('the start picture: the pictures in order, the encoder unloaded before sampling, at the size asked for', () => {
    const result = h3StartFrame({
        prompt: 'A film still.',
        seed: 7,
        pictures: ['p/hall.png', 'p/maren.png'],
        size: {width: 2048, height: 1152},
        filenamePrefix: 'p/startframes/x',
    })
    const nodes = (result.workflow as unknown as {workflow: Record<string, Node>}).workflow
    const of = (type: string) => Object.entries(nodes).filter(([, n]) => n.class_type === type)
    const [[conditioningId, conditioning]] = of('MiniMaxH3ImageConditioning') as [[string, Node]]
    const image = (n: number) => nodes[(conditioning.inputs[`images.image_${n}`] as [string, number])[0]]!.inputs.image
    expect([image(1), image(2)]).toEqual(['p/hall.png', 'p/maren.png'])
    expect(conditioning.inputs).toMatchObject({width: 2048, height: 1152})
    const [, sampler] = of('KSampler')[0]!
    const positive = nodes[(sampler.inputs.positive as [string, number])[0]]!
    expect(positive.class_type).toBe('VRAMCleanup')
    expect((positive.inputs.anything as [string, number])[0]).toBe(conditioningId)
    expect(sampler.inputs).toMatchObject({seed: 7, steps: 6, cfg: 1})
    expect(result.size).toEqual({width: 2048, height: 1152})
    // the encoder fills a 32 GB card alone: on the CPU, the card is left for the pictures it reads and the DiT
    expect(of('CLIPLoader')[0]![1].inputs.device).toBe('cpu')
})
