import {describe, expect, test} from "bun:test";
import {mkdirSync, mkdtempSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fingerprint, freshness, isUserFile, pinnedSidecar, recordedFingerprint} from "./provenance.ts";
import {clipFingerprint} from "./render.ts";
import type {ClipRequest} from "./compose.ts";

const dir = () => mkdtempSync(join(tmpdir(), 'prov-'))

describe('freshness', () => {
    test('a file without a sidecar, or from before fingerprints, is pinned', () => {
        const d = dir()
        writeFileSync(join(d, 'a.png'), 'x')
        expect(freshness(join(d, 'a.png'), 'f1')).toBe('pinned')
        writeFileSync(join(d, 'a.png.json'), JSON.stringify({prompt: 'old'}))
        expect(freshness(join(d, 'a.png'), 'f1')).toBe('pinned')
    })
    test('the same fingerprint is current, another one stale', () => {
        const d = dir()
        writeFileSync(join(d, 'a.png.json'), JSON.stringify({fingerprint: 'f1'}))
        expect(freshness(join(d, 'a.png'), 'f1')).toBe('current')
        expect(freshness(join(d, 'a.png'), 'f2')).toBe('stale')
    })
    test('a picture the user replaced is never stale', () => {
        const d = dir()
        writeFileSync(join(d, 'a.png.json'), JSON.stringify({...pinnedSidecar('x'), fingerprint: 'old'}))
        expect(freshness(join(d, 'a.png'), 'new')).toBe('pinned')
        expect(isUserFile(join(d, 'a.png'))).toBe(true)
    })
})

describe('clipFingerprint', () => {
    const clip = (extra: Partial<ClipRequest> = {}) => ({
        id: 'slot-002', prompt: 'p', frames: 100, assets: {pictures: [{file: 'assets/characters/a.png', kind: 'character'}], audio: []}, ...extra,
    }) as unknown as ClipRequest
    const config = {videoWorkflow: 'w', videoResolution: '720x1280'} as never
    test('changes with the content of a picture', () => {
        const d = dir()
        mkdirSync(join(d, 'assets/characters'), {recursive: true})
        writeFileSync(join(d, 'assets/characters/a.png'), 'one')
        const before = clipFingerprint(clip(), d, config)
        writeFileSync(join(d, 'assets/characters/a.png'), 'two')
        expect(clipFingerprint(clip(), d, config)).not.toBe(before)
    })
    test('changes when the clip it goes on from was rendered from something else', () => {
        const d = dir()
        mkdirSync(join(d, 'videos'), {recursive: true})
        mkdirSync(join(d, 'assets/characters'), {recursive: true})
        writeFileSync(join(d, 'videos/slot-001.mp4.json'), JSON.stringify({fingerprint: 'a'}))
        const before = clipFingerprint(clip({startsFrom: 'slot-001'}), d, config)
        writeFileSync(join(d, 'videos/slot-001.mp4.json'), JSON.stringify({fingerprint: 'b'}))
        expect(recordedFingerprint(join(d, 'videos/slot-001.mp4'))).toBe('b')
        expect(clipFingerprint(clip({startsFrom: 'slot-001'}), d, config)).not.toBe(before)
    })
    test('is the same for the same request', () => {
        const d = dir()
        expect(clipFingerprint(clip(), d, config)).toBe(clipFingerprint(clip(), d, config))
        expect(fingerprint('a', 1)).toBe(fingerprint('a', 1))
    })
})
