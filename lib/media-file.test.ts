import {expect, test} from 'bun:test';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {produceMedia} from './media-file.ts';

test('a failed media writer preserves the old final and removes its partial (#664)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'atomic-media-')), target = join(dir, 'song.wav')
    try {
        writeFileSync(target, 'complete')
        let partial = ''
        await expect(produceMedia(target, async path => {
            partial = path
            writeFileSync(path, 'truncated')
            throw new Error('interrupted')
        })).rejects.toThrow('interrupted')
        expect(readFileSync(target, 'utf8')).toBe('complete')
        expect(existsSync(partial)).toBe(false)
        await produceMedia(target, async path => { writeFileSync(path, 'new complete') })
        expect(readFileSync(target, 'utf8')).toBe('new complete')
    } finally { rmSync(dir, {recursive: true, force: true}) }
})
