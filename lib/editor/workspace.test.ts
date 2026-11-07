import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, dirname, join} from "node:path";
import {clipVersions, pictureVersions, restoreClipVersion, restorePictureVersion} from "../archive.ts";
import {lockHolder, lockProject, withProjectLock} from "../lock.ts";
import {namedPictures, putAwayPicture} from "../render.ts";
import {finalStateOf} from "../render-state.ts";
import {readCasting, readLibrary, writeCastingEntry} from "./library.ts";
import type {EditorTarget} from "./project.ts";
import {projectGroup, readEditorProject, readListing} from "./project.ts";
import {allowedOptions, RunControl, runCommand} from "./runs.ts";
import {editorHandler} from "./server.ts";
import {checkUploadSize, pictureType, takePictureUpload, UPLOAD_MAX_BYTES} from "./upload.ts";
import {loadSettings} from "../settings.ts";
import {explainFailure, runProgress} from "./progress.ts";
import {chosenUrls, readServer} from "./servers.ts";

let root: string
const here = process.cwd()
const write = (file: string, content: unknown = 'x') => {
    mkdirSync(dirname(file), {recursive: true})
    writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content))
}
const old = new Date(1_000_000)
const target = (id: string, kind: 'music' | 'film' = 'music'): EditorTarget => ({id, kind, dir: join(root, kind === 'film' ? 'films' : 'projects', id)})

beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'workspace-'))
    process.chdir(root)
})
afterAll(() => {
    process.chdir(here)
    rmSync(root, {recursive: true, force: true})
})

describe('versions of a clip', () => {
    const project = () => target('versions').dir
    const clip = 'slot-001'
    beforeAll(() => {
        const dir = project()
        write(join(dir, `videos/${clip}.mp4`), 'now')
        write(join(dir, `videos/${clip}.mp4.json`), {seed: 3, fingerprint: 'c'})
        write(join(dir, `assets/clips/${clip}_ff.png`), 'now-ff')
        write(join(dir, `assets/clips/${clip}_lf.png`), 'now-lf')
        const again = join(dir, `old/attempts/${clip}-20261101-120000`)
        write(join(again, `${clip}.mp4`), 'again')
        write(join(again, `${clip}.mp4.json`), {seed: 1, fingerprint: 'a', workflow: 'wf', size: '1x1'})
        write(join(again, `${clip}_ff.png`), 'again-ff')
        write(join(again, `${clip}_lf.png`), 'again-lf')
        utimesSync(join(again, `${clip}.mp4`), old, old)
        const stale = join(dir, `old/attempts/stale-20261101-110000-videos-${clip}.mp4`)
        write(join(stale, `${clip}.mp4`), 'stale')
        write(join(stale, `${clip}.mp4.json`), {seed: 2})
        write(join(dir, `old/leaks/${clip}-seed-77.mp4`), 'leak')
        // of another clip, and a preview of this one: not its versions
        write(join(dir, 'old/attempts/slot-0011-20261101-120000/slot-0011.mp4'))
        write(join(dir, `old/attempts/${clip}-preview-20261101-120000/${clip}.mp4`))
    })
    test('all three kinds of place, the newest first, none of another clip', () => {
        const versions = clipVersions(project(), clip)
        expect(versions.map(v => v.source).sort()).toEqual(['again', 'leak', 'stale'])
        expect(versions.at(-1)!.source).toBe('again')
        expect(versions.find(v => v.source === 'leak')).toMatchObject({seed: 77, video: `old/leaks/${clip}-seed-77.mp4`})
        expect(versions.find(v => v.source === 'again')).toMatchObject({seed: 1, workflow: 'wf', firstFrame: `old/attempts/${clip}-20261101-120000/${clip}_ff.png`})
    })
    test('putting one back moves all of it, puts away what is there, and counts as new: the final video is older than it', () => {
        const dir = project()
        write(join(dir, 'versions.mp4'), 'final')
        expect(finalStateOf(dir, join(dir, 'versions.mp4'), [{id: clip}])).toBe('current')
        restoreClipVersion(dir, clip, `old/attempts/${clip}-20261101-120000`)
        expect(readFileSync(join(dir, `videos/${clip}.mp4`), 'utf8')).toBe('again')
        expect(JSON.parse(readFileSync(join(dir, `videos/${clip}.mp4.json`), 'utf8')).seed).toBe(1)
        expect(readFileSync(join(dir, `assets/clips/${clip}_lf.png`), 'utf8')).toBe('again-lf')
        expect(existsSync(join(dir, `old/attempts/${clip}-20261101-120000`))).toBe(false)
        // set to an hour ago: what was restored has to count as newer than a final video made before it
        const anHourAgo = new Date(Date.now() - 3_600_000)
        utimesSync(join(dir, 'versions.mp4'), anHourAgo, anHourAgo)
        expect(statSync(join(dir, `videos/${clip}.mp4`)).mtimeMs).toBeGreaterThan(anHourAgo.getTime())
        expect(finalStateOf(dir, join(dir, 'versions.mp4'), [{id: clip}])).toBe('older')
        // what was there is a version now, with its seed and frames
        const putAway = clipVersions(dir, clip).find(v => v.seed === 3)!
        expect(readFileSync(join(dir, putAway.video), 'utf8')).toBe('now')
        expect(readFileSync(join(dir, putAway.lastFrame!), 'utf8')).toBe('now-lf')
    })
    test('one from the backdrop check has only its video: a sidecar with its seed, frames left to the next run', () => {
        const dir = project()
        restoreClipVersion(dir, clip, `old/leaks/${clip}-seed-77.mp4`)
        expect(readFileSync(join(dir, `videos/${clip}.mp4`), 'utf8')).toBe('leak')
        expect(JSON.parse(readFileSync(join(dir, `videos/${clip}.mp4.json`), 'utf8')).seed).toBe(77)
        expect(existsSync(join(dir, `assets/clips/${clip}_ff.png`))).toBe(false)
    })
    test('a version that is not one is refused, and nothing moves', () => {
        const dir = project()
        const before = readFileSync(join(dir, `videos/${clip}.mp4`), 'utf8')
        expect(() => restoreClipVersion(dir, clip, '../../secret')).toThrow('has no version')
        expect(readFileSync(join(dir, `videos/${clip}.mp4`), 'utf8')).toBe(before)
    })
})

