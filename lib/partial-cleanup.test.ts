import {expect, test} from 'bun:test'
import {existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {sweepPartials} from './partial-cleanup.ts'
test('only stale partials of inactive writers are swept (#659)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'partials-'))
    try {
        mkdirSync(join(dir, 'output'))
        mkdirSync(join(dir, 'assets', 'clips'), {recursive: true})
        const files = [
            'output/final.mp4.partial.mp4',
            'project.json.2147483646.partial',
            `project.json.${process.pid}.partial`,
            'output/final.mp4',
            'output/recent.partial.mp4',
            'output/clip.mp4.pending.json',
            'assets/clips/a_retake_before.partial.png',
            'assets/clips/a_retake.splice.mp4',
            'assets/clips/a_retake.mp4.pending.json.partial',
            'assets/clips/a_retake_before.small.png',
        ]
        for (const file of files) {
            writeFileSync(join(dir, file), 'data')
            if (!file.includes('recent')) utimesSync(join(dir, file), new Date(0), new Date(0))
        }
        expect(sweepPartials(dir)).toBe(6)
        expect([...files.slice(0, 2), ...files.slice(6)].every(file => !existsSync(join(dir, file)))).toBe(true)
        expect(files.slice(2, 6).every(file => existsSync(join(dir, file)))).toBe(true)
    } finally {
        rmSync(dir, {recursive: true, force: true})
    }
})
