import {expect, test} from 'bun:test';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {archiveFiles, clipVersions, restoreClipVersion} from './archive.ts';

test('size-rejected takes can be listed and restored with their metadata (#661)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'size-archive-'))
    try {
        mkdirSync(join(dir, 'videos'))
        writeFileSync(join(dir, 'videos/slot-001.mp4'), 'wrong-size')
        writeFileSync(join(dir, 'videos/slot-001.mp4.json'), JSON.stringify({size: '64x64', seed: 7}))
        archiveFiles(dir, 'size-20261108-120000-videos-slot-001.mp4', ['videos/slot-001.mp4', 'videos/slot-001.mp4.json'])
        const versions = clipVersions(dir, 'slot-001')
        expect(versions).toHaveLength(1)
        expect(versions[0]).toMatchObject({source: 'size', size: '64x64', seed: 7})
        restoreClipVersion(dir, 'slot-001', versions[0]!.id)
        expect(readFileSync(join(dir, 'videos/slot-001.mp4'), 'utf8')).toBe('wrong-size')
    } finally { rmSync(dir, {recursive: true, force: true}) }
})
