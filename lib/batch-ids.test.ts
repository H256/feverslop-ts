import {afterAll, describe, expect, test} from 'bun:test'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {unknownIds} from './batch.ts'

// #818: the ids of --only and --retake are checked against the last plan before the first step.
const dir = mkdtempSync(join(tmpdir(), 'ids-'))
const pictures = join(dir, 'output', 'assets.json')
mkdirSync(join(dir, 'output', 'clips'), {recursive: true})
for (const n of [1, 2, 3]) writeFileSync(join(dir, 'output', 'clips', `slot-00${n}.json`), JSON.stringify({id: `slot-00${n}`}))
writeFileSync(pictures, JSON.stringify([{id: 'elias'}, {id: 'the-corridor'}]))
afterAll(() => rmSync(dir, {recursive: true, force: true}))

const ask = (only: string[], what: {pictures?: boolean; clips?: boolean; retake?: string} = {clips: true}) =>
    unknownIds(dir, pictures, {only, pictures: !!what.pictures, clips: !!what.clips, retake: what.retake})

describe('ids checked before the first step', () => {
    test('known ids pass', async () => {
        expect(await ask(['slot-001', 'slot-003'])).toBeUndefined()
        expect(await ask(['elias'], {pictures: true})).toBeUndefined()
        expect(await ask(['elias', 'slot-002'], {pictures: true, clips: true})).toBeUndefined()
    })
    test('a clip that is not there, with the clips there are as a range', async () => {
        expect(await ask(['slot-999'])).toBe('--only: no clip slot-999 in the last plan - the clips are slot-001-003')
    })
    test('a picture that is not there', async () => {
        expect(await ask(['elias', 'nobody'], {pictures: true})).toBe('--only: no picture nobody in the last plan - the pictures are elias, the-corridor')
    })
    test('pictures and clips rendered in one run: either is fine, neither is not', async () => {
        expect(await ask(['slot-999'], {pictures: true, clips: true})).toBe(
            '--only: no clip or picture slot-999 in the last plan - the clips are slot-001-003; the pictures are elias, the-corridor',
        )
    })
    test('the clip of a retake', async () => {
        expect(await ask([], {retake: 'slot-077'})).toBe('--retake: no clip slot-077 in the last plan - the clips are slot-001-003')
        expect(await ask([], {retake: 'slot-002'})).toBeUndefined()
    })
    test('no plan yet: nothing to check against', async () => {
        const empty = mkdtempSync(join(tmpdir(), 'ids-none-'))
        try {
            expect(await unknownIds(empty, join(empty, 'output', 'assets.json'), {only: ['slot-001'], pictures: false, clips: true})).toBeUndefined()
        } finally {
            rmSync(empty, {recursive: true, force: true})
        }
    })
})