describe('versions of a picture', () => {
    const dir = () => target('pictures').dir
    const picture = {id: 'hall', file: 'assets/locations/hall.png'}
    const sheet = 'assets/sequence/locations/hall'
    beforeAll(() => {
        write(join(dir(), picture.file), 'now')
        write(join(dir(), `${sheet}/anchor.png`), 'now-anchor')
        write(join(dir(), `${sheet}/frames/frame_00.png`), 'now-frame')
        const again = join(dir(), 'old/attempts/hall-20261101-120000')
        write(join(again, 'hall.png'), 'then')
        write(join(again, 'hall.png.json'), {seed: 5, prompt: 'then'})
        write(join(again, 'anchor.png'), 'then-anchor')
        write(join(again, 'sequence.mp4'), 'then-video')
        write(join(again, 'frame_00.png'), 'then-frame')
        write(join(dir(), 'old/attempts/stale-20261101-110000-assets-locations-hall.png/hall.png'), 'older')
        write(join(dir(), 'old/attempts/hall-library-20261101-100000/hall.png'), 'library')
    })
    test('every kind, with what a sheet has', () => {
        const versions = pictureVersions(dir(), picture)
        expect(versions.map(v => v.source).sort()).toEqual(['again', 'library', 'stale'])
        expect(versions.find(v => v.source === 'again')).toMatchObject({seed: 5, prompt: 'then', anchor: 'old/attempts/hall-20261101-120000/anchor.png', video: 'old/attempts/hall-20261101-120000/sequence.mp4'})
    })
    test('putting one back puts its flat files where a sheet has them, and all of what is there away', () => {
        restorePictureVersion(dir(), picture, 'old/attempts/hall-20261101-120000', sheet)
        const read = (file: string) => readFileSync(join(dir(), file), 'utf8')
        expect(read(picture.file)).toBe('then')
        expect(read(`${sheet}/anchor.png`)).toBe('then-anchor')
        expect(read(`${sheet}/sequence.mp4`)).toBe('then-video')
        expect(read(`${sheet}/frames/frame_00.png`)).toBe('then-frame')
        const putAway = pictureVersions(dir(), picture).find(v => v.anchor && readFileSync(join(dir(), v.picture), 'utf8') === 'now')!
        expect(readFileSync(join(dir(), putAway.anchor!), 'utf8')).toBe('now-anchor')
    })
})

describe('a picture put away by an older version, its sheet in a folder of its own', () => {
    const dir = () => target('nested-sheet').dir
    const picture = {id: 'elias', file: 'assets/characters/elias.png'}
    const sheet = 'assets/sequence/characters/elias'
    test('it is listed with its anchor and video, and goes back whole', () => {
        write(join(dir(), picture.file), 'now')
        write(join(dir(), `${sheet}/anchor.png`), 'now-anchor')
        const old = join(dir(), 'old/attempts/elias-20261027-080644')
        write(join(old, 'elias.png'), 'then')
        write(join(old, 'elias/anchor.png'), 'then-anchor')
        write(join(old, 'elias/sequence.mp4'), 'then-video')
        write(join(old, 'elias/frames/frame_00.png'), 'then-frame')
        expect(pictureVersions(dir(), picture)[0]).toMatchObject({anchor: 'old/attempts/elias-20261027-080644/elias/anchor.png', video: 'old/attempts/elias-20261027-080644/elias/sequence.mp4'})
        restorePictureVersion(dir(), picture, 'old/attempts/elias-20261027-080644', sheet)
        const read = (file: string) => readFileSync(join(dir(), file), 'utf8')
        expect(read(picture.file)).toBe('then')
        expect(read(`${sheet}/anchor.png`)).toBe('then-anchor')
        expect(read(`${sheet}/sequence.mp4`)).toBe('then-video')
        expect(read(`${sheet}/frames/frame_00.png`)).toBe('then-frame')
        expect(existsSync(old)).toBe(false)
    })
})

describe('a sheet made again on the same anchor', () => {
    const dir = () => target('same-anchor').dir
    const picture = {kind: 'location' as const, id: 'yard', file: 'assets/locations/yard.png', name: 'Yard', prompt: '', description: ''}
    const sheet = 'assets/sequence/locations/yard'
    test('its version keeps a copy of the anchor, which stays where it is - and putting the version back is whole', () => {
        write(join(dir(), picture.file), 'first')
        write(join(dir(), `${sheet}/anchor.png`), 'the-anchor')
        write(join(dir(), `${sheet}/sequence.mp4`), 'first-video')
        const kept = putAwayPicture(picture, dir(), {sequenceSheets: true}, false)
        expect(readFileSync(join(dir(), `${sheet}/anchor.png`), 'utf8')).toBe('the-anchor')
        expect(readFileSync(join(kept, 'anchor.png'), 'utf8')).toBe('the-anchor')
        // a new anchor and sheet since then - the version brings back the anchor its sheet was made from
        write(join(dir(), picture.file), 'second')
        write(join(dir(), `${sheet}/anchor.png`), 'new-anchor')
        restorePictureVersion(dir(), picture, `old/attempts/${basename(kept)}`, sheet)
        expect(readFileSync(join(dir(), `${sheet}/anchor.png`), 'utf8')).toBe('the-anchor')
        expect(readFileSync(join(dir(), `${sheet}/sequence.mp4`), 'utf8')).toBe('first-video')
    })
    test('an anchor drawn from an edited prompt goes with the version: the plan draws its own again', () => {
        write(join(dir(), picture.file), 'edited-sheet')
        write(join(dir(), `${sheet}/anchor.png`), 'edited-anchor')
        write(join(dir(), `${sheet}/anchor.png.json`), JSON.stringify({prompt: 'mine', pinned: true, editedPrompt: 'mine'}))
        const kept = putAwayPicture(picture, dir(), {sequenceSheets: true}, false)
        expect(existsSync(join(dir(), `${sheet}/anchor.png`))).toBe(false)
        expect(readFileSync(join(kept, 'anchor.png'), 'utf8')).toBe('edited-anchor')
    })
    test('the user\'s own anchor stays for a new sheet, even with a prompt noted on it', () => {
        write(join(dir(), picture.file), 'own-sheet')
        write(join(dir(), `${sheet}/anchor.png`), 'own-anchor')
        write(join(dir(), `${sheet}/anchor.png.json`), JSON.stringify({source: 'user', pinned: true, editedPrompt: 'mine'}))
        putAwayPicture(picture, dir(), {sequenceSheets: true}, false)
        expect(readFileSync(join(dir(), `${sheet}/anchor.png`), 'utf8')).toBe('own-anchor')
    })
    test('a version put away without its anchor (before they kept one) leaves the sheet with the anchor that was there, not none', () => {
        write(join(dir(), `${sheet}/anchor.png`), 'current-anchor')
        write(join(dir(), 'old/attempts/yard-20261101-090000/yard.png'), 'old-picture')
        write(join(dir(), 'old/attempts/yard-20261101-090000/sequence.mp4'), 'old-video')
        restorePictureVersion(dir(), picture, 'old/attempts/yard-20261101-090000', sheet)
        expect(readFileSync(join(dir(), `${sheet}/anchor.png`), 'utf8')).toBe('current-anchor')
        expect(readFileSync(join(dir(), `${sheet}/sequence.mp4`), 'utf8')).toBe('old-video')
    })
})

