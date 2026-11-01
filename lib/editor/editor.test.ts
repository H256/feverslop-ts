import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {fingerprint} from "../provenance.ts";
import {type EditorClip, groupsOf, readEditorFreshness, readEditorProject} from "./project.ts";
import {byteRange, editorHandler, mediaFile, peaks} from "./server.ts";

let root: string
const write = (file: string, content: unknown) => {
    mkdirSync(dirname(file), {recursive: true})
    writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content))
}
const shot = (at: number, label = 'Shot 1') => ({label, at, framing: 'wide shot', camera: 'still', subjects: []})

const music = () => join(root, 'projects', 'music')
const film = () => join(root, 'films', 'film')
const here = process.cwd()

beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'editor-'))
    process.chdir(root)
    const assets = {pictures: [{label: '<Picture 1>', file: 'assets/locations/hall.png', subject: 'S1', kind: 'location', id: 'hall', name: 'The hall', description: 'a hall'}], audio: [{label: '<Audio 1>', file: 'x', songStart: 0, songEnd: 2, stem: 'vocals'}]}
    const clip = (n: number, frameStart: number, more = {}) => ({id: `slot-00${n}`, index: n, start: frameStart / 24, end: (frameStart + 48) / 24, duration: 2, frameStart, frames: 48, section: n < 3 ? 'Verse' : 'Chorus', beatId: 'b1', shots: [shot(0, `Shot ${n}`)], assets, prompt: `prompt ${n}`, ...more})
    write(join(music(), 'output/clips/slot-001.json'), clip(1, 0, {vocals: [{at: 0.5, end: 1.5, line: 0, text: 'sung', singers: [{id: 'a', subject: 'Ann', speaker: 'S1'}]}]}))
    write(join(music(), 'output/clips/slot-002.json'), clip(2, 48, {startsFrom: 'slot-001'}))
    write(join(music(), 'output/clips/slot-003.json'), clip(3, 96))
    write(join(music(), 'output/timeline.json'), {song: join('projects', 'music', 'input', 'song.wav'), bpm: 120, durationSec: 10})
    write(join(music(), 'output/assets.json'), [{kind: 'location', id: 'hall', name: 'The hall', file: 'assets/locations/hall.png', prompt: 'a hall', description: 'a hall'}])
    write(join(music(), 'input/song.wav'), 'RIFF')
    write(join(music(), 'assets/locations/hall.png'), 'png')
    write(join(music(), 'project.json'), {beats: [{id: 'b1', summary: 'a beat', characterIds: [], kind: 'x', intensity: 1, locationId: 'hall', stateAfter: []}], shotMoments: {b1: {staging: 'the staging', shots: [{action: 'first'}, {action: 'second'}, {action: 'third'}]}}})
    write(join(music(), 'videos/slot-001.mp4'), '0123456789')
    write(join(music(), 'videos/slot-001.mp4.json'), {workflow: 'wf', seed: 7, renderedFrames: 56, size: '1x1', fingerprint: 'not the request'})
    write(join(music(), 'project.secret'), 'no')

    write(join(film(), 'output/clips/clip-001.json'), {id: 'clip-001', index: 1, sceneId: 's1', seconds: 2, frameStart: 0, frames: 48, shots: [shot(0)], dialogue: [{at: 0, line: 0, speaker: 'Ann', speakerId: 's1', kind: 'on', text: 'hello'}, {at: 1, line: 1, speaker: 'Bob', speakerId: 's2', kind: 'on', text: 'hi'}], assets: {pictures: []}, prompt: 'film prompt'})
    write(join(film(), 'assets.json'), [])
    write(join(film(), 'project.json'), {screenplay: {title: 'The Film', language: 'en', scenes: [{id: 's1', setting: 'INT', location: 'HALL', time: 'DAY', elements: []}]}, coverage: [{sceneId: 's1', soundscape: '', staging: 'stand', shots: [{framing: 'close-up', camera: 'still', characters: [], action: 'they talk', lines: [], seconds: 2, people: {a: {state: 'stands'}}}]}], cast: {characters: [{id: 'a', name: 'Ann'}], locations: []}})
})
afterAll(() => {
    process.chdir(here)
    rmSync(root, {recursive: true, force: true})
})

