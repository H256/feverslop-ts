import {describe, expect, test} from 'bun:test'
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {cutsOf, joinFingerprint, joinFrames, joinPrompt, plannedChanges, readVerdict} from './joins.ts'

const clip = (id: string, sceneId: string, startsFrom?: string) => ({id, sceneId, ...(startsFrom ? {startsFrom} : {})})

describe('the cuts within a scene', () => {
    test('two clips of one scene after each other, unless the second goes on from the first', () => {
        const requests = [clip('clip-001', 's1'), clip('clip-002', 's1'), clip('clip-003', 's1', 'clip-002'), clip('clip-004', 's2'), clip('clip-005', 's2')]
        expect(cutsOf(requests)).toEqual([
            {from: 'clip-001', to: 'clip-002', sceneId: 's1'},
            {from: 'clip-004', to: 'clip-005', sceneId: 's2'},
        ])
    })
    test('a change of scene is no cut to check', () => {
        expect(cutsOf([clip('clip-001', 's1'), clip('clip-002', 's2')])).toEqual([])
    })
})

describe('a join', () => {
    test('the last frame of the clip before, the first of the next', () => {
        expect(joinFrames({from: 'clip-001', to: 'clip-002', sceneId: 's1'})).toEqual(['assets/clips/clip-001_lf.png', 'assets/clips/clip-002_ff.png'])
    })
    test('asked again only when a frame or the staging changed', () => {
        const dir = mkdtempSync(join(tmpdir(), 'joins-'))
        try {
            const cut = {from: 'clip-001', to: 'clip-002', sceneId: 's1'}
            expect(joinFingerprint(dir, cut, 'x')).toBeUndefined()
            mkdirSync(join(dir, 'assets', 'clips'), {recursive: true})
            writeFileSync(join(dir, 'assets/clips/clip-001_lf.png'), 'a')
            writeFileSync(join(dir, 'assets/clips/clip-002_ff.png'), 'b')
            const first = joinFingerprint(dir, cut, 'x')
            expect(first).toBeString()
            expect(joinFingerprint(dir, cut, 'x')).toBe(first)
            expect(joinFingerprint(dir, cut, 'y')).not.toBe(first)
            writeFileSync(join(dir, 'assets/clips/clip-002_ff.png'), 'c')
            expect(joinFingerprint(dir, cut, 'x')).not.toBe(first)
        } finally {
            rmSync(dir, {recursive: true, force: true})
        }
    })
    test('the question has both pictures and the staging', () => {
        const asked = joinPrompt(['data:a', 'data:b'], 'Anna sits at the table, Ben stands at the door.')
        expect(asked.images).toEqual(['data:a', 'data:b'])
        expect(asked.input).toContain('Anna sits at the table')
        expect(asked.schema).toMatchObject({required: ['fits', 'differences']})
    })
    test('a look the plan changes at the cut is said, so that it is no fault', () => {
        const picture = (id: string, description: string) => ({label: '', file: '', subject: '', kind: 'character' as const, id, name: 'Karl', description})
        const before = {assets: {pictures: [picture('karl', 'a soldier in a grey coat')]}}
        const after = {assets: {pictures: [picture('karl--wounded', 'the coat torn, a bandage on the head')]}}
        expect(plannedChanges(before, after)).toEqual(['Karl: from here on the coat torn, a bandage on the head'])
        expect(plannedChanges(before, before)).toEqual([])
        expect(joinPrompt([], '', plannedChanges(before, after)).input).toContain('Planned at this cut - no difference: Karl: from here on the coat torn')
    })
    test('no differences is a fit, whatever the model says it is', () => {
        expect(readVerdict({fits: false, differences: []})).toEqual({fits: true, differences: []})
        expect(readVerdict({fits: true, differences: [' Anna holds a cup in the second. ', '']})).toEqual({
            fits: false,
            differences: ['Anna holds a cup in the second.'],
        })
        expect(readVerdict(undefined)).toEqual({fits: true, differences: []})
    })
})