describe('which pictures --only means', () => {
    const pictures = [{id: 'a'}, {id: 'b'}]
    test('the ones it names, or all when it is about clips', () => {
        expect(namedPictures(pictures, new Set(['a']), false)).toEqual([{id: 'a'}])
        expect(namedPictures(pictures, new Set(['slot-001']), false)).toEqual(pictures)
        expect(namedPictures(pictures, new Set(), false)).toEqual(pictures)
    })
    test('with --again and no clips a name that is no picture is an error: every one is GPU time', () => {
        expect(() => namedPictures(pictures, new Set(['a', 'typo']), true)).toThrow('no picture typo')
    })
})

describe('the lock', () => {
    test('held while the work is done, free afterwards, and it holds a run off', async () => {
        const dir = target('locked').dir
        mkdirSync(dir, {recursive: true})
        let during: number | undefined
        await withProjectLock(dir, 'x', () => { during = lockHolder(dir) })
        expect(during).toBe(process.pid)
        expect(lockHolder(dir)).toBeUndefined()
    })
    test('the work is refused while another process holds it', async () => {
        const dir = target('held').dir
        write(join(dir, '.lock'), String(process.ppid))
        await expect(withProjectLock(dir, 'x', () => {})).rejects.toThrow('another run')
        expect(lockHolder(dir)).toBe(process.ppid)
    })
    test('a lock of a process that is gone is not held', () => {
        const dir = target('gone').dir
        write(join(dir, '.lock'), '2147483646')
        expect(lockHolder(dir)).toBeUndefined()
    })
    test('released also when the work fails', async () => {
        const dir = target('fails').dir
        mkdirSync(dir, {recursive: true})
        await expect(withProjectLock(dir, 'x', () => { throw new Error('no') })).rejects.toThrow('no')
        expect(lockHolder(dir)).toBeUndefined()
    })
    test('the CLI lock still is what it was', () => {
        const dir = target('cli').dir
        mkdirSync(dir, {recursive: true})
        const release = lockProject(dir, 'x')
        expect(lockHolder(dir)).toBe(process.pid)
        release()
    })
})

describe('what can be started', () => {
    const music = {id: 'demo', kind: 'music' as const}
    const film = {id: 'demo', kind: 'film' as const}
    test('what is asked for comes to a command of the pipeline', () => {
        expect(runCommand(music, {type: 'clips', ids: ['slot-001', 'slot-002'], again: true})).toEqual({script: 'index.ts', args: ['demo', '--render=videos', '--only=slot-001,slot-002', '--again']})
        expect(runCommand(film, {type: 'clips', ids: ['clip-001']})).toEqual({script: 'film.ts', args: ['demo', '--render=videos', '--only=clip-001']})
        expect(runCommand(music, {type: 'pictures', ids: ['hall'], again: true, newAnchor: true})).toEqual({script: 'index.ts', args: ['demo', '--render=images', '--only=hall', '--again', '--new-anchor']})
        expect(runCommand(film, {type: 'pictures', ids: ['hall'], again: true, anchorFile: '/tmp/u/picture.png', descriptionFile: '/tmp/u/description.txt'})).toEqual({script: 'film.ts', args: ['demo', '--render=images', '--only=hall', '--again', '--picture-anchor=/tmp/u/picture.png', '--picture-description=/tmp/u/description.txt']})
        expect(runCommand(music, {type: 'pictures', ids: ['hall'], again: true, anchorFile: '/tmp/u/picture.png', describe: true}).args.slice(4)).toEqual(['--picture-anchor=/tmp/u/picture.png', '--describe-picture'])
        expect(runCommand(film, {type: 'leak-scan'})).toEqual({script: 'tools/leak-scan.ts', args: ['demo', '--film']})
        expect(runCommand(music, {type: 'retake', clip: 'slot-007', range: '3.2-5'})).toEqual({script: 'index.ts', args: ['demo', '--retake=slot-007:3.2-5']})
        expect(runCommand(music, {type: 'retake', clip: 'slot-007', range: 'shot2'}).args[1]).toBe('--retake=slot-007:shot2')
    })
    test('a further view of a place: only for a film, with what it shows as one argument each', () => {
        expect(runCommand(film, {type: 'add-view', location: 'hall', name: 'from the bar', shows: 'the door --film'})).toEqual({script: 'tools/add-view.ts', args: ['demo', 'hall', '--name=from the bar', '--shows=the door --film']})
        expect(() => runCommand(music, {type: 'add-view', location: 'hall', name: 'a', shows: 'b'})).toThrow('a place of a film')
        expect(() => runCommand(film, {type: 'add-view', location: 'hall', name: ' ', shows: 'b'})).toThrow('a place of a film')
    })
    test('the song into the library: a music video only, the id checked, the name one argument', () => {
        expect(runCommand(music, {type: 'export-song', as: 'epa', name: 'EPA  streikt --film'})).toEqual({script: 'tools/export-song.ts', args: ['demo', '--as=epa', '--name=EPA streikt --film']})
        expect(runCommand(music, {type: 'export-song'})).toEqual({script: 'tools/export-song.ts', args: ['demo']})
        expect(() => runCommand(music, {type: 'export-song', as: '--film'})).toThrow('no usable song id')
        expect(() => runCommand(film, {type: 'export-song'})).toThrow('a film has no song')
    })
    test('nothing but ids gets into a command', () => {
        expect(() => runCommand(music, {type: 'clips', ids: ['--comfy=http://evil']})).toThrow('no such clips')
        expect(() => runCommand(music, {type: 'clips', ids: []})).toThrow('no such clips')
        expect(() => runCommand(music, {type: 'pictures', ids: ['a b']})).toThrow('no such pictures')
        expect(() => runCommand(music, {type: 'retake', clip: 'slot-007', range: '1-2 --again'})).toThrow('not a part')
        expect(() => runCommand(music, {type: 'export-asset', asset: 'a', as: '--film'})).toThrow('no such asset')
    })
    test('a command of the last run or of status only with rendering in it', () => {
        expect(allowedOptions('music', 'demo', 'bun index.ts demo --render=videos --refresh=clips')).toEqual(['--render=videos', '--refresh=clips'])
        expect(allowedOptions('film', 'demo', 'bun film.ts demo --render=final')).toEqual(['--render=final'])
        expect(allowedOptions('music', 'demo', 'bun index.ts demo')).toEqual([])
        // what asks in the terminal, or changes the servers, or another project, or another script
        expect(allowedOptions('music', 'demo', 'bun index.ts demo --review')).toBeUndefined()
        // the servers are chosen again on the page: what the command said about them does not come along
        expect(allowedOptions('music', 'demo', 'bun index.ts demo --comfy=http://evil')).toEqual([])
        expect(allowedOptions('music', 'demo', 'bun index.ts other --render=videos')).toBeUndefined()
        expect(allowedOptions('music', 'demo', 'bun tools/evil.ts demo')).toBeUndefined()
        expect(allowedOptions('music', 'demo', 'bun film.ts demo')).toBeUndefined()
    })
})

