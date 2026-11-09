import {describe, expect, test} from 'bun:test'
import {existsSync, mkdtempSync, readFileSync, renameSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {putInPlace} from './video.ts'

describe('the finished video under its name', () => {
    const files = () => {
        const dir = mkdtempSync(join(tmpdir(), 'postwork-video-'))
        const target = join(dir, 'demo-labeled.mp4')
        writeFileSync(target, 'old')
        writeFileSync(`${target}.partial.mp4`, 'new')
        return {target, partial: `${target}.partial.mp4`}
    }
    const busy = (times: number) => {
        let left = times
        return (from: string, to: string) => {
            if (left-- > 0) throw Object.assign(new Error('EPERM: operation not permitted, rename'), {code: 'EPERM'})
            renameSync(from, to)
        }
    }
    test('replaces the one of an earlier run, waiting while another program lets it go', async () => {
        const {target, partial} = files()
        await putInPlace(partial, target, 5, 1, busy(2))
        expect(readFileSync(target, 'utf8')).toBe('new')
        expect(existsSync(partial)).toBe(false)
    })
    test('says it is open elsewhere when it stays so; the old one stays as it was', async () => {
        const {target, partial} = files()
        await expect(putInPlace(partial, target, 3, 1, busy(99))).rejects.toThrow('demo-labeled.mp4 is open in another program')
        expect(readFileSync(target, 'utf8')).toBe('old')
        expect(existsSync(partial)).toBe(false)
    })
    test('another failure is not waited for', async () => {
        const {target, partial} = files()
        const broken = () => {
            throw Object.assign(new Error('ENOSPC'), {code: 'ENOSPC'})
        }
        await expect(putInPlace(partial, target, 5, 1, broken)).rejects.toThrow('ENOSPC')
    })
})
