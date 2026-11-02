import {expect, test} from 'bun:test';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nextViewNumber} from './views.ts';
import {sequenceSheetDir, sheetViews} from '../sequenceSheet.ts';
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
