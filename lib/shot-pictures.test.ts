import {afterAll, describe, expect, test} from 'bun:test'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {clipSpec} from './render-spec.ts'
import {shotPictures} from './shot-pictures.ts'

const dir = mkdtempSync(join(tmpdir(), 'shot-pictures-'))
mkdirSync(join(dir, 'startframes'))
afterAll(() => rmSync(dir, {recursive: true, force: true}))

const clip = {id: 'slot-033', shots: [{at: 0}, {at: 1.974}, {at: 3.948}]}
const picture = (shot: number, text = 'png') => writeFileSync(join(dir, `startframes/slot-033-shot${shot}.png`), text)

describe('shotPictures', () => {
    test('a shot whose picture is there has it at its first frame; the others are rendered from the words', () => {
        picture(1)
        picture(3)
        expect(shotPictures(clip, dir)).toEqual([
            {shot: 0, file: 'startframes/slot-033-shot1.png', at: 0},
            {shot: 2, file: 'startframes/slot-033-shot3.png', at: 95},
        ])
    })
    test('a clip that goes on from the one before starts on its last frame, not on a picture of its own', () => {
        expect(shotPictures({...clip, startsFrom: 'slot-032'}, dir).map(p => p.shot)).toEqual([2])
    })
})

describe('the request of a clip', () => {
    const config = {videoWorkflow: 'h3-ref2video-prism-2pass', videoResolution: '1280x720', startFrames: true} as Parameters<typeof clipSpec>[2]
    const request = (shots?: {at: number}[]) =>
        clipSpec({id: 'slot-033', prompt: 'p', frames: 194, assets: {pictures: [], audio: []}, ...(shots ? {shots} : {})}, dir, config)
    test('a start picture made again makes the clip stale; a clip without any keeps the request it had', () => {
        const before = JSON.stringify(request(clip.shots))
        picture(3, 'another picture')
        expect(JSON.stringify(request(clip.shots))).not.toBe(before)
        const none = {...request(undefined), id: 'x'}
        expect(JSON.stringify(none.parts)).not.toContain('start pictures')
    })
    test('with "startFrames" off the pictures are not used: the clip keeps the request it had', () => {
        const off = clipSpec({id: 'slot-033', prompt: 'p', frames: 194, shots: clip.shots, assets: {pictures: [], audio: []}}, dir, {...config, startFrames: false})
        expect(JSON.stringify(off.parts)).not.toContain('start pictures')
    })
})
