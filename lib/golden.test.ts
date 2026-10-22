import {afterAll, beforeAll, describe, expect, spyOn, test} from "bun:test";
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import type {WorkflowResult} from "../comfy/helpers.ts";
import {assembleFinal} from "./assemble.ts";
import {matchFilter} from "./colormatch.ts";
import type {ClipRequest} from "./compose.ts";
import {defaults, loadProjectConfig, type RenderConfig} from "./config.ts";
import {finishFilter, finishOf, finishVideo, MILD_FINISH} from "./finish.ts";
import {assembleFilm} from "./film/assemble.ts";
import type {FilmClipRequest} from "./film/compose.ts";
import {filmDefaults, loadFilmConfig} from "./film/config.ts";
import {filmRenderConfig} from "./film/pictures.ts";
import {FilmRenderer, filmClipFingerprint} from "./film/render.ts";
import {Renderer} from "./render.ts";
import {clipSpec, filmClipSpec, specId} from "./render-spec.ts";

// Golden tests: what the music video sends to ComfyUI and to ffmpeg, its config, and the fingerprints of its files, recorded
// as they are - and the same for the film where it uses the shared code. The film pipeline is going to share the render,
// workflow and finishing code of the music video: a changed snapshot here is a changed music video (or a film whose rendered
// clips turn stale). That is a bug, unless the PR means it and says so - never update these snapshots to make a test pass.

type Node = { class_type: string, inputs: Record<string, unknown> }
const built = (result: WorkflowResult) => ({workflow: result.workflow.build({outputs: {result: result.output}}).workflow as Record<string, Node>, size: result.size})
const workflow = async (name: string, opts: object) => built((await import(`../comfy/workflows/${name}.ts`)).default(opts))

// the inputs of a music-video clip as lib/render.ts gives them - every field set, the variants below change one thing each
const musicOptions = {
    prompt: '<Subject 1> is the hall. <Subject 2> sings into the microphone, <Subject 3> plays the bass.',
    pictures: ['fs/p/assets/locations/hall.png', 'fs/p/assets/characters/ann.png', 'fs/p/assets/characters/bo.png'],
    audios: ['fs/p/stems/vocals.wav', 'fs/p/stems/bass.wav'],
    vocals: 'fs/p/stems/vocals.wav',
    song: 'fs/p/stems/song.wav',
    songStart: 12.5,
    frames: 73,
    duration: 73 / 24,
    seed: 42,
    resolution: -1,
    filenamePrefix: 'fs/p/videos/slot-007',
}
const musicVariants: Record<string, object> = {
    'plain': musicOptions,
    'pinned start frame': {...musicOptions, startFrame: 'fs/p/assets/clips/slot-006_lf.png'},
    'context frames': {...musicOptions, startClip: 'fs/p/assets/clips/slot-006_tail22.mp4', frames: 107, duration: 107 / 24},
    'portrait, megapixels': {...musicOptions, aspect: '9:16', resolution: 1.2},
    'fixed size, no vocals': {...musicOptions, audios: ['fs/p/stems/drums.wav'], vocals: undefined, resolution: '1280x720'},
}
const filmOptions = {
    prompt: '<Subject 1> is the trench. <Subject 2> (S1) says in a low voice, <d>[German] Bleib unten.</d>',
    pictures: ['fs/film-x/assets/locations/trench.png', 'fs/film-x/assets/characters/karl.png'],
    frames: 107,
    seed: 42,
    resolution: -1,
    filenamePrefix: 'fs/film-x/videos/clip-003',
}
const filmVariants: Record<string, object> = {
    'plain': filmOptions,
    'pinned start frame': {...filmOptions, startFrame: 'fs/film-x/assets/clips/clip-002_lf.png'},
    'fixed size': {...filmOptions, resolution: '1280x720'},
    'portrait': {...filmOptions, aspect: '9:16'},
}