describe('a run', () => {
    // a stand-in for the pipeline: says something, and lives as long as it is told to
    const script = (name: string, source: string) => write(join(root, 'fake', name), source)
    const until = async (done: () => boolean) => {
        for (let i = 0; i < 200 && !done(); i++) await Bun.sleep(25)
        expect(done()).toBe(true)
    }
    test('its lines can be followed, and how it ended is known', async () => {
        script('index.ts', `console.log('one'); console.error('two'); process.stdout.write('three'); process.exit(3)`)
        const runs = new RunControl(join(root, 'fake'))
        const project = target('run-a')
        mkdirSync(project.dir, {recursive: true})
        const started = runs.start(project, {type: 'plan'})
        expect(started).toMatchObject({source: 'here', running: true, command: 'bun index.ts run-a'})
        await until(() => runs.current(project)?.running === false)
        await Bun.sleep(50)
        expect(runs.current(project)).toMatchObject({running: false, code: 3})
        const {lines, next} = runs.lines(project, 0)
        expect(lines.toSorted()).toEqual(['one', 'three', 'two'])
        expect(runs.lines(project, next).lines).toEqual([])
    })
    test('a second one is refused, stopping ends it', async () => {
        script('index.ts', `console.log('started'); await Bun.sleep(60000)`)
        const runs = new RunControl(join(root, 'fake'))
        const project = target('run-b')
        mkdirSync(project.dir, {recursive: true})
        runs.start(project, {type: 'plan'})
        expect(() => runs.start(project, {type: 'plan'})).toThrow('a run is going on')
        await until(() => runs.lines(project, 0).lines.includes('started'))
        expect(runs.stop(project)).toBe(true)
        await until(() => runs.current(project)?.running === false)
        expect(runs.stop(project)).toBe(false)
    })
    test('what it is given for the run alone goes when it has ended, or when it is not started', async () => {
        script('index.ts', `process.exit(0)`)
        const runs = new RunControl(join(root, 'fake'))
        const project = target('run-temp')
        mkdirSync(project.dir, {recursive: true})
        const given = mkdtempSync(join(root, 'given-'))
        runs.start(project, {type: 'plan'}, undefined, [given])
        await until(() => !existsSync(given))
        expect(existsSync(given)).toBe(false)
        const refused = mkdtempSync(join(root, 'given-'))
        expect(() => runs.start(project, {type: 'pictures', ids: ['a b']}, undefined, [refused])).toThrow('no such pictures')
        expect(existsSync(refused)).toBe(false)
    })
    test('nothing is started while a run in the terminal holds the lock; it can be seen', () => {
        const runs = new RunControl(join(root, 'fake'))
        const project = target('run-c')
        write(join(project.dir, '.lock'), String(process.ppid))
        expect(() => runs.start(project, {type: 'plan'})).toThrow('being worked on by another run')
        expect(runs.current(project)).toMatchObject({source: 'terminal', running: true, pid: process.ppid})
    })
    test('a run in the terminal: its log is followed', () => {
        const runs = new RunControl(join(root, 'fake'))
        const project = target('run-d')
        write(join(project.dir, '.lock'), String(process.ppid))
        write(join(project.dir, 'logs/20260101-000000.log'), 'first\nsecond\n')
        const {lines, next} = runs.lines(project, 0)
        expect(lines).toEqual(['first', 'second'])
        write(join(project.dir, 'logs/20260101-000000.log'), 'first\nsecond\nthird\n')
        expect(runs.lines(project, next).lines).toEqual(['third'])
    })
})

