import {afterAll, beforeAll, describe, expect, test} from 'bun:test'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {lockProject} from '../lock.ts'
import {kindOf} from '../service-error.ts'
import {answerOf, editorHandler} from './server.ts'

// #837: a no of the workspace says its kind - a mistake in the input, a lock, nothing there, or an error of the workspace itself -
// so that the page shows each its own way. One request per kind against the handler.
const here = process.cwd()
let root: string
beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'error-kinds-'))
    const dir = join(root, 'projects', 'demo')
    mkdirSync(join(dir, 'output'), {recursive: true})
    writeFileSync(join(dir, 'project.json'), JSON.stringify({cast: {characters: [{id: 'kael', name: 'Kael'}], locations: []}}))
    writeFileSync(join(dir, 'output', 'assets.json'), '[]')
    process.chdir(root)
})
afterAll(() => {
    process.chdir(here)
    rmSync(root, {recursive: true, force: true})
})

const post = (path: string, body: unknown) =>
    editorHandler()(new Request(`http://localhost/p/music/demo/api/${path}`, {method: 'POST', body: JSON.stringify(body)}))
const said = async (response: Response) => ({status: response.status, ...((await response.json()) as {error: string; kind: string; where?: string})})

describe('the kind of a no', () => {
    test('invalid: what was wrong with the input, 400', async () => {
        const answer = await said(await post('config', {change: [1]}))
        expect(answer).toMatchObject({status: 400, kind: 'invalid'})
        expect(answer.error).toContain('change must be an object')
        expect(await said(await post('run', {action: {type: 'dance'}}))).toMatchObject({status: 400, kind: 'invalid', error: 'no such action'})
        // a body that is not JSON
        const garbled = await editorHandler()(new Request('http://localhost/p/music/demo/api/config', {method: 'POST', body: '{'}))
        expect(await said(garbled)).toMatchObject({status: 400, kind: 'invalid'})
    })
    test('busy: a run holds the project, 423 - with who holds it', async () => {
        const release = lockProject(join(root, 'projects', 'demo'), 'test')
        try {
            const answer = await said(await post('direction', {rules: []}))
            expect(answer).toMatchObject({status: 423, kind: 'busy'})
            expect(answer.error).toContain('being worked on by another run')
        } finally {
            release()
        }
    })
    test('missing: no such thing, 404', async () => {
        const form = new FormData()
        form.set('picture', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'a.png'))
        const response = await editorHandler()(new Request('http://localhost/p/music/demo/api/references/nobody/own-anchor', {method: 'POST', body: form}))
        expect(await said(response)).toMatchObject({status: 404, kind: 'missing', error: 'no picture nobody'})
    })
    test('failed: an error of the workspace, 500 - with where it happened', async () => {
        let bug: unknown
        try {
            ;(undefined as unknown as {x: () => void}).x()
        } catch (e) {
            bug = e
        }
        const original = console.error
        console.error = () => {}
        try {
            const answer = await said(answerOf(bug, true))
            expect(answer).toMatchObject({status: 500, kind: 'failed'})
            expect(answer.where).toContain('error-kinds.test.ts')
        } finally {
            console.error = original
        }
    })
    test('unavailable: a read that failed otherwise - a file being written just then - is asked again, 503', () => {
        expect(kindOf(new Error('JSON Parse error'), false)).toBe('unavailable')
        expect(kindOf(new SyntaxError('Unexpected end of JSON input'), false)).toBe('unavailable')
        // the same words in a write are a refusal of a check
        expect(kindOf(new Error('change must be an object'), true)).toBe('invalid')
        // a failed system call is no refusal
        expect(kindOf(Object.assign(new Error('EACCES: permission denied'), {code: 'EACCES'}), true)).toBe('failed')
    })
})
