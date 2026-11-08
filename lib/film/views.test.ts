import {describe, expect, test} from 'bun:test';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {extraViews, nextViewNumber, viewRoute} from './views.ts';
import {sequenceSheetDir, sheetViews} from '../sequenceSheet.ts';

test('unusable extra-view sidecars do not hide valid views (#654)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'extra-views-'))
    try {
        const folder = join(dir, sheetViews(sequenceSheetDir('location', 'stage')))
        mkdirSync(folder, {recursive: true})
        for (const n of [6, 7, 8, 9]) writeFileSync(join(folder, `view-${n}.png`), 'picture')
        writeFileSync(join(folder, 'view-7.png.json'), '{')
        writeFileSync(join(folder, 'view-8.png.json'), JSON.stringify({name: 42}))
        writeFileSync(join(folder, 'view-9.png.json'), JSON.stringify({name: 'rear', shows: 'door'}))
        expect(extraViews(dir, 'stage').map(({name, shows}) => ({name, shows}))).toEqual([{name: 'rear', shows: 'door'}])
    } finally { rmSync(dir, {recursive: true, force: true}) }
})
test('new view numbers start after the sheet and preserve surviving views after deletion', () => {
    const dir = mkdtempSync(join(tmpdir(), 'view-number-'))
    try {
        expect(nextViewNumber(dir, 'stage')).toBe(6)
        const folder = join(dir, sheetViews(sequenceSheetDir('location', 'stage')))
        mkdirSync(folder, {recursive: true})
        for (const n of [6, 7]) writeFileSync(join(folder, `view-${n}.png`), 'kept')
        rmSync(join(folder, 'view-6.png'))
        expect(nextViewNumber(dir, 'stage')).toBe(8)
    } finally { rmSync(dir, {recursive: true, force: true}) }
})

describe('one more view of a place (#532)', () => {
    const from = {name: 'from the stage, looking out over the seats', shows: 'the empty seats'}
    const to = {name: 'behind the stage', shows: 'the back wall and the stage door'}
    test('a view that looks back the other way is reached in two moves, through a view in between', async () => {
        const between = {name: 'in the left wing, looking across the stage', shows: 'the bare stage from the side'}
        expect(await viewRoute('a dark theatre', from, to, async () => ({turn: 'reverse', between}))).toEqual({steps: [between, to], turn: 'reverse'})
    })
    test('a view up to a quarter turn away, or an answer that cannot be read, is one move', async () => {
        expect((await viewRoute('a dark theatre', from, to, async () => ({turn: 'side'}))).steps).toEqual([to])
        expect((await viewRoute('a dark theatre', from, to, async () => ({turn: 'reverse'}))).steps).toEqual([to])
        expect(await viewRoute('a dark theatre', from, to, async () => { throw new Error('no server') })).toEqual({steps: [to], turn: 'unknown'})
    })
})
