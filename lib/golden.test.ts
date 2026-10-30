import {afterAll, beforeAll, describe, expect, spyOn, test} from "bun:test";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import type {WorkflowResult} from "../comfy/helpers.ts";
import {assembleFinal} from "./assemble.ts";
import {matchFilter} from "./colormatch.ts";
import type {ClipRequest} from "./compose.ts";
import {defaults, loadProjectConfig, type RenderConfig} from "./config.ts";
import {finishFilter, finishOf, finishVideo, MILD_FINISH} from "./finish.ts";
import {assembleFilm, assembleSmoothFilm} from "./film/assemble.ts";
import {finishCopy, interpolateClips} from "./final-pass.ts";
import {buildFilmClipRequests, type FilmClipRequest} from "./film/compose.ts";
import {packClips} from "./film/coverage.ts";
import {toCast, toScreenplay} from "./film/screenplay.ts";
import type {SceneCoverage} from "./film/types.ts";
import {filmDefaults, loadFilmConfig} from "./film/config.ts";
import {filmRenderConfig} from "./film/pictures.ts";
import {FilmRenderer, filmClipFingerprint, startedOnContext} from "./film/render.ts";
import {Renderer} from "./render.ts";
import * as provenance from "./provenance.ts";
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
    'context frames': {...filmOptions, startClip: 'fs/film-x/assets/clips/clip-002_tail22.mp4', frames: 141},
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

