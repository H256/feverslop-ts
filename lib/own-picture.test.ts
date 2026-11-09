import {describe, expect, test} from 'bun:test'
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {descriptionSlot, hasOwnAnchor, installOwnPicture, ownPictureTarget, takeOwnDescription} from './own-picture.ts'
import {runProcess} from './process.ts'
import {isOwnFile} from './provenance.ts'

const inTemp = (run: (dir: string) => void | Promise<void>) => async () => {
    const dir = mkdtempSync(join(tmpdir(), 'own-picture-'))
    try {
        await run(dir)
    } finally {
        rmSync(dir, {recursive: true, force: true})
    }
}
const anna = {kind: 'character' as const, id: 'anna', file: 'assets/characters/anna.png', name: 'Anna', prompt: 'p', description: 'd'}

describe('where the own picture goes', () => {
    test('the anchor of its sheet, or with no sheets the picture itself', () => {
        expect(ownPictureTarget(anna, true)).toBe('assets/sequence/characters/anna/anchor.png')
        expect(ownPictureTarget(anna, false)).toBe('assets/characters/anna.png')
    })
    test(
        "a picture ffmpeg reads goes in as a PNG of the user's own; anything else is refused",
        inTemp(async dir => {
            const jpeg = join(dir, 'upload.jpg')
            await runProcess(['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=16x16', '-frames:v', '1', jpeg], {errorMessage: err => err})
            const target = await installOwnPicture(anna, dir, true, jpeg)
            const path = join(dir, target)
            expect(readFileSync(path).subarray(1, 4).toString()).toBe('PNG')
            expect(isOwnFile(path)).toBe(true)
            expect(hasOwnAnchor(anna, dir, true)).toBe(true)
            const text = join(dir, 'not-a-picture.png')
            writeFileSync(text, 'hello')
            await expect(installOwnPicture({...anna, id: 'ben'}, dir, true, text)).rejects.toThrow('could not read not-a-picture.png as a picture')
            expect(existsSync(join(dir, 'assets/sequence/characters/ben/anchor.png'))).toBe(false)
        }),
    )
    test(
        'a prop has no picture of its own',
        inTemp(async dir => {
            await expect(installOwnPicture({...anna, kind: 'prop'}, dir, true, 'x.png')).rejects.toThrow('is a prop')
        }),
    )
})

describe('where its description is kept', () => {
    const data = () => ({
        cast: {
            characters: [
                {id: 'anna', name: 'Anna', role: 'singer'},
                {id: 'band', name: 'Band'},
            ],
            locations: [{id: 'bar', name: 'Bar'}],
        },
        characterDescriptions: {anna: 'old anna', band: 'a band', 'anna--wet': 'anna wet'} as Record<string, string>,
        characterDescriptionVariants: undefined as Record<string, string[]> | undefined,
        locationDescriptions: {bar: 'old bar'} as Record<string, string>,
    })
    test("a place and a character under its id, a film's other look under its own id", () => {
        const d = data()
        descriptionSlot(d, 'bar').set('new bar')
        descriptionSlot(d, 'anna').set('new anna')
        descriptionSlot(d, 'anna--wet').set('new wet')
        expect(d.locationDescriptions.bar).toBe('new bar')
        expect(d.characterDescriptions).toEqual({anna: 'new anna', band: 'a band', 'anna--wet': 'new wet'})
        expect(descriptionSlot(d, 'anna').role).toBe('singer')
    })
    test("a member of a music video's group in the variants, the members before it keep the shared one", () => {
        const d = data()
        descriptionSlot(d, 'band-v2').set('the drummer')
        expect(d.characterDescriptionVariants).toEqual({band: ['a band', 'a band', 'the drummer']})
        expect(d.characterDescriptions.band).toBe('a band')
        expect(descriptionSlot(d, 'band-v1').get()).toBe('a band')
    })
    test('what is not planned yet, or not there, is said', () => {
        expect(() => descriptionSlot(data(), 'nobody')).toThrow('no character or place nobody')
        expect(() => descriptionSlot({cast: data().cast}, 'anna')).toThrow('plan up to the look first')
    })
    test('a text given by hand is saved; none given changes nothing', async () => {
        const d = data()
        let saved = 0
        await takeOwnDescription(d, async () => saved++, 'anna', {})
        expect(saved).toBe(0)
        await takeOwnDescription(d, async () => saved++, 'anna', {text: '  a woman in green  '})
        expect(saved).toBe(1)
        expect(d.characterDescriptions.anna).toBe('a woman in green')
    })
})
