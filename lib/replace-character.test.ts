import {expect, test} from 'bun:test'
import {existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {clearSheetOfOldAnchor, renderedClipsWith, replacedPictureFile} from './replace-character.ts'

const inTemp = (run: (dir: string) => void | Promise<void>) => async () => {
    const dir = mkdtempSync(join(tmpdir(), 'replace-character-'))
    try {
        await run(dir)
    } finally {
        rmSync(dir, {recursive: true, force: true})
    }
}
const write = (file: string, text = 'x') => {
    mkdirSync(join(file, '..'), {recursive: true})
    writeFileSync(file, text)
}

test('the new picture is the anchor of the sheet with sequence sheets, else the picture the clips use', () => {
    expect(replacedPictureFile('p', 'thorin', true).replaceAll('\\', '/')).toBe('p/assets/sequence/characters/thorin/anchor.png')
    expect(replacedPictureFile('p', 'thorin', false).replaceAll('\\', '/')).toBe('p/assets/characters/thorin.png')
})

test(
    'the clips named are the rendered ones that have the picture among their references',
    inTemp(async dir => {
        const request = (id: string, pictures: string[]) =>
            write(join(dir, 'output/clips', `${id}.json`), JSON.stringify({assets: {pictures: pictures.map(p => ({id: p}))}}))
        request('clip-002', ['anna', 'ben'])
        request('clip-001', ['anna'])
        request('clip-003', ['ben'])
        request('clip-004', ['anna'])
        for (const id of ['clip-001', 'clip-002', 'clip-003']) write(join(dir, 'videos', `${id}.mp4`))
        expect(await renderedClipsWith(dir, 'anna')).toEqual(['clip-001', 'clip-002'])
        expect(await renderedClipsWith(join(dir, 'nothing'), 'anna')).toEqual([])
    }),
)

test(
    'what the sheet made from the old anchor goes, the anchor and the other characters stay',
    inTemp(dir => {
        const sheet = join(dir, 'assets/sequence/characters/anna')
        for (const file of [
            join(sheet, 'anchor.png'),
            join(dir, 'assets/characters/anna.png'),
            join(dir, 'assets/characters/ben.png'),
            join(sheet, 'frames/frame_00.png'),
        ])
            write(file)
        const changes: string[] = []
        expect(clearSheetOfOldAnchor(dir, 'anna', changes)).toBe(true)
        expect(changes).toEqual(['the old reference sheet and sequence video were archived'])
        expect(Bun.file(join(sheet, 'anchor.png')).size).toBe(1)
        expect(Bun.file(join(dir, 'assets/characters/ben.png')).size).toBe(1)
        expect(existsSync(join(dir, 'assets/characters/anna.png'))).toBe(false)
        const archive = join(dir, 'old/attempts', readdirSync(join(dir, 'old/attempts'))[0]!)
        expect(existsSync(join(archive, 'anna.png'))).toBe(true)
        expect(existsSync(join(archive, 'frames/frame_00.png'))).toBe(true)
        expect(clearSheetOfOldAnchor(dir, 'anna', changes)).toBe(false)
    }),
)
