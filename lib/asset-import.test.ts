import {afterEach, describe, expect, test} from "bun:test";
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {assetIds, importAsset, importPlan} from "./asset-import.ts";
import {redoAfter} from "./project.ts";

const dirs: string[] = []
const project = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), 'asset-import-'))
    dirs.push(dir)
    for (const [file, content] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, file)), {recursive: true})
        writeFileSync(join(dir, file), content)
    }
    return dir
}
afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, {recursive: true, force: true})
})

const sheet = (id: string) => ({
    [`assets/characters/${id}.png`]: 'sheet', [`assets/characters/${id}.png.json`]: '{"fingerprint":"a"}',
    [`assets/sequence/characters/${id}/anchor.png`]: 'anchor', [`assets/sequence/characters/${id}/anchor.png.json`]: '{"fingerprint":"b"}',
    [`assets/sequence/characters/${id}/sequence.mp4`]: 'video', [`assets/sequence/characters/${id}/sequence.mp4.json`]: '{}',
    [`assets/sequence/characters/${id}/frames/frame_00.png`]: 'f0', [`assets/sequence/characters/${id}/frames/frame_01.png`]: 'f1',
})

describe('importPlan / importAsset', () => {
    test('every file of the asset, renamed to the target id - sidecars and unfinished renders left out', () => {
        const source = project({...sheet('kaelen'), 'assets/sequence/characters/kaelen/anchor.png.partial.png': 'x', 'assets/sequence/characters/kaelen/sequence.mp4.pending.json': '{}'})
        expect(importPlan(source, 'kaelen', 'kael', 'character').map(f => [f.to, f.sidecar])).toEqual([
            ['assets/characters/kael.png', true],
            ['assets/sequence/characters/kael/anchor.png', true],
            ['assets/sequence/characters/kael/frames/frame_00.png', false],
            ['assets/sequence/characters/kael/frames/frame_01.png', false],
            ['assets/sequence/characters/kael/sequence.mp4', true],
        ])
    })
    test('copies with pinned sidecars and puts the old pictures away, deleting nothing', () => {
        const source = project(sheet('kaelen'))
        const target = project({...sheet('kael'), 'assets/sequence/characters/kael/frames/frame_05.png': 'old only'})
        const done = importAsset(source, 'tides-a', 'kaelen', target, 'kael', 'character')
        expect(done.copied).toBe(5)
        expect(readFileSync(join(target, 'assets/sequence/characters/kael/anchor.png'), 'utf8')).toBe('anchor')
        expect(JSON.parse(readFileSync(join(target, 'assets/sequence/characters/kael/anchor.png.json'), 'utf8'))).toEqual({source: 'user', pinned: true, note: 'imported from tides-a/assets/sequence/characters/kaelen/anchor.png'})
        // the old sheet is gone from its place, frame_05 with it - the new one has only its own frames
        expect(existsSync(join(target, 'assets/sequence/characters/kael/frames/frame_05.png'))).toBe(false)
        expect(readdirSync(join(target, done.putAway!)).sort()).toEqual(['kael', 'kael.png', 'kael.png.json'])
        expect(readFileSync(join(target, done.putAway!, 'kael/frames/frame_05.png'), 'utf8')).toBe('old only')
    })
    test('a source without the asset is an error, nothing is touched', () => {
        const target = project(sheet('kael'))
        expect(() => importAsset(project({}), 'empty', 'kaelen', target, 'kael', 'character')).toThrow('has no character "kaelen"')
        expect(existsSync(join(target, 'assets/characters/kael.png'))).toBe(true)
    })
    test('assetIds: the ids with a picture or a sheet', () => {
        expect(assetIds(project({...sheet('mara'), 'assets/characters/lyra.png': 'x', 'assets/characters/lyra.png.partial.png': 'x'}), 'character')).toEqual(['lyra', 'mara'])
    })
})

describe('redoAfter - the --redo for texts changed by hand', () => {
    test('the steps that read them, not the changed steps themselves, and none another one redoes anyway', () => {
        const data = {characterDescriptions: {}, locationDescriptions: {}, locationAnchors: {}, locationLayouts: {}, shotMoments: {}, shotViews: {}}
        expect(redoAfter(['characterDescriptions'], data)).toEqual(['shotMoments'])
        expect(redoAfter(['locationDescriptions', 'locationAnchors', 'locationLayouts'], data)).toEqual(['shotMoments'])
        expect(redoAfter(['characterDescriptions'], {characterDescriptions: {}})).toEqual([])
    })
})