describe('the ComfyUI workflows, node by node', () => {
    for (const name of ['h3-ref2video', 'h3-ref2video-full', 'h3-ref2video-2pass', 'h3-ref2video-cpu-clip']) {
        for (const [variant, opts] of Object.entries(musicVariants)) {
            test(`${name}: ${variant}`, async () => expect(await workflow(name, opts)).toMatchSnapshot())
        }
    }
    for (const name of ['h3-ref2video-film', 'h3-ref2video-film-beta', 'h3-ref2video-film-2pass']) {
        for (const [variant, opts] of Object.entries(filmVariants)) {
            test(`${name}: ${variant}`, async () => expect(await workflow(name, opts)).toMatchSnapshot())
        }
    }
    test('frame-interpolate', async () => {
        expect(await workflow('frame-interpolate', {video: 'fs/p/videos/slot-007.mp4', pieces: [{start: 0, frames: 30}, {start: 30, frames: 43}], model: 'rife_v4.26_heavy.safetensors', multiplier: 2, filenamePrefix: 'fs/p/interpolated/slot-007'})).toMatchSnapshot()
    })
    test('the render lengths', async () => {
        const lengths: Record<string, number[]> = {}
        for (const name of ['h3-ref2video', 'h3-ref2video-full', 'h3-ref2video-2pass', 'h3-ref2video-cpu-clip', 'h3-ref2video-film', 'h3-ref2video-film-beta']) {
            const module = await import(`../comfy/workflows/${name}.ts`)
            lengths[name] = [1, 5, 6, 22, 23, 73, 107, 224].map(frames => module.renderFrames?.(frames) ?? frames)
        }
        expect(lengths).toMatchSnapshot()
    })
})

let dir: string
beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'golden-'))
})
afterAll(() => rmSync(dir, {recursive: true, force: true}))

/** A new folder in the test's temp folder, with these files (path -> content). */
function folder(name: string, files: Record<string, string> = {}) {
    const root = join(dir, name)
    for (const [file, content] of Object.entries(files)) {
        mkdirSync(dirname(join(root, file)), {recursive: true})
        writeFileSync(join(root, file), content)
    }
    mkdirSync(root, {recursive: true})
    return root
}

describe('the config', () => {
    test('music video: the defaults', async () => {
        expect(defaults).toMatchSnapshot()
        expect(await loadProjectConfig(folder('config-empty'))).toMatchSnapshot()
    })
    test('music video: every render setting set', async () => {
        const config = {videoAspect: '9:16', videoResolution: 1.2, videoWorkflow: 'h3-ref2video-2pass', contextFrames: 22, pinStartFrame: false, finalFps: 60, finish: {grain: 4, colorMatch: 0.5}, leakRetries: 2, seed: 7}
        expect(await loadProjectConfig(folder('config-set', {'config.json': JSON.stringify(config)}))).toMatchSnapshot()
    })
    test('music video: what a wrong value is told', async () => {
        const wrong: object[] = [
            {videoAspect: 'wide'}, {contextFrames: 10}, {finalFps: 50}, {finish: {sharpen: 2}}, {finish: {sharp: 1}}, {finish: 'yes'},
            {interpolationModel: ''}, {leakRetries: -1}, {pinStartFrame: 'yes'}, {videoWorkflow: 'nope'}, {seed: 1.5},
        ]
        const messages = await Promise.all(wrong.map((config, i) =>
            loadProjectConfig(folder(`config-wrong-${i}`, {'config.json': JSON.stringify(config)})).then(() => 'accepted', (e: Error) => e.message.slice(e.message.indexOf('config.json'))),
        ))
        expect(messages).toMatchSnapshot()
    })
    test('film: the defaults and what the renderer is given', async () => {
        expect(filmDefaults).toMatchSnapshot()
        expect(filmRenderConfig(await loadFilmConfig(folder('film-config-empty')))).toMatchSnapshot()
    })
    test('finish: the settings and the filter chains', () => {
        expect({mild: MILD_FINISH, off: finishOf(false), on: finishOf(true), some: finishOf({grain: 4, colorMatch: 0.5})}).toMatchSnapshot()
        expect([
            finishFilter(MILD_FINISH),
            finishFilter({...MILD_FINISH, sharpen: 0, grain: 6}),
            finishFilter(MILD_FINISH, matchFilter({ylow: 20, yhigh: 230, uavg: 126, vavg: 130}, {ylow: 30, yhigh: 220, uavg: 120, vavg: 134}, 0.5, 'between(t,0,3)')),
        ]).toMatchSnapshot()
    })
})

// pictures, stems and earlier clips with fixed content: their fingerprints are part of a clip's
const project = () => folder('project', {
    'assets/locations/hall.png': 'hall',
    'assets/characters/ann.png': 'ann',
    'assets/characters/bo.png': 'bo',
    'videos/slot-006.mp4.json': JSON.stringify({fingerprint: 'f00d'}),
})

