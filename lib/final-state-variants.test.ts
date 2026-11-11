import {afterAll, describe, expect, test} from 'bun:test'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {projectFinalState, variantFinals} from './render-state.ts'

// #832: a project that was made over (bun run refinish) and went through the post-work steps has finished videos - but none
// called <id>.mp4. It showed "No final video" and was told to assemble one.
const root = mkdtempSync(join(tmpdir(), 'final-variants-'))
afterAll(() => rmSync(root, {recursive: true, force: true}))
const project = (name: string, files: string[]) => {
    const dir = join(root, name)
    mkdirSync(join(dir, 'videos'), {recursive: true})
    writeFileSync(join(dir, 'videos', 'slot-001.mp4'), '')
    for (const file of files) writeFileSync(join(dir, file), '')
    return dir
}
const clips = [{id: 'slot-001'}]

describe('the final video of a project that only has made-over ones', () => {
    test('made-over finals are the ones of a variant - not a preview, not a step of the post-work', () => {
        const dir = project('demo', [
            'demo--original.mp4',
            'demo--original-48fps-finished.mp4',
            'demo--original-48fps-finished-labeled.mp4',
            'demo--original-preview.mp4',
            'demo-preview.mp4',
            'other.mp4',
        ])
        expect(variantFinals(dir, 'demo').sort()).toEqual(['demo--original-48fps-finished.mp4', 'demo--original.mp4'])
    })
    test('no own final video, a made-over one: "variant", not "missing"', () => {
        const dir = project('made-over', ['made-over--original-48fps-finished.mp4'])
        expect(projectFinalState(dir, 'made-over', join(dir, 'made-over.mp4'), clips)).toBe('variant')
    })
    test('nothing at all is missing; an own final video counts as before', () => {
        const none = project('none', [])
        expect(projectFinalState(none, 'none', join(none, 'none.mp4'), clips)).toBe('missing')
        const own = project('own', ['own.mp4', 'own--original.mp4'])
        expect(projectFinalState(own, 'own', join(own, 'own.mp4'), clips)).toBe('current')
    })
    test('a preview or a labelled video alone is no final video', () => {
        const dir = project('preview-only', ['preview-only-preview.mp4', 'preview-only--original-labeled.mp4'])
        expect(projectFinalState(dir, 'preview-only', join(dir, 'preview-only.mp4'), clips)).toBe('missing')
    })
})
