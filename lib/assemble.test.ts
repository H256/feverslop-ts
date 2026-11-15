import {describe, expect, test} from 'bun:test'
import {framesOnGrid} from './assemble.ts'

describe('framesOnGrid', () => {
    test('a clip at the target frame rate keeps its frames', () => {
        expect(framesOnGrid({frames: 96, fps: 24})).toBe(96)
    })
    test('a 12 fps clip fills twice as many frames of the 24 fps grid', () => {
        expect(framesOnGrid({frames: 48, fps: 12})).toBe(96)
    })
    test('a higher frame rate is counted down to the grid', () => {
        expect(framesOnGrid({frames: 192, fps: 48})).toBe(96)
    })
})

describe('assembleFinal with interpolated clips', () => {
    test('clips at 120 fps (x5) become a 60 fps video of the same length, the song under it', async () => {
        const {mkdtempSync} = await import('node:fs')
        const {tmpdir} = await import('node:os')
        const {join} = await import('node:path')
        const {assembleFinal, probeVideo} = await import('./assemble.ts')
        const dir = mkdtempSync(join(tmpdir(), 'fps-'))
        const {ffmpegMake: make, testVideo} = await import('./test-media.ts')
        // two clips of 24 and 48 frames, interpolated x5: 120 and 240 frames at 120 fps (one frame more than needed in the first)
        await testVideo(join(dir, 'a.mp4'), {frames: 121, fps: 120})
        await testVideo(join(dir, 'b.mp4'), {frames: 240, fps: 120})
        await make(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', join(dir, 'song.wav')])
        const clips = [
            {id: 'a', frames: 24, frameStart: 0},
            {id: 'b', frames: 48, frameStart: 24},
        ] as never
        const target = join(dir, 'out.mp4')
        const result = await assembleFinal({
            clips,
            projectDir: dir,
            songFile: join(dir, 'song.wav'),
            songAudio: true,
            target,
            interpolated: {files: [join(dir, 'a.mp4'), join(dir, 'b.mp4')], multiplier: 5, fps: 60},
        })
        const info = await probeVideo(target)
        expect(info.fps).toBe(60)
        expect(info.frames).toBe(180)
        expect(result.seconds).toBe(3)
        expect(info.hasAudio).toBe(true)
    })
})

describe('assembleFinal with very many clips (#992)', () => {
    test('400 clips: the filter graph is more than a Windows command line holds - it goes through a file', async () => {
        const {mkdtempSync, existsSync} = await import('node:fs')
        const {tmpdir} = await import('node:os')
        const {join} = await import('node:path')
        const {assembleFinal, probeVideo} = await import('./assemble.ts')
        const dir = mkdtempSync(join(tmpdir(), 'many-'))
        const {ffmpegMake: make, testVideo} = await import('./test-media.ts')
        await testVideo(join(dir, 'c.mp4'), {frames: 8})
        await make(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=80', join(dir, 'song.wav')])
        const count = 400
        const clips = Array.from({length: count}, (_, i) => ({id: `c${i}`, frames: 4, frameStart: i * 4})) as never
        const target = join(dir, 'out.mp4')
        await assembleFinal({
            clips,
            projectDir: dir,
            songFile: join(dir, 'song.wav'),
            songAudio: true,
            target,
            interpolated: {files: Array.from({length: count}, () => join(dir, 'c.mp4')), multiplier: 1, fps: 24},
        })
        expect((await probeVideo(target)).frames).toBe(count * 4)
        expect(existsSync(`${target}.filters.txt`)).toBe(false)
    }, 60_000)
})

describe('trimHead', () => {
    test('cuts the first frames off a clip, the sound with them', async () => {
        const {mkdtempSync} = await import('node:fs')
        const {tmpdir} = await import('node:os')
        const {join} = await import('node:path')
        const {probeVideo, trimHead} = await import('./assemble.ts')
        const video = join(mkdtempSync(join(tmpdir(), 'trim-')), 'clip.mp4')
        const p = Bun.spawn(
            [
                'ffmpeg',
                '-v',
                'error',
                '-y',
                '-f',
                'lavfi',
                '-i',
                'testsrc=size=64x36:rate=24',
                '-f',
                'lavfi',
                '-i',
                'sine=duration=3',
                '-frames:v',
                '61',
                '-pix_fmt',
                'yuv420p',
                '-c:a',
                'aac',
                '-shortest',
                video,
            ],
            {stderr: 'pipe'},
        )
        expect(await p.exited).toBe(0)
        await trimHead(video, 22)
        const info = await probeVideo(video)
        expect(info.frames).toBe(39)
        expect(info.hasAudio).toBe(true)
    })
})