describe('reading a project', () => {
    test('a music video: clips on the timeline, the planned shots of each, what is rendered', async () => {
        const project = await readEditorProject({id: 'music', dir: music(), kind: 'music'})
        expect(project).toMatchObject({kind: 'music', seconds: 10, bpm: 120, song: {file: 'input/song.wav'}, command: 'bun index.ts music'})
        expect(project.clips.map(c => [c.id, c.start, c.end])).toEqual([['slot-001', 0, 2], ['slot-002', 2, 4], ['slot-003', 4, 6]])
        expect(project.clips.map(c => c.shots[0]!.action)).toEqual(['first', 'second', 'third'])
        expect(project.clips[0]).toMatchObject({next: 'slot-002', video: {file: 'videos/slot-001.mp4', workflow: 'wf', seed: 7}, lines: [{text: 'sung', who: 'Ann'}], context: {text: 'a beat', staging: 'the staging'}})
        expect(project.clips[0]!.pictures[0]).toMatchObject({file: 'assets/locations/hall.png', exists: true})
        expect(project.clips[1]).toMatchObject({startsFrom: 'slot-001'})
        expect(project.clips[1]!.video).toBeUndefined()
        expect(project.groups).toEqual([{id: 'Verse', label: 'Verse', start: 0, end: 4}, {id: 'Chorus', label: 'Chorus', start: 4, end: 6}])
        expect(project.final.state).toBe('missing')
    })
    test('a film: scenes, its own sound, a line lasting until the next one', async () => {
        const project = await readEditorProject({id: 'film', dir: film(), kind: 'film'})
        expect(project).toMatchObject({kind: 'film', title: 'The Film', seconds: 2, command: 'bun film.ts film'})
        expect(project.song).toBeUndefined()
        expect(project.groups).toEqual([{id: 's1', label: 's1 · HALL', start: 0, end: 2}])
        expect(project.clips[0]!.lines).toEqual([{at: 0, end: 1, text: 'hello', who: 'Ann'}, {at: 1, end: 2, text: 'hi', who: 'Bob'}])
        expect(project.clips[0]!.shots[0]).toMatchObject({framing: 'close-up', action: 'they talk', people: [{name: 'Ann', text: 'stands'}]})
    })
    test('a film: a clip is where the film has it, with the frames of a clip with dialogue', async () => {
        const dir = join(root, 'films', 'spans')
        const clip = (id: string, frameStart: number, frames: number, dialogue: unknown[], more = {}) => ({id, sceneId: 's1', seconds: frames / 24, frameStart, frames, shots: [], dialogue, assets: {pictures: []}, prompt: '', ...more})
        write(join(dir, 'output/clips/clip-001.json'), clip('clip-001', 0, 48, [{at: 0, line: 0, speaker: 'A', speakerId: 's', kind: 'on', text: 'hi'}]))
        write(join(dir, 'output/clips/clip-002.json'), clip('clip-002', 48, 24, []))
        write(join(dir, 'output/clips/clip-003.json'), clip('clip-003', 72, 24, [], {startsFrom: 'clip-002'}))
        write(join(dir, 'videos/clip-001.mp4.json'), {renderedFrames: 60})
        write(join(dir, 'videos/clip-002.mp4.json'), {renderedFrames: 40})
        const project = await readEditorProject({id: 'spans', dir, kind: 'film'})
        // 60 frames of the first, 24 of the second, and the third without its first frame
        expect(project.clips.map(c => [c.start, c.end])).toEqual([[0, 2.5], [2.5, 3.5], [3.5, 3.5 + 23 / 24]])
        expect(project.seconds).toBe(3.5 + 23 / 24)
    })
    test('an empty folder is a project without a plan', async () => {
        const dir = join(root, 'empty')
        mkdirSync(dir)
        expect(await readEditorProject({id: 'empty', dir, kind: 'music'})).toMatchObject({clips: [], groups: [], seconds: 0})
        expect(await readEditorProject({id: 'empty', dir, kind: 'film'})).toMatchObject({clips: [], groups: [], seconds: 0})
    })
    test('a sidecar being written does not stop the page', async () => {
        const dir = join(root, 'writing')
        write(join(dir, 'output/clips/slot-001.json'), {id: 'slot-001', frameStart: 0, frames: 24, section: 'A', beatId: 'b', shots: [], assets: {pictures: [], audio: []}, prompt: ''})
        write(join(dir, 'videos/slot-001.mp4'), 'x')
        write(join(dir, 'videos/slot-001.mp4.json'), '{"workflow": ')
        expect((await readEditorProject({id: 'writing', dir, kind: 'music'})).clips[0]!.video?.file).toBe('videos/slot-001.mp4')
    })
    test('the final video counts as older when a clip is newer', async () => {
        const dir = join(root, 'final')
        write(join(dir, 'output/clips/slot-001.json'), {id: 'slot-001', frameStart: 0, frames: 24, section: 'A', beatId: 'b', shots: [], assets: {pictures: [], audio: []}, prompt: ''})
        write(join(dir, 'videos/slot-001.mp4'), 'x')
        write(join(dir, 'final.mp4'), 'x')
        utimesSync(join(dir, 'final.mp4'), new Date(1000), new Date(1000))
        expect((await readEditorProject({id: 'final', dir, kind: 'music'})).final.state).toBe('older')
    })
    test('groupsOf: a section that comes back is a run of its own', () => {
        const clip = (group: string, start: number) => ({group, start, end: start + 1}) as EditorClip
        expect(groupsOf([clip('A', 0), clip('A', 1), clip('B', 2), clip('A', 3)], g => g).map(g => [g.id, g.start, g.end])).toEqual([['A', 0, 2], ['B', 2, 3], ['A', 3, 4]])
    })
})

