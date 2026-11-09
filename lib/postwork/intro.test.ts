import {describe, expect, test} from 'bun:test'
import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {probeVideo} from '../assemble.ts'
import {finalLabel} from '../editor/project.ts'
import {runCommand} from '../editor/runs.ts'
import {introFile, POSTWORK_DEFAULTS, postworkProblem} from './config.ts'
import {introFilter, introProblem, introVideo, type IntroJoin, videoStart} from './intro.ts'

const join16x9: IntroJoin = {width: 1280, height: 720, fps: 24, introSeconds: 3, introAudio: false, videoAudio: true}
const intro = POSTWORK_DEFAULTS.intro

describe('intro - a clip in front of a finished video (#608)', () => {
    test('the intro is made like the video: its frame rate and size, black bars instead of stretching', () => {
        const filter = introFilter(join16x9, intro)
        expect(filter).toContain('[0:v]fps=24,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1')
    })
    test('an intro without sound gets silence of its length; one with sound is cut or filled to it', () => {
        expect(introFilter(join16x9, intro)).toContain('anullsrc=r=48000:cl=stereo,atrim=duration=3.000')
        expect(introFilter({...join16x9, introAudio: true}, intro)).toContain(
            '[0:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration=3.000[ia]',
        )
    })
    test('a hard cut is a concat; a fade overlaps the two, picture and sound', () => {
        expect(introFilter(join16x9, intro)).toEndWith('[iv][ia][mv][ma]concat=n=2:v=1:a=1[v][a]')
        const faded = introFilter(join16x9, {...intro, fade: 0.5})
        expect(faded).toContain('xfade=transition=fade:duration=0.5:offset=2.500[v]')
        expect(faded).toContain('acrossfade=d=0.5')
        expect(videoStart(join16x9, 0.5)).toBe(2.5)
    })
    test("a video without sound stays without: the intro's sound is left out", () => {
        const filter = introFilter({...join16x9, introAudio: true, videoAudio: false}, intro)
        expect(filter).not.toContain('[0:a]')
        expect(filter).toEndWith('[iv][mv]concat=n=2:v=1:a=0[v]')
    })
    test('a fade as long as the intro is refused', () => {
        expect(introProblem(join16x9, {...intro, fade: 3})).toContain('must be shorter than the intro')
        expect(postworkProblem({intro: {fade: 20}})).toContain('postwork.intro.fade must be')
    })
    test('the intro of the project is input/intro.<ext> when no file is set, else the path given', () => {
        const dir = mkdtempSync(join(tmpdir(), 'intro-file-'))
        expect(() => introFile('', dir)).toThrow('put one at input/intro.mp4')
        mkdirSync(join(dir, 'input'))
        writeFileSync(join(dir, 'input', 'intro.mov'), '')
        expect(introFile('', dir)).toBe(join(dir, 'input', 'intro.mov'))
        writeFileSync(join(dir, 'ident.mp4'), '')
        expect(introFile('ident.mp4', dir)).toBe(join(dir, 'ident.mp4'))
        expect(() => introFile('gone.mp4', dir)).toThrow('no file gone.mp4')
    })
    test('the workspace: the command for the page, and the video under the one it was made from', () => {
        expect(runCommand({id: 'demo', kind: 'music'}, {type: 'intro', from: 'demo-labeled.mp4', file: '', fade: 0.5, saveDefault: true})).toEqual({
            script: 'tools/intro.ts',
            args: ['demo', '--from=demo-labeled.mp4', '--file=', '--fade=0.5', '--save-default'],
        })
        expect(() => runCommand({id: 'demo', kind: 'music'}, {type: 'intro', fade: -1})).toThrow('no such fade')
        expect(finalLabel('demo', 'demo-finished-labeled-intro.mp4')).toMatchObject({label: 'Final finished + AI label + intro'})
    })
})

test('writes <name>-intro.mp4: the intro in the size of the video, then the whole video with its sound', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'intro-'))
    const video = join(dir, 'demo.mp4')
    const clip = join(dir, 'intro.mp4')
    const ffmpeg = (...args: string[]) => expect(Bun.spawnSync(['ffmpeg', '-v', 'error', '-y', ...args]).exitCode).toBe(0)
    ffmpeg(
        '-f',
        'lavfi',
        '-i',
        'color=red:s=320x180:r=24:d=2',
        '-f',
        'lavfi',
        '-i',
        'sine=f=440:d=2',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-shortest',
        video,
    )
    // 4:3, 30 fps, no sound
    ffmpeg('-f', 'lavfi', '-i', 'color=white:s=160x120:r=30:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip)
    const done = await introVideo(video, clip, {file: '', fade: 0})
    expect(done.file).toBe(join(dir, 'demo-intro.mp4'))
    const info = await probeVideo(done.file)
    expect({frames: info.frames, width: info.width, height: info.height, fps: info.fps, hasAudio: info.hasAudio}).toEqual({
        frames: 72,
        width: 320,
        height: 180,
        fps: 24,
        hasAudio: true,
    })
    // the bars: the left edge of the intro is black, its middle white; after it the red video
    const pixel = (at: number, x: number) => {
        const out = Bun.spawnSync([
            'ffmpeg',
            '-v',
            'error',
            '-ss',
            String(at),
            '-i',
            done.file,
            '-frames:v',
            '1',
            '-vf',
            `crop=4:4:${x}:88,format=gray,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-`,
            '-f',
            'null',
            '-',
        ])
        return Number(/YAVG=([\d.]+)/.exec(out.stdout.toString())?.[1])
    }
    expect(pixel(0.5, 2)).toBeLessThan(30)
    expect(pixel(0.5, 160)).toBeGreaterThan(200)
    expect(pixel(2, 160)).toBeLessThan(120)
})