const musicClip = (id: string, over: Partial<ClipRequest> = {}): ClipRequest => ({
    id, index: Number(id.slice(-3)), start: 12.5, end: 15.5, duration: 3, frameStart: 300, frames: 72, section: 'verse 1', beatId: 'b2',
    shots: [{label: 'A', at: 0, framing: 'medium', camera: 'static', subjects: ['ann']}, {label: 'B', at: 1.25, framing: 'close', camera: 'push in', subjects: ['bo']}],
    assets: {
        pictures: [
            {label: '<Picture 1>', file: 'assets/locations/hall.png', subject: '<Subject 1>', kind: 'location', id: 'hall', name: 'Hall', description: 'a hall'},
            {label: '<Picture 2>', file: 'assets/characters/ann.png', subject: '<Subject 2>', kind: 'character', id: 'ann', name: 'Ann', description: 'a singer'},
            {label: '<Picture 3>', file: 'assets/characters/bo.png', subject: '<Subject 3>', kind: 'character', id: 'bo', name: 'Bo', description: 'a bass player'},
        ],
        audio: [
            {label: '<Audio 1>', file: 'stems/vocals.wav', songStart: 12.5, songEnd: 15.5, stem: 'vocals'},
            {label: '<Audio 2>', file: 'stems/bass.wav', songStart: 12.5, songEnd: 15.5, stem: 'bass'},
        ],
    },
    prompt: musicOptions.prompt,
    ...over,
})

const filmClip = (id: string, over: Partial<FilmClipRequest> = {}): FilmClipRequest => ({
    id, index: Number(id.slice(-3)), sceneId: 's2', seconds: 4.5, frameStart: 200, frames: 108,
    shots: [{label: 'A', at: 0, framing: 'medium', camera: 'static', subjects: ['ann']}],
    dialogue: [{at: 0, line: 4, speaker: 'ann', speakerId: 'S1', subject: '<Subject 2>', kind: 'on-screen' as FilmClipRequest['dialogue'][number]['kind'], text: 'Stay down.'}],
    assets: {
        pictures: [
            {label: '<Picture 1>', file: 'assets/locations/hall.png', subject: '<Subject 1>', kind: 'location', id: 'hall', name: 'Hall', description: 'a hall'},
            {label: '<Picture 2>', file: 'assets/characters/ann.png', subject: '<Subject 2>', kind: 'character', id: 'ann', name: 'Ann', description: 'a soldier'},
        ],
    },
    prompt: filmOptions.prompt,
    ...over,
})

describe('the fingerprints of rendered clips - another one makes every clip of an existing project stale', () => {
    test('music video', () => {
        const projectDir = project()
        const video = {videoWorkflow: 'h3-ref2video', videoResolution: -1}
        expect({
            plain: specId(clipSpec(musicClip('slot-007'), projectDir, video)),
            'aspect 16:9 written out': specId(clipSpec(musicClip('slot-007'), projectDir, {...video, videoAspect: '16:9'})),
            'aspect 9:16': specId(clipSpec(musicClip('slot-007'), projectDir, {...video, videoAspect: '9:16'})),
            'two-pass': specId(clipSpec(musicClip('slot-007'), projectDir, {...video, videoWorkflow: 'h3-ref2video-2pass'})),
            'goes on from slot-006': specId(clipSpec(musicClip('slot-007', {startsFrom: 'slot-006'}), projectDir, video)),
        }).toMatchSnapshot()
    })
    test('film', () => {
        const projectDir = project()
        const video = {videoWorkflow: 'h3-ref2video-film', videoResolution: -1}
        expect({
            plain: filmClipFingerprint(filmClip('clip-003'), projectDir, video),
            'pinned start frame': filmClipFingerprint(filmClip('clip-003'), projectDir, {...video, pinStartFrame: true}),
            'goes on from slot-006': filmClipFingerprint(filmClip('clip-003', {startsFrom: 'slot-006'}), projectDir, video),
            spec: filmClipSpec({...filmClip('clip-003'), promptHash: 'abc'}, projectDir, video),
        }).toMatchSnapshot()
    })
})

// ---- what goes to ffmpeg and ComfyUI when clips are rendered and joined: ffmpeg runs for real, ComfyUI is replaced by a
// stand-in that records the job and writes a plain clip of the size and length the workflow asks for

const ffmpegAvailable = Bun.which('ffmpeg') !== null && Bun.which('ffprobe') !== null

/** The temp folder written as <tmp>, and the paths in it with / - the same on every machine. Other strings stay as they are (ffmpeg's \, escapes). */
const portable = (value: unknown) => JSON.parse(JSON.stringify(value, (_, v: unknown) =>
    typeof v === 'string' && v.includes(dir) ? v.replaceAll(dir, '<tmp>').replaceAll('\\', '/') : v))

