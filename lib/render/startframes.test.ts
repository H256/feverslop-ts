import {afterAll, expect, test} from 'bun:test'
import {mkdirSync, mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {probeVideo} from '../assemble.ts'
import {startReference} from './startframes.ts'

const dir = mkdtempSync(join(tmpdir(), 'startframes-'))
afterAll(() => rmSync(dir, {recursive: true, force: true}))
const picture = async (file: string, width: number, height: number) => {
    mkdirSync(join(dir, file, '..'), {recursive: true})
    const proc = Bun.spawn(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=gray:s=${width}x${height}`, '-frames:v', '1', join(dir, file)])
    expect(await proc.exited).toBe(0)
}
const size = async (file: string) => {
    const {width, height} = await probeVideo(join(dir, file))
    return `${width}x${height}`
}

// #1187: MiniMaxH3ImageConditioning brings every picture to a 1024 px short edge - a tall sheet costs many tokens and its faces break
test('a character with a turnaround goes in as a 2x2 grid of its face, front, profile and back; a prop as its middle square', async () => {
    for (const n of [0, 1, 2, 3, 4, 5]) await picture(`assets/sequence/characters/maren/frames/frame_0${n}.png`, 64, 112)
    await picture('assets/characters/maren.png', 32, 84)
    await picture('assets/props/guitar.png', 160, 90)
    await picture('assets/characters/kael.png', 32, 84)
    await picture('assets/characters/maren-wounded.png', 32, 84)

    const grid = await startReference(dir, {kind: 'character', id: 'maren', file: 'assets/characters/maren.png', label: '<Picture 2>'})
    expect(grid).toBe('startframes/refs/character-maren.png')
    expect(await size(grid)).toBe('128x224')
    const square = await startReference(dir, {kind: 'prop', id: 'guitar', file: 'assets/props/guitar.png', label: '<Picture 3>'})
    expect(await size(square)).toBe('90x90')
    // without a turnaround, and another look of a character: the top row of its sheet (front and face); the place as it is
    const kael = await startReference(dir, {kind: 'character', id: 'kael', file: 'assets/characters/kael.png', label: ''})
    expect(kael).toBe('startframes/refs/character-kael.png')
    expect(await size(kael)).toBe('32x28')
    const wounded = await startReference(dir, {kind: 'character', id: 'maren', file: 'assets/characters/maren-wounded.png', label: ''})
    expect(wounded).toBe('startframes/refs/character-maren-wounded.png')
    expect(await size(wounded)).toBe('32x28')
    expect(await startReference(dir, {kind: 'location', id: 'hall', file: 'assets/locations/hall.png', label: ''})).toBe('assets/locations/hall.png')
})
