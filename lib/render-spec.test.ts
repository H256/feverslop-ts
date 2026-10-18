import {describe, expect, test} from "bun:test";
import {mkdirSync, mkdtempSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fingerprint} from "./provenance.ts";
import {anchorSpec, clipSpec, filmClipSpec, pictureSpec, sequenceSpec, songSpec, specId} from "./render-spec.ts";

const project = () => {
    const dir = mkdtempSync(join(tmpdir(), 'spec-'))
    mkdirSync(join(dir, 'assets'), {recursive: true})
    mkdirSync(join(dir, 'videos'), {recursive: true})
    writeFileSync(join(dir, 'assets/a.png'), 'one')
    return dir
}
const image = {imageWorkflow: 'img', imageResolution: '1024x1024'}
const video = {videoWorkflow: 'vid', videoResolution: '720x1280'}

describe('picture and sheet specs', () => {
    const picture = {id: 'anna', prompt: 'a woman'}
    test('the id is the fingerprint older sidecars recorded: prompt, workflow, resolution', () => {
        expect(specId(pictureSpec(picture, image))).toBe(fingerprint('a woman', 'img', '1024x1024'))
    })
    test('each input changes the id', () => {
        const base = specId(pictureSpec(picture, image))
        expect(specId(pictureSpec({...picture, prompt: 'a man'}, image))).not.toBe(base)
        expect(specId(pictureSpec(picture, {...image, imageWorkflow: 'other'}))).not.toBe(base)
        expect(specId(pictureSpec(picture, {...image, imageResolution: '512x512'}))).not.toBe(base)
    })
    test("the user's anchor is its content, not its prompt", () => {
        const dir = project()
        const file = join(dir, 'assets/a.png')
        const before = specId(anchorSpec(picture, image, file))
        expect(specId(anchorSpec({...picture, prompt: 'changed'}, image, file))).toBe(before)
        writeFileSync(file, 'two')
        expect(specId(anchorSpec(picture, image, file))).not.toBe(before)
    })
    test('the sheet follows its anchor, the sequence prompt and the workflow', () => {
        const anchor = anchorSpec(picture, image)
        const sheet = specId(sequenceSpec('sheet', 'anna', anchor, 'turn around', 'seq'))
        expect(sheet).toBe(fingerprint(specId(anchor), 'turn around', 'seq'))
        expect(specId(sequenceSpec('sheet', 'anna', anchorSpec({...picture, prompt: 'x'}, image), 'turn around', 'seq'))).not.toBe(sheet)
        expect(specId(sequenceSpec('sheet', 'anna', anchor, 'other', 'seq'))).not.toBe(sheet)
    })
    test('a song is its style, lyrics, workflow and length', () => {
        const brief = {style: 's', lyrics: 'l'}
        const id = specId(songSpec(brief, {songWorkflow: 'w', songDuration: 60}))
        expect(id).toBe(fingerprint('s', 'l', 'w', 60))
        expect(specId(songSpec({...brief, lyrics: 'm'}, {songWorkflow: 'w', songDuration: 60}))).not.toBe(id)
    })
})

describe('clip specs', () => {
    const clip = (extra: Record<string, unknown> = {}) => ({
        id: 'slot-002', prompt: 'p', frames: 100, startsFrom: undefined as string | undefined,
        assets: {pictures: [{kind: 'character', file: 'assets/a.png'}, {kind: 'frame', file: 'assets/f.png'}], audio: [{stem: 'drums', songStart: 1, songEnd: 2}]},
        ...extra,
    })
    test('the id lists the same inputs the first fingerprints did, the frame picture left out', () => {
        const dir = project()
        const pictureHash = Bun.hash('one').toString(16)
        expect(specId(clipSpec(clip(), dir, video))).toBe(fingerprint('p', 100, 'vid', '720x1280', [pictureHash], [['drums', 1, 2]], ''))
    })
    test('each input changes the id, the seed is not one', () => {
        const dir = project()
        const base = specId(clipSpec(clip(), dir, video))
        expect(specId(clipSpec(clip({prompt: 'q'}), dir, video))).not.toBe(base)
        expect(specId(clipSpec(clip({frames: 101}), dir, video))).not.toBe(base)
        expect(specId(clipSpec(clip(), dir, {...video, videoWorkflow: 'other'}))).not.toBe(base)
        expect(specId(clipSpec(clip(), dir, {...video, videoResolution: '1x1'}))).not.toBe(base)
        // the default aspect leaves the id as it was; another one makes the clip stale
        expect(specId(clipSpec(clip(), dir, {...video, videoAspect: '16:9'}))).toBe(base)
        expect(specId(clipSpec(clip(), dir, {...video, videoAspect: '9:16'}))).not.toBe(base)
        writeFileSync(join(dir, 'assets/a.png'), 'changed')
        expect(specId(clipSpec(clip(), dir, video))).not.toBe(base)
        // a seed is no input of a spec at all: the same request rendered again is the same request
        expect(specId(clipSpec({...clip(), seed: 7} as never, dir, video))).toBe(specId(clipSpec({...clip(), seed: 8} as never, dir, video)))
    })
    test('a clip that goes on from another follows what that one was made from', () => {
        const dir = project()
        writeFileSync(join(dir, 'videos/slot-001.mp4.json'), JSON.stringify({fingerprint: 'a'}))
        const before = specId(clipSpec(clip({startsFrom: 'slot-001'}), dir, video))
        writeFileSync(join(dir, 'videos/slot-001.mp4.json'), JSON.stringify({fingerprint: 'b'}))
        expect(specId(clipSpec(clip({startsFrom: 'slot-001'}), dir, video))).not.toBe(before)
    })
    test('a film clip adds its prompt hash and whether the start frame is pinned', () => {
        const dir = project()
        const film = {id: 'clip-001', promptHash: 'h', assets: clip().assets}
        const base = specId(filmClipSpec(film, dir, {...video, pinStartFrame: true}))
        expect(specId(filmClipSpec({...film, promptHash: 'h2'}, dir, {...video, pinStartFrame: true}))).not.toBe(base)
        expect(specId(filmClipSpec(film, dir, {...video, pinStartFrame: false}))).not.toBe(base)
    })
})