describe("a film's clip prompts", () => {
    // one scene of a walk and a talk, three clips of one shot each - the second and the third go on from the one before with continuity "scene"
    const play = toScreenplay({scenes: [{setting: 'INT', location: 'THE CORRIDOR', time: 'NIGHT', elements: [
        {type: 'action', text: 'Ann and Bo walk down the corridor.'},
        {type: 'dialogue', speaker: 'BO', text: 'You were so nervous that night.', kind: 'spoken'},
        {type: 'dialogue', speaker: 'ANN', text: 'I still am.', kind: 'spoken'},
    ]}]}, {title: 'The Walk', language: 'en'})
    const cast = toCast({characters: [{name: 'Ann', appearance: 'a singer', voice: 'a woman, low'}, {name: 'Bo', appearance: 'an old man', voice: 'a man, raspy'}], locations: [{name: 'THE CORRIDOR', description: 'a narrow corridor'}]}, play)
    const shot = (over: object) => ({framing: 'medium shot', camera: 'locked off', characters: ['ann', 'bo'], action: 'Ann and Bo walk side by side.', lines: [], seconds: 5, ...over})
    const coverage = [{sceneId: play.scenes[0]!.id, soundscape: 'footsteps', staging: 'Ann walks left of Bo.', shots: [
        shot({view: 'from ahead of them, looking back down the corridor', camera: 'the camera tracks backward ahead of them', people: {ann: {state: 'walks', frame: 'left of centre', facing: 'right'}, bo: {state: 'walks', frame: 'right of centre', facing: 'left'}}}),
        shot({framing: 'close-up', view: 'from beside Bo', camera: 'locked off', characters: ['bo'], action: 'Bo speaks to Ann.', lines: [0], people: {bo: {state: 'walks', frame: 'centre, three-quarter view', facing: 'left'}}}),
        shot({framing: 'close-up', view: 'from beside Ann', camera: 'a slow push in', characters: ['ann', 'bo'], action: 'Ann answers.', lines: [1], people: {ann: {state: 'walks', frame: 'centre', facing: 'right'}, bo: {state: 'walks', frame: 'left edge, a soft shoulder', facing: 'right', foreground: true}}}),
    ]}] as unknown as SceneCoverage[]
    const requests = (continuity: 'never' | 'scene', pinStartFrame: boolean) => buildFilmClipRequests({
        screenplay: play, cast, clips: packClips(play, coverage, continuity), soundscapes: {s1: 'footsteps'}, stagings: {s1: 'Ann walks left of Bo.'}, voices: {},
        characterDescriptions: {ann: 'Ann, a singer in a dark coat', bo: 'Bo, an old man in a cardigan'}, locationDescriptions: {}, locationViews: {}, lookBrief: 'a realistic film look', pinStartFrame,
    }).map(r => ({id: r.id, startsFrom: r.startsFrom ?? null, shots: r.shots, pictures: r.assets.pictures.map(p => p.file), prompt: r.prompt}))
    for (const [continuity, pin] of [['never', true], ['scene', true], ['scene', false]] as const) {
        test(`continuity ${continuity}, ${pin ? 'the start frame pinned' : 'the start frame as a picture'}`, () => expect(requests(continuity, pin)).toMatchSnapshot())
    }
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
async function testClip(file: string, frames: number, size: { width: number, height: number } = {width: 320, height: 192}, fps = 24, silent = false, flatGrey = false) {
    mkdirSync(dirname(file), {recursive: true})
    // flat grey: what lib/leak.ts takes for the studio backdrop of the reference pictures
    const color = flatGrey ? '0x808080' : `0x${Bun.hash(file.replace(/^.*[\\/]/, '')).toString(16).padStart(6, '0').slice(-6)}`
    const audio = silent ? [] : ['-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000', '-ac', '2']
    const proc = Bun.spawn(['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=${size.width}x${size.height}:r=${fps}`, ...audio,
        '-frames:v', String(frames), '-shortest', ...(file.endsWith('.png') ? [] : ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p']), ...(silent ? [] : ['-c:a', 'aac']), file], {stdout: 'ignore', stderr: 'pipe'})
    if (await proc.exited !== 0) throw new Error(`ffmpeg could not make ${file}: ${await new Response(proc.stderr).text()}`)
}

const lengthOf = (nodes: Record<string, Node>) => Object.values(nodes).find(n => n.class_type === 'PrimitiveInt')?.inputs.value as number

type Job = { what: unknown, target: string, uploads: unknown, workflow: Record<string, Node>, size?: unknown, meta: unknown }

// ComfyUI replaced: Renderer.render is the one place a job goes to a server
function recording<T extends new (...args: any[]) => Renderer>(Base: T) {
    return class extends Base {
        jobs: Job[] = []
        // clip ids whose next render comes out as the studio backdrop - once each
        leaky = new Set<string>()
        protected override async render<M>(what: { kind: string }, target: string, _extension: string | string[], prepare: () => Promise<{ result: WorkflowResult, uploads: { from: string, to: string }[], meta: M }>): Promise<M> {
            const {result, uploads, meta} = await prepare()
            const {workflow, size} = built(result)
            this.jobs.push({what, target, uploads, workflow, size, meta})
            if (what.kind === 'interpolation') {
                const combine = Object.values(workflow).find(n => n.class_type === 'VHS_VideoCombine')!
                const multiplier = Number(combine.inputs.frame_rate) / 24
                const pieces = Object.values(workflow).filter(n => n.class_type === 'ImageFromBatch' && n.inputs.length !== 1).reduce((sum, n) => sum + Number(n.inputs.length), 0)
                await testClip(target, pieces * multiplier, undefined, 24 * multiplier, true)
            } else if (target.endsWith('.png')) {
                // a picture: one frame in the colour of its name
                await testClip(target, 1, size ?? {width: 288, height: 512}, 24, true)
            } else {
                const id = target.replace(/^.*[\\/]/, '').replace(/\.mp4$/, '')
                await testClip(target, lengthOf(workflow), size ?? {width: 320, height: 192}, 24, false, this.leaky.delete(id))
            }
            return {...meta, ...(size ? {size} : {})} as M
        }
    }
}
const servers = [{name: 'stand-in', url: 'http://127.0.0.1:9'}]

describe.skipIf(!ffmpegAvailable)('rendering and joining, with ffmpeg', () => {
    // What ffmpeg writes differs by bit from one build to the next, and every fingerprint built on it with it. Its files
    // count by their path in the project here - that still shows which file a fingerprint is built on. The fixtures (text) by their content.
    const {fileFingerprint} = provenance
    let fingerprints: ReturnType<typeof spyOn>
    beforeAll(() => {
        fingerprints = spyOn(provenance, 'fileFingerprint').mockImplementation((path: string) =>
            existsSync(path) && readFileSync(path).includes(0) ? Bun.hash(path.slice(dir.length).replaceAll('\\', '/').replace(/^\/[^/]+\//, '')).toString(16) : fileFingerprint(path))
    })
    afterAll(() => fingerprints.mockRestore())

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
    test('music video: the backdrop check after every clip, with context frames', async () => {
        expect(await musicRun('leak', {contextFrames: 22, leakRetries: 2})).toMatchSnapshot()
    }, 60_000)

    test('music video: a clip with the studio backdrop is put away and rendered again with another seed', async () => {
        const projectDir = folder('music-leaked', {
            'assets/locations/hall.png': 'hall', 'assets/characters/ann.png': 'ann', 'assets/characters/bo.png': 'bo',
            'stems/vocals.wav': 'vocals', 'stems/bass.wav': 'bass', 'stems/song.wav': 'song',
        })
        const Recording = recording(Renderer)
        using renderer = new Recording('golden', projectDir, {...defaults, seed: -1, leakRetries: 2, videoResolution: '320x192'}, servers)
        renderer.leaky.add('slot-007')
        await renderer.renderClip(musicClip('slot-007'), {vocals: join(projectDir, 'stems/vocals.wav'), bass: join(projectDir, 'stems/bass.wav'), song: join(projectDir, 'stems/song.wav')})
        const seeds = renderer.jobs.map(j => (j.meta as { seed: number }).seed)
        expect(seeds).toHaveLength(2)
        expect(JSON.parse(readFileSync(join(projectDir, 'videos/slot-007.mp4.json'), 'utf8')).seed).toBe(seeds[1]!)
        expect(existsSync(join(projectDir, `old/leaks/slot-007-seed-${seeds[0]}.mp4`))).toBe(true)
    }, 60_000)

    test('the reference sheets: a character and a place of the music video, a film character and its other look', async () => {
        {
            const sheet = (id: string, kind: 'character' | 'location', extra: object = {}) => ({kind, id, name: id, file: `assets/${kind}s/${id}.png`, prompt: `the picture of ${id}`, description: `${id}, as the clips describe it`, ...extra})
            const musicDir = folder('sheets-music')
            const Music = recording(Renderer)
            using music = new Music('golden', musicDir, {...defaults, seed: 42}, servers)
            const filmDir = folder('sheets-film')
            const Film = recording(FilmRenderer)
            using film = new Film('film-golden', filmDir, {...filmRenderConfig(filmDefaults), seed: 42}, servers)
            const {calls} = await ffmpegCalls(async () => {
                await music.renderSequenceSheet(sheet('ann', 'character'))
                await music.renderSequenceSheet(sheet('hall', 'location', {views: ['the stage from the hall', 'the door', 'the bar', 'the hall from above']}))
                await film.renderSequenceSheet(sheet('vyvian', 'character'))
                await film.renderSequenceSheet({...sheet('vyvian--soaked', 'character'), baseId: 'vyvian', seed: 42, look: {base: 'vyvian', change: 'her hair and costume are soaked and dripping'}} as Parameters<typeof film.renderSequenceSheet>[0])
            })
            const sidecars = (dir: string) => Object.fromEntries(['assets/characters/ann.png', 'assets/locations/hall.png', 'assets/characters/vyvian.png', 'assets/characters/vyvian--soaked.png',
                'assets/sequence/characters/vyvian--soaked/anchor.png', 'assets/sequence/characters/vyvian--soaked/sequence.mp4']
                .filter(f => existsSync(join(dir, `${f}.json`))).map(f => [f, JSON.parse(readFileSync(join(dir, `${f}.json`), 'utf8'))]))
            expect(portable({jobs: [...music.jobs, ...film.jobs], sidecars: {music: sidecars(musicDir), film: sidecars(filmDir)}, ffmpeg: calls})).toMatchSnapshot()
        }
    }, 60_000)

    test('a sheet made again for its own prompt keeps its anchor - a changed anchor is drawn again', async () => {
        const hall = (extra: object = {}) => ({kind: 'location' as const, id: 'hall', name: 'hall', file: 'assets/locations/hall.png', prompt: 'the picture of hall', description: 'hall', ...extra})
        const dir = folder('sheets-refresh')
        const Music = recording(Renderer)
        using music = new Music('golden', dir, {...defaults, seed: -1}, servers)
        music.refresh.add('pictures')
        const anchor = join(dir, 'assets/sequence/locations/hall/anchor.png.json')
        const labels = () => music.jobs.map(j => (j.what as { label: string }).label)
        await music.renderSequenceSheet(hall())
        const first = readFileSync(anchor, 'utf8')
        // other views: the sheet's prompt changed, its anchor did not
        await music.renderSequenceSheet(hall({views: ['the stage', 'the door', 'the bar', 'the hall from above']}))
        expect(labels()).toEqual(['location hall anchor', 'location hall sequence', 'location hall sequence'])
        expect(readFileSync(anchor, 'utf8')).toBe(first)
        // another picture prompt: the anchor goes with the sheet
        await music.renderSequenceSheet(hall({prompt: 'the picture of another hall'}))
        expect(labels().slice(3)).toEqual(['location hall anchor', 'location hall sequence'])
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

    test('film: context frames - the end of a clip with dialogue as the film shows it, its head cut off, its colors matched', async () => {
        const projectDir = folder('film-context', {'assets/locations/hall.png': 'hall', 'assets/characters/ann.png': 'ann'})
        const Recording = recording(FilmRenderer)
        using renderer = new Recording('film-golden', projectDir, {...filmRenderConfig({...filmDefaults, contextFrames: 22}), seed: 42, videoResolution: '320x192'}, servers)
        const first = filmClip('clip-003')
        const second = filmClip('clip-004', {
            startsFrom: 'clip-003', frameStart: 308, frames: 40, dialogue: [],
            assets: {pictures: [...filmClip('clip-004').assets.pictures, {label: '<Picture 3>', file: 'assets/clips/clip-003_lf.png', subject: '', kind: 'frame', id: 'clip-003', name: 'clip-003', description: ''}]},
        })
        const {calls} = await ffmpegCalls(async () => {
            await (renderer as unknown as FilmRenderer).renderFilmClip(first)
            await (renderer as unknown as FilmRenderer).renderFilmClip(second, first)
        })
        const sidecar = (id: string) => JSON.parse(readFileSync(join(projectDir, `videos/${id}.mp4.json`), 'utf8'))
        // clip-003 has dialogue: the film shows all its 124 frames, so the context ends CONTEXT_SETTLE (3) before its last one
        expect(calls.some(c => c.includes('trim=start_frame=99:end_frame=121,setpts=PTS-STARTPTS'))).toBe(true)
        // 40 frames + 25 of lead rendered as 73 (5 + 17·k), the 25 cut off again
        expect(sidecar('clip-004')).toMatchObject({contextFrames: 22, renderedFrames: 48})
        // its first frame is a new one: the film keeps it (a clip pinned to the last frame starts on that frame again, which is left out)
        expect([startedOnContext(projectDir, 'clip-003'), startedOnContext(projectDir, 'clip-004')]).toEqual([false, true])
        expect(portable({jobs: renderer.jobs, sidecars: [sidecar('clip-003'), sidecar('clip-004')], ffmpeg: calls})).toMatchSnapshot()
    }, 60_000)

    test('film: a clip with the studio backdrop is put away and rendered again with another seed', async () => {
        const projectDir = folder('film-leaked', {'assets/locations/hall.png': 'hall', 'assets/characters/ann.png': 'ann'})
        const Recording = recording(FilmRenderer)
        using renderer = new Recording('film-golden', projectDir, {...filmRenderConfig({...filmDefaults, leakRetries: 1}), videoResolution: '320x192'}, servers)
        renderer.leaky.add('clip-003')
        await (renderer as unknown as FilmRenderer).renderFilmClip(filmClip('clip-003'))
        const seeds = renderer.jobs.map(j => (j.meta as { seed: number }).seed)
        expect(seeds).toHaveLength(2)
        expect(JSON.parse(readFileSync(join(projectDir, 'videos/clip-003.mp4.json'), 'utf8')).seed).toBe(seeds[1]!)
        expect(existsSync(join(projectDir, `old/leaks/clip-003-seed-${seeds[0]}.mp4`))).toBe(true)
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

    test('film: the finished copy with the clips matched, and the film at 48 fps with the sound of the one at 24', async () => {
        const projectDir = folder('film-smooth')
        for (const [id, frames] of [['clip-001', 36], ['clip-002', 44]] as const) await testClip(join(projectDir, 'videos', `${id}.mp4`), frames)
        const clips = [{id: 'clip-001', frames: 30, useRendered: true}, {id: 'clip-002', frames: 40, continuesPrevious: true}]
        const target = join(projectDir, 'film.mp4')
        const Recording = recording(FilmRenderer)
        using renderer = new Recording('film-golden', projectDir, filmRenderConfig(filmDefaults), servers)
        const {result, calls} = await ffmpegCalls(async () => {
            const joined = await assembleFilm({clips, projectDir, target})
            const spans = clips.map((c, i) => ({id: c.id, start: joined.starts[i]!, end: joined.starts[i]! + (joined.used[i]! - joined.skipped[i]!) / 24}))
            const finished = await finishCopy(target, finishOf({colorMatch: 0.5})!, spans)
            const shots = [{at: 0}, {at: 0.75}]
            const {files, multiplier} = await interpolateClips(renderer, clips.map((c, i) => ({id: c.id, frames: joined.used[i]!, shots})), 'rife_v4.26_heavy.safetensors', 48)
            const smooth = await assembleSmoothFilm({clips: clips.map((c, i) => ({id: c.id, used: joined.used[i]!, skipped: joined.skipped[i]!})), files, multiplier, fps: 48, sound: target, target: join(projectDir, 'film-48fps.mp4')})
            return {joined, finished, multiplier, smooth}
        })
        // the 48 fps film runs as long as the one at 24: 36 + 40 - 1 frames, twice
        expect(result.smooth.frames).toBe(150)
        // the clips are interpolated side by side, their jobs come in the order they happen to start
        const jobs = renderer.jobs.toSorted((a, b) => a.target.localeCompare(b.target))
        expect(portable({result, jobs, ffmpeg: calls})).toMatchSnapshot()
    }, 60_000)

    test('film: the clips joined, with and without level matching', async () => {
        const projectDir = folder('film-final')
        for (const [id, frames] of [['clip-001', 36], ['clip-002', 44]] as const) await testClip(join(projectDir, 'videos', `${id}.mp4`), frames)
        const clips = [{id: 'clip-001', frames: 30, useRendered: true}, {id: 'clip-002', frames: 40, continuesPrevious: true}]
        const {result, calls} = await ffmpegCalls(async () => ({
            plain: await assembleFilm({clips, projectDir, target: join(projectDir, 'film.mp4')}),
            levelled: await assembleFilm({clips, projectDir, target: join(projectDir, 'film-levelled.mp4'), levelMatching: true}),
        }))
        // the gain is measured on the sound ffmpeg encoded, so its last digits differ by build - whole dB here
        const wholeDb = calls.map(cmd => cmd.map(arg => arg.replace(/volume=(-?[\d.]+)dB/g, (_, db: string) => `volume=${Math.round(Number(db))}dB`)))
        expect(portable({result, ffmpeg: wholeDb})).toMatchSnapshot()
    }, 60_000)
})