describe('freshness', () => {
    test('says which rendered files were made from another request, and nothing of what is not rendered', async () => {
        const {clips, pictures} = await readEditorFreshness({id: 'music', dir: music(), kind: 'music'})
        expect(clips).toEqual({'slot-001': 'stale'})
        // a picture without a sidecar is taken as it is
        expect(pictures).toEqual({hall: 'pinned'})
    })
    test('a picture made from the prompt the plan has now is current, from another one stale', async () => {
        const dir = join(root, 'pictures')
        const job = {kind: 'location', id: 'hall', name: 'Hall', file: 'assets/locations/hall.png', prompt: 'a hall', description: 'a hall'}
        write(join(dir, 'output/assets.json'), [job])
        write(join(dir, 'config.json'), {sequenceSheets: false})
        write(join(dir, job.file), 'png')
        const {loadProjectConfig} = await import("../config.ts")
        const config = await loadProjectConfig(dir)
        write(join(dir, `${job.file}.json`), {fingerprint: fingerprint(job.prompt, config.imageWorkflow, config.imageResolution)})
        expect((await readEditorFreshness({id: 'pictures', dir, kind: 'music'})).pictures).toEqual({hall: 'current'})
        write(join(dir, 'output/assets.json'), [{...job, prompt: 'another hall'}])
        expect((await readEditorFreshness({id: 'pictures', dir, kind: 'music'})).pictures).toEqual({hall: 'stale'})
    })
})

