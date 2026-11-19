import {expect, test} from 'bun:test'
import {existsSync, mkdirSync, mkdtempSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {archiveClip, archivePreview} from '../film/archive.ts'
import {sayStaleClips} from './render-steps.ts'

// #1152: the music video and the film say the stale clips the same way - as ranges - and only --strict stops the run
test('stale clips are said as ranges, an error only with --strict', () => {
    expect(() => sayStaleClips([], true)).not.toThrow()
    expect(() => sayStaleClips(['clip-005', 'clip-006', 'clip-007', 'clip-010'], true)).toThrow(
        '4 clip(s) were made from another prompt, picture or start frame than the plan has now: clip-005-007, clip-010',
    )
    expect(() => sayStaleClips(['slot-001'], false)).not.toThrow()
})

test('--again puts a clip or its preview away, each with its own files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'archive-'))
    for (const folder of ['videos', 'previews']) {
        mkdirSync(join(dir, folder), {recursive: true})
        writeFileSync(join(dir, folder, 'slot-001.mp4'), 'video')
        writeFileSync(join(dir, folder, 'slot-001.mp4.json'), '{}')
    }
    archivePreview(dir, 'slot-001', 'stamp')
    expect(existsSync(join(dir, 'previews', 'slot-001.mp4'))).toBe(false)
    expect(existsSync(join(dir, 'videos', 'slot-001.mp4'))).toBe(true)
    archiveClip(dir, 'slot-001', 'stamp')
    expect(existsSync(join(dir, 'videos', 'slot-001.mp4'))).toBe(false)
})
