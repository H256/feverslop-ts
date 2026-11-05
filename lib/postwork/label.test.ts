import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import {mkdtempSync, readFileSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {probeVideo} from "../assemble.ts";
import {runCommand} from "../editor/runs.ts";
import {finalLabel} from "../editor/project.ts";
import {loadProjectConfig} from "../config.ts";
import {markerFile, MARKER_PRESETS, POSTWORK_DEFAULTS, postworkProblem} from "./config.ts";
import {labelEnable, labelFilter, labelPosition, labelVideo} from "./label.ts";
import {loadPostwork, savePostwork, withOptions} from "./store.ts";
import {postworkName, sourceVideo} from "./video.ts";

const label = POSTWORK_DEFAULTS.label

describe('label - the AI marker over a finished video (#607)', () => {
    test('when it shows: the first seconds, the first seconds of every interval, or the whole time', () => {
        expect(labelEnable({...label, mode: 'credits', seconds: 5})).toBe('lt(t,5)')
        expect(labelEnable({...label, mode: 'interval', seconds: 3, interval: 60})).toBe('lt(mod(t,60),3)')
        expect(labelEnable({...label, mode: 'always'})).toBeUndefined()
    })
    test('where it is: a corner, the margin from both of its edges', () => {
        expect(labelPosition('top-right', 20)).toEqual({x: 'W-w-20', y: '20'})
        expect(labelPosition('bottom-left', 8)).toEqual({x: '8', y: 'H-h-8'})
    })
    test('its size and margin are a share of the video height, so it looks the same at any size', () => {
        const filter = labelFilter({...label, size: 6, margin: 3}, 720)
        expect(filter).toContain('scale=-2:44:')
        expect(filter).toContain("overlay=x=W-w-22:y=22:format=auto:enable='lt(t,5)'")
        expect(labelFilter({...label, mode: 'always'}, 1080)).not.toContain('enable')
    })
    test('a preset is an EU icon of the repo, anything else a PNG by its path - relative to the project', () => {
        expect(MARKER_PRESETS).toContain('generated-white')
        for (const preset of MARKER_PRESETS) expect(markerFile(preset, '/nowhere')).toEndWith(`${preset}.png`)
        const dir = mkdtempSync(join(tmpdir(), 'marker-'))
        writeFileSync(join(dir, 'mine.png'), '')
        expect(markerFile('mine.png', dir)).toBe(join(dir, 'mine.png'))
        expect(() => markerFile('missing.png', dir)).toThrow('no file missing.png')
        expect(() => markerFile('icon.svg', dir)).toThrow('no PNG')
    })
    test('settings ffmpeg or the eye would refuse are named, nothing is lowered or raised', () => {
        expect(postworkProblem({label: {size: 6}})).toBeUndefined()
        expect(postworkProblem({label: {size: 80}})).toContain('postwork.label.size must be a percentage')
        expect(postworkProblem({label: {mode: 'sometimes'}})).toContain('must be one of credits, interval, always')
        expect(postworkProblem({label: {colour: 'red'}})).toContain('no such setting')
        expect(postworkProblem({lable: {}})).toContain('no such step')
        expect(() => withOptions('label', label, {seconds: 0})).toThrow('--seconds must be')
        expect(withOptions('label', label, {corner: 'bottom-left', size: undefined})).toEqual({...label, corner: 'bottom-left'})
    })
})

describe('post-work settings: the defaults, the settings file, the project, the options', () => {
    const before = process.env.FEVERSLOP_SETTINGS
    let dir: string
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'postwork-'))
        process.env.FEVERSLOP_SETTINGS = join(dir, 'settings.json')
    })
    afterEach(() => {
        if (before === undefined) delete process.env.FEVERSLOP_SETTINGS
        else process.env.FEVERSLOP_SETTINGS = before
    })
    test('the project beats the settings file, field by field; --save keeps only what was given', async () => {
        writeFileSync(join(dir, 'settings.json'), JSON.stringify({postwork: {label: {marker: 'basic-black', size: 8}}}))
        writeFileSync(join(dir, 'config.json'), JSON.stringify({seed: 7, postwork: {label: {size: 10}}}))
        expect((await loadPostwork(dir)).label).toEqual({...label, marker: 'basic-black', size: 10})
        await savePostwork('project', dir, 'label', {corner: 'bottom-right', seconds: undefined})
        const config = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'))
        expect(config).toEqual({seed: 7, postwork: {label: {size: 10, corner: 'bottom-right'}}})
        // the loader of the project takes the key and checks it
        expect((await loadProjectConfig(dir)).seed).toBe(7)
        writeFileSync(join(dir, 'config.json'), JSON.stringify({postwork: {label: {size: 99}}}))
        await expect(loadProjectConfig(dir)).rejects.toThrow('postwork.label.size')
    })
    test('--save-default writes the settings file, and keeps what else it has', async () => {
        writeFileSync(join(dir, 'settings.json'), JSON.stringify({library: 'D:/lib'}))
        await savePostwork('settings', dir, 'label', {marker: 'modified-black50'})
        expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({library: 'D:/lib', postwork: {label: {marker: 'modified-black50'}}})
    })
})