describe('the render servers', () => {
    const server = {name: 'a', url: 'http://a'}
    test('how busy one is, from its queue and stats', async () => {
        const fetcher = (async (url: string) => Response.json(url.endsWith('/queue') ? {queue_running: [1], queue_pending: [1, 2]} : {devices: [{name: 'cuda:0 NVIDIA GeForce RTX 5090 : cudaMallocAsync', vram_free: 2 ** 30 * 7.25, vram_total: 2 ** 30 * 32}]})) as unknown as typeof fetch
        expect(await readServer(server, fetcher)).toEqual({name: 'a', reachable: true, running: 1, pending: 2, device: 'NVIDIA GeForce RTX 5090', freeGb: 7.3, totalGb: 32})
    })
    test('one that does not answer or answers an error is not reachable, and does not fail the page', async () => {
        const down = (async () => { throw new Error('refused') }) as unknown as typeof fetch
        const bad = (async () => new Response('Bad Gateway', {status: 502})) as unknown as typeof fetch
        for (const fetcher of [down, bad]) expect(await readServer(server, fetcher)).toEqual({name: 'a', reachable: false, running: 0, pending: 0})
    })
    const all = [{name: 'rtx', url: 'http://rtx'}, {name: 'radeon', url: 'http://radeon'}]
    test('a choice by name comes to the URLs of the settings; all of them is the same as saying nothing', () => {
        expect(chosenUrls(all, ['radeon'])).toEqual(['http://radeon'])
        expect(chosenUrls(all, ['rtx', 'radeon'])).toBeUndefined()
        expect(chosenUrls(all, undefined)).toBeUndefined()
    })
    test('no URL or unknown name gets through, and nothing is no choice', () => {
        expect(() => chosenUrls(all, ['http://evil'])).toThrow('no server')
        expect(() => chosenUrls(all, [])).toThrow('at least one')
        expect(() => chosenUrls(all, 'rtx')).toThrow('at least one')
    })
    test('a server of the settings named by its URL keeps its name and credentials', async () => {
        const file = join(root, 'settings-servers.json')
        write(file, {comfy: [{url: 'http://rtx:8188', name: 'rtx', token: 'secret'}, {url: 'http://radeon', name: 'radeon'}]})
        const before = {settings: process.env.FEVERSLOP_SETTINGS, comfy: process.env.FEVERSLOP_COMFY}
        process.env.FEVERSLOP_SETTINGS = file
        process.env.FEVERSLOP_COMFY = 'http://rtx:8188'
        try {
            const {comfy} = await loadSettings()
            expect(comfy).toHaveLength(1)
            expect(comfy[0]).toMatchObject({url: 'http://rtx:8188', name: 'rtx'})
            expect(comfy[0]!.credentials).toBeDefined()
            // another server stays what the URL says, without anything of the settings
            expect((await loadSettings({comfy: 'http://other:1'})).comfy).toEqual([{url: 'http://other:1', name: 'other:1'}])
        } finally {
            if (before.settings === undefined) delete process.env.FEVERSLOP_SETTINGS
            else process.env.FEVERSLOP_SETTINGS = before.settings
            if (before.comfy === undefined) delete process.env.FEVERSLOP_COMFY
            else process.env.FEVERSLOP_COMFY = before.comfy
        }
    })
    test('a run goes to the chosen servers, and says so', async () => {
        write(join(root, 'fake', 'index.ts'), `console.log(process.env.FEVERSLOP_COMFY ?? 'none')`)
        const runs = new RunControl(join(root, 'fake'))
        const project = target('run-servers')
        mkdirSync(project.dir, {recursive: true})
        expect(runs.start(project, {type: 'plan'}, ['http://radeon']).command).toBe('bun index.ts run-servers --comfy=http://radeon')
        for (let i = 0; i < 200 && !runs.lines(project, 0).lines.length; i++) await Bun.sleep(25)
        expect(runs.lines(project, 0).lines).toEqual(['http://radeon'])
    })
    test('a command with servers can be repeated: where it goes is chosen again', () => {
        expect(allowedOptions('music', 'demo', 'bun index.ts demo --render=videos --comfy=http://evil')).toEqual(['--render=videos'])
    })
})

describe('how far a run has come', () => {
    const clips = ['slot-001', 'slot-002', 'slot-003', 'slot-004']
    const dir = () => target('progress').dir
    const later = new Date(2_000_000)
    beforeAll(() => {
        // done in this run, on a server, there from before, not there
        write(join(dir(), 'videos/slot-001.mp4'))
        utimesSync(join(dir(), 'videos/slot-001.mp4'), later, later)
        write(join(dir(), 'videos/slot-002.mp4.pending.json'), {})
        write(join(dir(), 'videos/slot-003.mp4'))
        utimesSync(join(dir(), 'videos/slot-003.mp4'), old, old)
    })
    const started = 1_500_000
    test('what is rendered, on a server, waiting; what was there from before has nothing to do with it', () => {
        expect(runProgress(dir(), 'bun index.ts x --render=videos', started, clips)).toEqual({clips: {'slot-001': 'done', 'slot-002': 'rendering', 'slot-004': 'waiting'}, done: 1, total: 3})
    })
    test('only the clips it names', () => {
        expect(runProgress(dir(), 'bun index.ts x --render=videos --only=slot-001,slot-004', started, clips)?.clips).toEqual({'slot-001': 'done', 'slot-004': 'waiting'})
    })
    test('with --again a clip from before still is to come', () => {
        expect(runProgress(dir(), 'bun index.ts x --render=videos --only=slot-003 --again', started, clips)?.clips).toEqual({'slot-003': 'waiting'})
    })
    test('previews are looked for in their folder', () => {
        write(join(dir(), 'previews/slot-001.mp4.pending.json'), {})
        expect(runProgress(dir(), 'bun index.ts x --render=videos --only=slot-001 --preview', started, clips)?.clips).toEqual({'slot-001': 'rendering'})
    })
    test('a part of a clip', () => {
        expect(runProgress(dir(), 'bun index.ts x --retake=slot-002:1-2', started, clips)?.clips).toEqual({'slot-002': 'waiting'})
        write(join(dir(), 'assets/clips/slot-002_retake.mp4.pending.json'), {})
        expect(runProgress(dir(), 'bun index.ts x --retake=slot-002:1-2', started, clips)?.clips).toEqual({'slot-002': 'rendering'})
    })
    test('a run that renders no clips has no progress', () => {
        expect(runProgress(dir(), 'bun index.ts x', started, clips)).toBeUndefined()
        expect(runProgress(dir(), 'bun index.ts x --render=images', started, clips)).toBeUndefined()
        expect(runProgress(dir(), 'bun index.ts x --render=final', started, clips)).toBeUndefined()
    })
})

