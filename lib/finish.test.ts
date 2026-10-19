import {describe, expect, test} from "bun:test";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {probeVideo} from "./assemble.ts";
import {finishedName, finishFilter, finishOf, finishProblem, finishVideo, MILD_FINISH} from "./finish.ts";

describe('finish - the light grade and sharpen of the final video', () => {
    test('true is the mild finish, an object replaces only its own fields, false is none', () => {
        expect(finishOf(false)).toBeUndefined()
        expect(finishOf(true)).toEqual(MILD_FINISH)
        expect(finishOf({sharpen: 0.2})).toEqual({...MILD_FINISH, sharpen: 0.2})
    })
    test('the filter chain: levels, contrast and saturation, then CAS - no CAS at strength 0', () => {
        expect(finishFilter(MILD_FINISH)).toBe('colorlevels=rimin=0.025:gimin=0.025:bimin=0.025:rimax=0.98:gimax=0.98:bimax=0.98,eq=contrast=1.03:saturation=1.03,cas=strength=0.4')
        expect(finishFilter({...MILD_FINISH, sharpen: 0})).not.toContain('cas')
    })
    test('values ffmpeg refuses are named - nothing is lowered or raised', () => {
        expect(finishProblem(MILD_FINISH)).toBeUndefined()
        expect(finishProblem({...MILD_FINISH, sharpen: 1.5})).toContain('sharpen must be between 0 and 1')
        expect(finishProblem({...MILD_FINISH, blackLevel: 0.99})).toContain('must be below whiteLevel')
        expect(finishProblem({...MILD_FINISH, contrast: 0})).toContain('contrast must be a positive number')
    })
    test('writes <name>-finished.mp4 next to the video, the same frames and the sound', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'finish-'))
        const video = join(dir, 'song.mp4')
        const p = Bun.spawn(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=64x36:rate=24', '-f', 'lavfi', '-i', 'sine=duration=1', '-frames:v', '24', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video], {stderr: 'pipe'})
        expect(await p.exited).toBe(0)
        const done = await finishVideo(video, MILD_FINISH)
        expect(done).toBe(finishedName(video))
        expect(done.endsWith('song-finished.mp4')).toBe(true)
        const info = await probeVideo(done)
        expect(info.frames).toBe(24)
        expect(info.hasAudio).toBe(true)
    })
})
