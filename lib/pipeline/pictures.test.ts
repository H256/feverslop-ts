import {expect, test} from 'bun:test'
import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import type {PictureJob, Renderer} from '../render.ts'
import {renderPictures, type PictureRun} from './pictures.ts'

const job = (id: string, more: Partial<PictureJob & {baseId: string}> = {}) => ({
    kind: 'character' as const,
    id,
    name: id,
    file: `assets/characters/${id}.png`,
    prompt: `a picture of ${id}`,
    description: id,
    ...more,
})

const fakeRenderer = () => {
    const rendered: {id: string; seed?: number}[] = []
    const record = async (p: PictureJob) => void rendered.push({id: p.id, ...(p.seed === undefined ? {} : {seed: p.seed})})
    return {rendered, renderer: {renderPicture: record, renderSequenceSheet: record} as unknown as Renderer}
}

const run = (dir: string, more: Partial<PictureRun> = {}): PictureRun => ({
    dir,
    config: {sequenceSheets: false, sequenceWorkflow: 'seq.json', imageWorkflow: 'image.json', imageResolution: '1024x1024', seed: -1, renderEngine: 'comfy'},
    servers: [],
    render: new Set(['images']),
    only: new Set(),
    args: {again: false, 'new-anchor': false},
    ...more,
})

// #1149: the music video and the film render their pictures the same way - a character's other look after it, with its seed
test('another look of a character is drawn after the character, with its seed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pictures-'))
    mkdirSync(join(dir, 'assets', 'characters'), {recursive: true})
    writeFileSync(join(dir, 'assets', 'characters', 'mira.png.json'), JSON.stringify({seed: 4242}))
    const {rendered, renderer} = fakeRenderer()
    await renderPictures(renderer, [job('mira-winter', {baseId: 'mira'}), job('mira'), job('ben')], run(dir))
    expect(rendered).toEqual([{id: 'mira'}, {id: 'ben'}, {id: 'mira-winter', seed: 4242}])
})

test('--only picks the pictures, --picture-prompt goes with one of them', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pictures-'))
    const {rendered, renderer} = fakeRenderer()
    await renderPictures(renderer, [job('mira'), job('ben')], run(dir, {only: new Set(['ben'])}))
    expect(rendered).toEqual([{id: 'ben'}])
    writeFileSync(join(dir, 'prompt.txt'), 'another prompt')
    await expect(
        renderPictures(renderer, [job('mira'), job('ben')], run(dir, {args: {again: false, 'new-anchor': false, 'picture-prompt': join(dir, 'prompt.txt')}})),
    ).rejects.toThrow('--picture-prompt goes with one picture in --only')
})