describe('what a failure means', () => {
    test('what can be told surely, in words, with what to do', () => {
        expect(explainFailure('part of slot-016: ComfyUI job failed in MiniMaxH3AddGuide - HIP out of memory. Tried to allocate 7.17 GiB.')?.text).toContain('ran out of memory')
        expect(explainFailure('clip slot-046: CUDA out of memory')?.text).toContain('ran out of memory')
        expect(explainFailure('ComfyUI x (http://x) has not answered for 5 minutes - start it again')?.text).toContain('does not answer')
        expect(explainFailure('No ComfyUI server reachable (http://x)')?.text).toContain('does not answer')
        expect(explainFailure('casting.json: character "a" is "library:b", but the library has no character "b"')?.action).toContain('Casting')
    })
    test('everything else stays as it is', () => {
        expect(explainFailure('ffmpeg could not cut this')).toBeUndefined()
    })
    test('forty clips out of memory are one thing to do', async () => {
        const project = target('explained')
        const failures = Array.from({length: 3}, (_, n) => `clip slot-00${n}: CUDA out of memory`)
        write(join(project.dir, 'logs/last-run.json'), {command: 'bun index.ts explained', pid: 1, startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), exitCode: 1, failures})
        const {lastRun} = await readEditorProject(project)
        expect(lastRun?.explained).toHaveLength(1)
        expect(lastRun?.failures).toHaveLength(3)
    })
})

describe('the start page', () => {
    test('a project in a line, from what lies in its folder', () => {
        const project = target('listed')
        write(join(project.dir, 'output/clips/slot-001.json'), {id: 'slot-001'})
        write(join(project.dir, 'output/clips/slot-002.json'), {id: 'slot-002'})
        write(join(project.dir, 'videos/slot-001.mp4'))
        write(join(project.dir, 'assets/clips/slot-001_ff.png'))
        write(join(project.dir, 'assets/characters/ann.png'))
        expect(readListing(project)).toMatchObject({id: 'listed', kind: 'music', title: 'listed', clips: 2, rendered: 1, pictures: 1, final: 'missing', thumb: {file: 'assets/clips/slot-001_ff.png'}})
    })
    test('takes of one thing fold together, from their ids alone', () => {
        const same = (...ids: string[]) => expect(new Set(ids.map(projectGroup)).size).toBe(1)
        same('schwarzer-flur-261026', 'schwarzer-flur-261026-sing', 'schwarzer-flur-261026-sing-c', 'schwarzer-flur-261028', 'schwarzer-flur-261026-b')
        same('witch-test', 'witch-test-2', 'witch-test-6')
        same('gefangen', 'gefangen-261028', 'gefangen-202609282327', 'gefangen-261004-b')
        expect(projectGroup('last-rehearsal')).not.toBe(projectGroup('second-earth-v2'))
        expect(projectGroup('crimson-bloom')).toBe('crimson-bloom')
        expect(projectGroup('a')).toBe('a')
    })
    test('a film by its title, and a broken project.json does not lose the card', () => {
        const film = target('titled', 'film')
        write(join(film.dir, 'project.json'), {screenplay: {title: 'The Title', scenes: []}})
        write(join(film.dir, 'input/idea.txt'))
        expect(readListing(film).title).toBe('The Title')
        write(join(film.dir, 'project.json'), '{"screenplay": ')
        expect(readListing(film).title).toBe('titled')
    })
    test('all projects and films, and the page at every address', async () => {
        write(join(target('listed').dir, 'input/idea.txt'))
        // the page is the built client: a stand-in, so bun run test needs no client build
        const publicDir = join(root, 'public')
        mkdirSync(publicDir, {recursive: true})
        writeFileSync(join(publicDir, 'index.html'), '<title>Workspace</title>')
        const handler = editorHandler(undefined, {publicDir})
        const {projects} = await (await handler(new Request('http://localhost/api/projects'))).json() as { projects: { id: string, kind: string }[] }
        expect(projects.some(p => p.id === 'listed' && p.kind === 'music')).toBe(true)
        expect(projects.some(p => p.id === 'titled' && p.kind === 'film')).toBe(true)
        for (const path of ['/', '/library', '/p/music/listed/', '/p/music/listed/references', '/p/music/listed/direction', '/p/film/titled/direction', '/p/film/titled/casting']) expect((await handler(new Request(`http://localhost${path}`))).headers.get('content-type')).toContain('text/html')
    })
})

