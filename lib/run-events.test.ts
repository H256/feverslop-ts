import {afterAll, beforeAll, describe, expect, test} from 'bun:test'
import {mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import type {RunEvent} from '../shared/workspace.ts'
import {RunControl} from './editor/runs.ts'
import {stepTitle} from './run-events.ts'

// #829: a run says what it does as data, next to its log - the workspace reads these, not the wording of the log.
let dir: string
beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'run-events-'))
})
afterAll(() => rmSync(dir, {recursive: true, force: true}))

const slashed = (path: string) => JSON.stringify(path.replaceAll('\\', '/'))

/** A run as a command does it: a log kept in its folder, then what `body` does. */
async function run(name: string, body: string) {
    const folder = join(dir, name)
    const script = join(dir, `${name}.ts`)
    writeFileSync(
        script,
        [
            `import {keepLogIn, log, failRun} from ${slashed(join(import.meta.dir, 'log.ts'))}`,
            `import {runEvent} from ${slashed(join(import.meta.dir, 'run-events.ts'))}`,
            `keepLogIn(${slashed(join(folder, 'logs', '2026-11-11_10-00-00.log'))})`,
            body,
        ].join('\n'),
    )
    const proc = Bun.spawn(['bun', script], {stdout: 'ignore', stderr: 'ignore'})
    const code = await proc.exited
    const file = join(
        folder,
        'logs',
        readdirSync(join(folder, 'logs')).find(f => f.endsWith('.events.jsonl'))!,
    )
    const events = readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .map(line => JSON.parse(line) as RunEvent)
    return {code, events, folder}
}
const plain = (events: RunEvent[]) => events.map(({at: _at, ...rest}) => rest)

describe('the events of a run', () => {
    test('steps, warnings and the end of a run that went well, with what it made', async () => {
        const {code, events} = await run(
            'well',
            [
                `runEvent({type: 'step', state: 'started', name: 'story', title: '2 · Story'})`,
                `log.warn('a beat without a place')`,
                `log.warn('another')`,
                `runEvent({type: 'step', state: 'done', name: 'story', title: '2 · Story'})`,
                `log.output('videos/final.mp4')`,
                `log.next('bun run render')`,
            ].join('\n'),
        )
        expect(code).toBe(0)
        expect(plain(events)).toEqual([
            {type: 'step', state: 'started', name: 'story', title: '2 · Story'},
            {type: 'warning', message: 'a beat without a place'},
            {type: 'warning', message: 'another'},
            {type: 'step', state: 'done', name: 'story', title: '2 · Story'},
            {type: 'done', output: 'videos/final.mp4', next: 'bun run render', warnings: 2},
        ])
        expect(events.every(e => typeof e.at === 'number')).toBe(true)
    })
    test('a failure with what it means and what to do - and no "done"', async () => {
        const {code, events} = await run('failed', `failRun(new Error('EPERM: operation not permitted, rename a -> b'))`)
        expect(code).toBe(1)
        expect(events.map(e => e.type)).toEqual(['failed'])
        const failed = events[0] as Extract<RunEvent, {type: 'failed'}>
        expect(failed.message).toContain('EPERM')
        expect(failed.advice).toBeTruthy()
    })
    test('the workspace reads the newest run of a project', async () => {
        const {folder} = await run('read', `log.warn('only this')`)
        const {file, events} = new RunControl().events({id: 'read', kind: 'music', dir: folder})
        expect(file?.endsWith('2026-11-11_10-00-00.events.jsonl')).toBe(true)
        expect(plain(events)).toEqual([
            {type: 'warning', message: 'only this'},
            {type: 'done', warnings: 1},
        ])
    })
    test('a step title as a person reads it', () => {
        expect(stepTitle('11b · BLOCKING THE BEATS')).toBe('11b · Blocking the beats')
        expect(stepTitle('STORY')).toBe('Story')
    })
})