describe('post-work videos: where a step starts and what it writes', () => {
    test('the finished final video by default, else the final one; --from any video of the project', () => {
        const dir = mkdtempSync(join(tmpdir(), 'source-'))
        expect(() => sourceVideo(dir, 'demo')).toThrow('no final video yet')
        writeFileSync(join(dir, 'demo.mp4'), '')
        expect(sourceVideo(dir, 'demo')).toBe(join(dir, 'demo.mp4'))
        writeFileSync(join(dir, 'demo-finished.mp4'), '')
        expect(sourceVideo(dir, 'demo')).toBe(join(dir, 'demo-finished.mp4'))
        expect(sourceVideo(dir, 'demo', 'demo.mp4')).toBe(join(dir, 'demo.mp4'))
        expect(() => sourceVideo(dir, 'demo', '../other/demo.mp4')).toThrow('not a video of the project')
        expect(() => sourceVideo(dir, 'demo', 'demo-48fps.mp4')).toThrow('there is no demo-48fps.mp4')
        expect(postworkName(join(dir, 'demo-finished.mp4'), 'labeled')).toBe(join(dir, 'demo-finished-labeled.mp4'))
    })
    test('the workspace lists the video of a step under the one it was made from', () => {
        expect(finalLabel('demo', 'demo-labeled.mp4')).toMatchObject({label: 'Final + AI label'})
        expect(finalLabel('demo', 'demo--refine-fullhd-48fps-finished-labeled.mp4')).toMatchObject({label: 'Refinish refine-fullhd 48 fps finished + AI label'})
        expect(finalLabel('demo', 'demo-labeled.mp4.partial.mp4')).toBeUndefined()
        const order = ['demo-48fps.mp4', 'demo-finished-labeled.mp4', 'demo.mp4', 'demo-finished.mp4'].sort((a, b) => finalLabel('demo', a)!.order - finalLabel('demo', b)!.order)
        expect(order).toEqual(['demo.mp4', 'demo-finished.mp4', 'demo-finished-labeled.mp4', 'demo-48fps.mp4'])
    })
    test('the page asks for it by what it should be, and gets the command with nothing else', () => {
        const music = {id: 'demo', kind: 'music' as const, dir: '/x'}
        expect(runCommand(music, {type: 'label', from: 'demo-finished.mp4', marker: 'generated-white', mode: 'interval', seconds: 3, interval: 60, corner: 'top-left', size: 6, margin: 3, save: true}))
            .toEqual({script: 'tools/label.ts', args: ['demo', '--from=demo-finished.mp4', '--marker=generated-white', '--mode=interval', '--corner=top-left', '--seconds=3', '--interval=60', '--size=6', '--margin=3', '--save']})
        expect(runCommand({...music, kind: 'film'}, {type: 'label'})).toEqual({script: 'tools/label.ts', args: ['demo', '--film']})
        expect(() => runCommand(music, {type: 'label', from: '../../etc/passwd'})).toThrow('no such from')
        expect(() => runCommand(music, {type: 'label', mode: 'never'})).toThrow('no such mode')
    })
})

test('writes <name>-labeled.mp4: the same frames and sound, the marker only where it should be', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'label-'))
    const video = join(dir, 'demo.mp4')
    // 4 s of black with a tone: the white marker is the only bright thing in the picture
    const make = Bun.spawnSync(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=black:s=320x180:r=24:d=4', '-f', 'lavfi', '-i', 'sine=f=440:d=4',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video])
    expect(make.exitCode).toBe(0)
    const done = await labelVideo(video, markerFile('generated-white', dir), {...label, mode: 'credits', seconds: 2, size: 20})
    expect(done.file).toBe(join(dir, 'demo-labeled.mp4'))
    const info = await probeVideo(done.file)
    expect({frames: info.frames, width: info.width, hasAudio: info.hasAudio}).toEqual({frames: 96, width: 320, hasAudio: true})
    // the brightest pixel of a frame in the first two seconds and of one after
    const brightest = (at: number) => {
        const out = Bun.spawnSync(['ffmpeg', '-v', 'error', '-ss', String(at), '-i', done.file, '-frames:v', '1', '-vf', 'format=gray,signalstats,metadata=print:key=lavfi.signalstats.YMAX:file=-', '-f', 'null', '-'])
        return Number(/YMAX=(\d+)/.exec(out.stdout.toString())?.[1])
    }
    expect(brightest(1)).toBeGreaterThan(200)
    expect(brightest(3)).toBeLessThan(40)
})