describe('the finished videos of a project', () => {
    test('what the name says it is, in a useful order; try-outs and other files are none', async () => {
        const {finalLabel} = await import('./project.ts')
        expect(finalLabel('demo', 'demo.mp4')).toMatchObject({label: 'Final', preview: false})
        expect(finalLabel('demo', 'demo-finished.mp4')).toMatchObject({label: 'Final finished'})
        expect(finalLabel('demo', 'demo-48fps.mp4')).toMatchObject({label: 'Final 48 fps'})
        expect(finalLabel('demo', 'demo-48fps-finished.mp4')).toMatchObject({label: 'Final 48 fps finished'})
        expect(finalLabel('demo', 'demo-preview.mp4')).toMatchObject({label: 'Preview video', preview: true})
        for (const other of ['demo-partial.mp4', 'demo-partial-48fps.mp4', 'demo-2.mp4', 'other.mp4', 'demo.srt', 'demo-b.mp4']) expect(finalLabel('demo', other)).toBeUndefined()
        const order = ['demo-preview.mp4', 'demo-48fps-finished.mp4', 'demo.mp4', 'demo-48fps.mp4', 'demo-finished.mp4'].sort((a, b) => finalLabel('demo', a)!.order - finalLabel('demo', b)!.order)
        expect(order).toEqual(['demo.mp4', 'demo-finished.mp4', 'demo-48fps.mp4', 'demo-48fps-finished.mp4', 'demo-preview.mp4'])
    })
    test('each with its size and frame rate, and whether it is older than the clips', async () => {
        const project = target('finals')
        const video = async (name: string, size: string, rate: number) => {
            mkdirSync(project.dir, {recursive: true})
            const proc = Bun.spawn(['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i', `color=black:s=${size}:r=${rate}`, '-frames:v', '4', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', join(project.dir, name)], {stdout: 'ignore', stderr: 'ignore'})
            expect(await proc.exited).toBe(0)
        }
        await video('finals.mp4', '64x36', 24)
        await video('finals-48fps.mp4', '128x72', 48)
        await video('finals-partial.mp4', '64x36', 24)
        write(join(project.dir, 'output/clips/slot-001.json'), {id: 'slot-001', frameStart: 0, frames: 24, section: 'A', beatId: 'b', shots: [], assets: {pictures: [], audio: []}, prompt: ''})
        write(join(project.dir, 'videos/slot-001.mp4'))
        utimesSync(join(project.dir, 'videos/slot-001.mp4'), old, old)
        utimesSync(join(project.dir, 'finals-48fps.mp4'), new Date(500_000), new Date(500_000))
        const {finals} = await readEditorProject(project)
        expect(finals.map(f => [f.file, f.label, f.width, f.height, f.fps, f.state])).toEqual([
            ['finals.mp4', 'Final', 64, 36, 24, 'current'],
            ['finals-48fps.mp4', 'Final 48 fps', 128, 72, 48, 'older'],
        ])
    })
})

describe('marks', () => {
    const clip = (id: string, more = {}) => ({id, frameStart: 0, frames: 24, section: 'A', beatId: 'b', shots: [], assets: {pictures: [], audio: []}, prompt: '', ...more})
    test('what is known against a clip, from what is on disk', async () => {
        const project = target('marked')
        const {dir} = project
        write(join(dir, 'output/clips/slot-001.json'), clip('slot-001', {dropped: ['Ann']}))
        write(join(dir, 'output/clips/slot-002.json'), clip('slot-002', {startsFrom: 'slot-001'}))
        write(join(dir, 'output/clips/slot-003.json'), clip('slot-003'))
        write(join(dir, 'videos/slot-002.mp4'))
        utimesSync(join(dir, 'videos/slot-002.mp4'), old, old)
        write(join(dir, 'assets/clips/slot-001_lf.png'))
        write(join(dir, 'videos/slot-003.mp4'))
        write(join(dir, 'old/leaks/slot-003-seed-1.mp4'))
        write(join(dir, 'logs/last-run.json'), {command: 'bun index.ts marked', pid: 1, startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), exitCode: 1, failures: ['clip slot-001: HIP out of memory']})
        const {statSync: stat} = await import('node:fs')
        write(join(dir, 'output/leak-scan.json'), {clips: {'slot-003': {video: Math.round(stat(join(dir, 'videos/slot-003.mp4')).mtimeMs), from: 1, to: 2, samples: 3}, 'slot-002': {video: 1, from: 1, to: 2, samples: 3}}})
        const {clips} = await readEditorProject(project)
        const kinds = (id: string) => clips.find(c => c.id === id)!.marks.map(m => m.kind).toSorted()
        expect(kinds('slot-001')).toEqual(['dropped', 'failed'])
        // the scan of slot-002 was of another version of the file: it says nothing about this one
        expect(kinds('slot-002')).toEqual(['older-start'])
        expect(kinds('slot-003')).toEqual(['backdrop', 'backdrop-attempt'])
    })
})

describe('the casting', () => {
    const cast = {characters: [{id: 'ann', name: 'Ann'}, {id: 'band', name: 'Band', isGroup: true}], locations: [{id: 'hall', name: 'Hall'}]}
    const project = () => target('cast')
    const save = async () => {
        write(join(root, 'library/characters/kael/asset.json'), {name: 'Kael', description: 'a man', source: 'x/y'})
        write(join(root, 'library/characters/kael/picture.png'))
        process.env.FEVERSLOP_LIBRARY = join(root, 'library')
    }
    beforeAll(async () => {
        await save()
        const {dir} = project()
        write(join(dir, 'project.json'), {cast})
        write(join(dir, 'input/idea.txt'))
        write(join(dir, 'assets/characters/ann.png'))
        write(join(dir, 'casting.json'), JSON.stringify({characters: {ann: 'project:ann', band: 'project:band'}, locations: {hall: 'library:gone'}}, null, 2))
    })
    afterAll(() => { delete process.env.FEVERSLOP_LIBRARY })
    test('every role with its entry, the clips that use it and what is wrong', async () => {
        const casting = await readCasting(project(), [{id: 'slot-001', pictures: [{file: 'assets/characters/ann.png'}]}, {id: 'slot-002', pictures: []}])
        expect(casting.options.character).toEqual(['kael'])
        const ann = casting.roles.find(r => r.id === 'ann')!
        expect(ann).toMatchObject({entry: 'project:ann', clips: ['slot-001'], picture: {file: 'assets/characters/ann.png'}, errors: []})
        expect(casting.roles.find(r => r.id === 'hall')!.errors[0]).toContain('library has no location "gone"')
    })
    test('a choice changes that one entry and nothing else', async () => {
        await writeCastingEntry(project(), 'character', 'ann', 'library:kael')
        expect(JSON.parse(readFileSync(join(project().dir, 'casting.json'), 'utf8'))).toEqual({characters: {ann: 'library:kael', band: 'project:band'}, locations: {hall: 'library:gone'}})
    })
    test('an asset the library does not have, or anything else, is refused', async () => {
        await expect(writeCastingEntry(project(), 'character', 'ann', 'library:typo')).rejects.toThrow('neither')
        await expect(writeCastingEntry(project(), 'character', 'ann', 'project:band')).rejects.toThrow('neither')
    })
    test('never while a run holds the lock', async () => {
        const {dir} = project()
        write(join(dir, '.lock'), String(process.ppid))
        await expect(writeCastingEntry(project(), 'character', 'ann', 'project:ann')).rejects.toThrow('another run')
        rmSync(join(dir, '.lock'))
    })
    test('the library knows who uses an asset from the casting files', async () => {
        const {assets} = await readLibrary()
        expect(assets.find(a => a.id === 'kael')).toMatchObject({kind: 'character', name: 'Kael', picture: {file: 'characters/kael/picture.png'}, usedBy: [{kind: 'music', id: 'cast', role: 'ann'}]})
    })
    test('what is being made in the library is not served', async () => {
        const library = join(root, 'library')
        write(join(library, '.work/x.png'))
        const handler = editorHandler()
        expect((await handler(new Request('http://localhost/library/media/.work/x.png'))).status).toBe(404)
        expect((await handler(new Request('http://localhost/library/media/characters/kael/picture.png'))).status).toBe(200)
        expect((await handler(new Request('http://localhost/library/media/characters/kael/asset.json'))).status).toBe(404)
    })
})

describe('a choice per clip of a film', () => {
    test('kept in its own small file, gone again when there is no choice; only for clips there are', async () => {
        const film = target('chosen', 'film')
        write(join(film.dir, 'input/idea.txt'))
        write(join(film.dir, 'output/clips/clip-001.json'), {id: 'clip-001'})
        const handler = editorHandler()
        const post = (clip: string, body: unknown) => handler(new Request(`http://localhost/p/film/chosen/api/override/${clip}`, {method: 'POST', body: JSON.stringify(body)}))
        expect((await post('clip-001', {placeView: 3})).status).toBe(200)
        expect(JSON.parse(readFileSync(join(film.dir, 'clip-overrides/clip-001.json'), 'utf8'))).toEqual({placeView: 3})
        expect((await post('clip-001', null)).status).toBe(200)
        expect(existsSync(join(film.dir, 'clip-overrides/clip-001.json'))).toBe(false)
        expect((await post('clip-999', {placeView: 3})).status).toBe(409)
    })
})

 test('malformed URL paths return a JSON error', async () => {
    const response = await editorHandler()(new Request('http://localhost/%zz'))
    expect(response.status).toBe(503)
    expect(((await response.json()) as {error: string}).error).toBeTruthy()
 })
 test('traversal overrides cannot replace or delete project.json', async () => {
    const film = target('safe-override', 'film')
    write(join(film.dir, 'input/idea.txt'))
    const file = join(film.dir, 'project.json')
    const original = '{"screenplay":{}}'
    write(file, original)
    for (const body of [{placeView: 3}, null]) {
        const response = await editorHandler()(new Request('http://localhost/p/film/safe-override/api/override/..%2F..%2Fproject', {method: 'POST', body: JSON.stringify(body)}))
        expect(response.status).toBe(409)
        expect(readFileSync(file, 'utf8')).toBe(original)
    }
 })
 test('film listings include prop pictures', () => {
    const film = target('props-count', 'film')
    write(join(film.dir, 'input/idea.txt'))
    write(join(film.dir, 'assets/props/umbrella.png'))
    expect(readListing(film).pictures).toBe(1)
 })
 test('unused GET run route is absent', async () => {
    write(join(target('no-run').dir, 'input/idea.txt'))
    expect((await editorHandler()(new Request('http://localhost/p/music/no-run/api/run'))).status).toBe(404)
 })

describe('a picture sent from the page', () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4a40000000049454e44ae426082', 'hex')
    test('is what its first bytes say: a PNG, a JPEG or a WebP, never what its name says', () => {
        expect(pictureType(png)).toBe('png')
        expect(pictureType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg')
        expect(pictureType(new Uint8Array([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP')]))).toBe('webp')
        expect(pictureType(new Uint8Array(Buffer.from('<svg onload=alert(1)>')))).toBeUndefined()
        expect(pictureType(new Uint8Array([]))).toBeUndefined()
    })
    test('goes into a folder of its own under a name the server gives it, with what is sent with it', async () => {
        const upload = await takePictureUpload(new File([png], '../../evil.png'))
        expect(basename(upload.file)).toBe('picture.png')
        expect(dirname(upload.file)).toBe(upload.folder)
        expect(dirname(await upload.text('prompt', 'a hall'))).toBe(upload.folder)
        upload.drop()
        expect(existsSync(upload.folder)).toBe(false)
    })
    test('what is not a picture, empty or too large is refused', async () => {
        await expect(takePictureUpload(new File(['hello'], 'a.png'))).rejects.toThrow('not a picture')
        await expect(takePictureUpload(new File([], 'a.png'))).rejects.toThrow('empty')
        await expect(takePictureUpload('a.png')).rejects.toThrow('no picture sent')
        expect(() => checkUploadSize(new Request('http://localhost/', {method: 'POST', headers: {'content-length': String(UPLOAD_MAX_BYTES * 2)}}))).toThrow('too large')
    })
    test('as the anchor of a reference picture: only for one there is, only a picture', async () => {
        const project = target('own-anchor')
        write(join(project.dir, 'input/lyrics.txt'))
        write(join(project.dir, 'output/assets.json'), [{kind: 'character', id: 'ann', name: 'Ann', file: 'assets/characters/ann.png', prompt: 'Ann', description: 'Ann'}, {kind: 'prop', id: 'cup', name: 'Cup', file: 'assets/props/cup.png', prompt: 'a cup', description: 'a cup'}])
        const send = async (picture: string, file: File) => {
            const form = new FormData()
            form.set('picture', file)
            const response = await editorHandler()(new Request(`http://localhost/p/music/own-anchor/api/references/${picture}/own-anchor`, {method: 'POST', body: form}))
            return {status: response.status, error: ((await response.json()) as { error?: string }).error}
        }
        expect(await send('nobody', new File([png], 'a.png'))).toEqual({status: 409, error: 'no picture nobody'})
        expect((await send('cup', new File([png], 'a.png'))).error).toContain('is a prop')
        expect((await send('ann', new File(['<svg/>'], 'a.png'))).error).toContain('not a picture')
    })
})