/** The ffmpeg commands run during `run` - not the ones that make the stand-in's test clips (lavfi sources). */
async function ffmpegCalls<T>(run: () => Promise<T>): Promise<{ result: T, calls: string[][] }> {
    const calls: string[][] = []
    const spawn = Bun.spawn
    const spy = spyOn(Bun, 'spawn').mockImplementation(((cmd: string[], opts: object) => {
        if (cmd[0] === 'ffmpeg' && !cmd.includes('lavfi')) calls.push(cmd)
        return spawn(cmd, opts as never)
    }) as typeof Bun.spawn)
    try {
        return {result: await run(), calls}
    } finally {
        spy.mockRestore()
    }
}

/** A clip of `frames` frames in one color (from the name, so clips differ), at `fps`, with a stereo sound. */
async function testClip(file: string, frames: number, size: { width: number, height: number } = {width: 320, height: 192}, fps = 24, silent = false) {
    mkdirSync(dirname(file), {recursive: true})
    const color = `0x${Bun.hash(file.replace(/^.*[\\/]/, '')).toString(16).padStart(6, '0').slice(-6)}`
    const audio = silent ? [] : ['-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000', '-ac', '2']
    const proc = Bun.spawn(['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=${size.width}x${size.height}:r=${fps}`, ...audio,
        '-frames:v', String(frames), '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', ...(silent ? [] : ['-c:a', 'aac']), file], {stdout: 'ignore', stderr: 'pipe'})
    if (await proc.exited !== 0) throw new Error(`ffmpeg could not make ${file}: ${await new Response(proc.stderr).text()}`)
}

const lengthOf = (nodes: Record<string, Node>) => Object.values(nodes).find(n => n.class_type === 'PrimitiveInt')?.inputs.value as number

type Job = { what: unknown, target: string, uploads: unknown, workflow: Record<string, Node>, size?: unknown, meta: unknown }

// ComfyUI replaced: Renderer.render is the one place a job goes to a server
function recording<T extends new (...args: any[]) => Renderer>(Base: T) {
    return class extends Base {
        jobs: Job[] = []
        protected override async render<M>(what: { kind: string }, target: string, _extension: string | string[], prepare: () => Promise<{ result: WorkflowResult, uploads: { from: string, to: string }[], meta: M }>): Promise<M> {
            const {result, uploads, meta} = await prepare()
            const {workflow, size} = built(result)
            this.jobs.push({what, target, uploads, workflow, size, meta})
            if (what.kind === 'interpolation') {
                const combine = Object.values(workflow).find(n => n.class_type === 'VHS_VideoCombine')!
                const multiplier = Number(combine.inputs.frame_rate) / 24
                const pieces = Object.values(workflow).filter(n => n.class_type === 'ImageFromBatch' && n.inputs.length !== 1).reduce((sum, n) => sum + Number(n.inputs.length), 0)
                await testClip(target, pieces * multiplier, undefined, 24 * multiplier, true)
            } else {
                await testClip(target, lengthOf(workflow), size ?? {width: 320, height: 192})
            }
            return {...meta, ...(size ? {size} : {})} as M
        }
    }
}
const servers = [{name: 'stand-in', url: 'http://127.0.0.1:9'}]