describe('serving', () => {
    const handler = editorHandler()
    const get = (path: string, init?: RequestInit) => handler(new Request(`http://localhost/p/music/music${path}`, init))

    test('only media inside the project', () => {
        expect(mediaFile(music(), 'videos/slot-001.mp4')).toBe(join(music(), 'videos/slot-001.mp4'))
        expect(mediaFile(music(), 'project.json')).toBeUndefined()
        expect(mediaFile(music(), 'project.secret')).toBeUndefined()
        expect(mediaFile(music(), '../music/videos/slot-001.mp4')).toBe(join(music(), 'videos/slot-001.mp4'))
        expect(mediaFile(music(), '../outside.mp4')).toBeUndefined()
        expect(mediaFile(music(), join(root, 'film', 'x.mp4'))).toBeUndefined()
        expect(mediaFile(music(), 'videos/none.mp4')).toBeUndefined()
    })
    test('a path out of the folder is not found', async () => {
        write(join(root, 'outside.mp4'), 'secret')
        expect((await get('/media/..%2F..%2F..%2Foutside.mp4')).status).toBe(404)
        expect((await get('/media/project.json')).status).toBe(404)
        expect((await get('/thumb/..%2F..%2F..%2Foutside.mp4')).status).toBe(404)
    })
    test('byte ranges', () => {
        expect(byteRange('bytes=0-3', 10)).toEqual({first: 0, last: 3})
        expect(byteRange('bytes=5-', 10)).toEqual({first: 5, last: 9})
        expect(byteRange('bytes=-4', 10)).toEqual({first: 6, last: 9})
        expect(byteRange('bytes=8-99', 10)).toEqual({first: 8, last: 9})
        expect(byteRange('bytes=10-', 10)).toBeUndefined()
        expect(byteRange('bytes=4-2', 10)).toBeUndefined()
        expect(byteRange('bytes=-', 10)).toBeUndefined()
        expect(byteRange('lines=0-3', 10)).toBeUndefined()
    })
    test('a video can be asked for piece by piece', async () => {
        const piece = await get('/media/videos/slot-001.mp4', {headers: {range: 'bytes=2-5'}})
        expect(piece.status).toBe(206)
        expect(piece.headers.get('content-range')).toBe('bytes 2-5/10')
        expect(await piece.text()).toBe('2345')
        const whole = await get('/media/videos/slot-001.mp4')
        expect(whole.status).toBe(200)
        expect(whole.headers.get('accept-ranges')).toBe('bytes')
        expect((await get('/media/videos/slot-001.mp4', {headers: {range: 'bytes=50-'}})).status).toBe(416)
    })
    test('nothing but the page itself can change anything', async () => {
        expect((await get('/api/stop', {method: 'POST', headers: {origin: 'http://evil.example'}, body: '{}'})).status).toBe(403)
        expect((await get('/api/stop', {method: 'POST', headers: {'sec-fetch-site': 'cross-site'}, body: '{}'})).status).toBe(403)
        expect((await get('/api/project', {method: 'DELETE'})).status).toBe(405)
        expect((await handler(new Request('http://evil.example/api/projects'))).status).toBe(403)
    })
    test('the page and what it asks for', async () => {
        const page = await handler(new Request('http://localhost/'))
        expect(page.headers.get('content-type')).toContain('text/html')
        expect(await page.text()).toContain('prefers-color-scheme')
        expect(await (await get('/api/project')).json()).toMatchObject({id: 'music', kind: 'music'})
        expect(await (await get('/api/freshness')).json()).toMatchObject({clips: {'slot-001': 'stale'}})
        expect((await get('/api/nothing')).status).toBe(404)
        expect((await handler(new Request('http://localhost/p/music/none/api/project'))).status).toBe(404)
        expect((await handler(new Request('http://localhost/p/music/..%2Ffilms/api/project'))).status).toBe(404)
    })
    test('a thumbnail of any other width is not made', async () => {
        expect((await get('/thumb/assets/locations/hall.png?w=7')).status).toBe(404)
        expect((await get('/thumb/videos/slot-001.mp4')).status).toBe(404)
    })
    test('a project that cannot be read says so instead of breaking', async () => {
        const dir = join(root, 'projects', 'broken')
        write(join(dir, 'output/clips/slot-001.json'), '{"id": ')
        const response = await editorHandler()(new Request('http://localhost/p/music/broken/api/project'))
        expect(response.status).toBe(503)
        expect((await response.json() as { error: string }).error).toBeTruthy()
    })
})

describe('peaks', () => {
    test('the loudest part is 1, a silent one 0', () => {
        expect(peaks(new Int16Array([0, 0, 1000, -1000]), 2)).toEqual([0, 1])
    })
    test('loudness, not the highest sample: a single spike does not look as loud as a held note', () => {
        const [spike, held] = peaks(new Int16Array([30000, 0, 0, 0, 20000, 20000, 20000, 20000]), 2)
        expect(spike!).toBeLessThan(held!)
    })
    test('no sound, or fewer samples than parts', () => {
        expect(peaks(new Int16Array(0), 3)).toEqual([0, 0, 0])
        expect(peaks(new Int16Array([1000]), 2)).toEqual([1, 0])
    })
})