describe.skipIf(!ffmpegAvailable)('rendering and joining, with ffmpeg', () => {
    async function musicRun(name: string, config: Partial<RenderConfig>) {
        const projectDir = folder(`music-${name}`, {
            'assets/locations/hall.png': 'hall', 'assets/characters/ann.png': 'ann', 'assets/characters/bo.png': 'bo',
            'stems/vocals.wav': 'vocals', 'stems/bass.wav': 'bass', 'stems/song.wav': 'song',
        })
        const Recording = recording(Renderer)
        using renderer = new Recording('golden', projectDir, {...defaults, seed: 42, videoResolution: '320x192', ...config}, servers)
        const stems = {vocals: join(projectDir, 'stems/vocals.wav'), bass: join(projectDir, 'stems/bass.wav'), song: join(projectDir, 'stems/song.wav')}
        const second = musicClip('slot-008', {
            startsFrom: 'slot-007', frameStart: 372, frames: 48,
            assets: {...musicClip('slot-008').assets, pictures: [...musicClip('slot-008').assets.pictures, {label: '<Picture 4>', file: 'assets/clips/slot-007_lf.png', subject: '', kind: 'frame', id: 'slot-007', name: 'slot-007', description: 'the last frame of slot-007'}]},
        })
        const {calls} = await ffmpegCalls(async () => {
            await renderer.renderClip(musicClip('slot-007'), stems)
            await renderer.renderClip(second, stems)
            await renderer.renderInterpolation(musicClip('slot-007'), 'rife_v4.26_heavy.safetensors', 2, join(projectDir, 'videos/interpolated/slot-007.mp4'))
        })
        const sidecar = (id: string) => JSON.parse(readFileSync(join(projectDir, `videos/${id}.mp4.json`), 'utf8'))
        return portable({jobs: renderer.jobs, sidecars: [sidecar('slot-007'), sidecar('slot-008')], ffmpeg: calls})
    }

    test('music video: a clip and one that goes on from its last frame', async () => {
        expect(await musicRun('pinned', {})).toMatchSnapshot()
    }, 60_000)
    test('music video: context frames, two-pass, portrait', async () => {
        expect(await musicRun('context', {contextFrames: 22, videoWorkflow: 'h3-ref2video-2pass', videoAspect: '9:16', videoResolution: '192x320'})).toMatchSnapshot()
    }, 60_000)

    test('film: a clip and one that goes on from its last frame', async () => {
        const projectDir = folder('film', {'assets/locations/hall.png': 'hall', 'assets/characters/ann.png': 'ann'})
        const Recording = recording(FilmRenderer)
        using renderer = new Recording('film-golden', projectDir, {...filmRenderConfig(filmDefaults), seed: 42, videoResolution: '320x192'}, servers)
        const second = filmClip('clip-004', {
            startsFrom: 'clip-003', frameStart: 308, frames: 40, dialogue: [],
            assets: {pictures: [...filmClip('clip-004').assets.pictures, {label: '<Picture 3>', file: 'assets/clips/clip-003_lf.png', subject: '', kind: 'frame', id: 'clip-003', name: 'clip-003', description: ''}]},
        })
        const {calls} = await ffmpegCalls(async () => {
            await (renderer as unknown as FilmRenderer).renderFilmClip(filmClip('clip-003'))
            await (renderer as unknown as FilmRenderer).renderFilmClip(second)
        })
        const sidecar = (id: string) => JSON.parse(readFileSync(join(projectDir, `videos/${id}.mp4.json`), 'utf8'))
        expect(portable({jobs: renderer.jobs, sidecars: [sidecar('clip-003'), sidecar('clip-004')], ffmpeg: calls})).toMatchSnapshot()
    }, 60_000)

    test('music video: the final video, its finish and the one at 48 fps', async () => {
        const projectDir = folder('final')
        const clips = [musicClip('slot-001', {frameStart: 0, frames: 30}), musicClip('slot-002', {frameStart: 30, frames: 18})]
        for (const clip of clips) await testClip(join(projectDir, 'videos', `${clip.id}.mp4`), clip.frames + 6)
        for (const clip of clips) await testClip(join(projectDir, 'videos', 'interpolated', `${clip.id}.mp4`), clip.frames * 2, undefined, 48, true)
        const songFile = join(projectDir, 'input/song.wav')
        mkdirSync(dirname(songFile), {recursive: true})
        await Bun.spawn(['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=2', songFile]).exited
        const spans = [{id: 'slot-001', start: 0, end: 1.25}, {id: 'slot-002', start: 1.25, end: 2}]
        const {result, calls} = await ffmpegCalls(async () => ({
            song: await assembleFinal({clips, projectDir, songFile, songAudio: true, target: join(projectDir, 'golden.mp4')}),
            own: await assembleFinal({clips, projectDir, songFile, songAudio: false, target: join(projectDir, 'golden-own.mp4')}),
            smooth: await assembleFinal({clips, projectDir, songFile, songAudio: true, target: join(projectDir, 'golden-48fps.mp4'), interpolated: {files: clips.map(c => join(projectDir, 'videos/interpolated', `${c.id}.mp4`)), multiplier: 2, fps: 48}}),
            mild: await finishVideo(join(projectDir, 'golden.mp4'), MILD_FINISH, spans),
            matched: await finishVideo(join(projectDir, 'golden-48fps.mp4'), finishOf({colorMatch: 0.5, grain: 4})!, spans),
        }))
        expect(portable({result, ffmpeg: calls})).toMatchSnapshot()
    }, 60_000)

    test('film: the clips joined, with and without level matching', async () => {
        const projectDir = folder('film-final')
        for (const [id, frames] of [['clip-001', 36], ['clip-002', 44]] as const) await testClip(join(projectDir, 'videos', `${id}.mp4`), frames)
        const clips = [{id: 'clip-001', frames: 30, useRendered: true}, {id: 'clip-002', frames: 40, continuesPrevious: true}]
        const {result, calls} = await ffmpegCalls(async () => ({
            plain: await assembleFilm({clips, projectDir, target: join(projectDir, 'film.mp4')}),
            levelled: await assembleFilm({clips, projectDir, target: join(projectDir, 'film-levelled.mp4'), levelMatching: true}),
        }))
        expect(portable({result, ffmpeg: calls})).toMatchSnapshot()
    }, 60_000)
})
