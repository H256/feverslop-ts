import {afterAll, expect, test} from 'bun:test'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pastRuns, queueRun, readQueue, takeFirst, unqueue} from './run-queue.ts'

const dir = mkdtempSync(join(tmpdir(), 'run-queue-'))
afterAll(() => rmSync(dir, {recursive: true, force: true}))

// #837: what waits is a file in logs/, in order; a queued run can be taken out by its id
test('the queue of a project', () => {
    expect(readQueue(dir)).toEqual([])
    const a = queueRun(dir, {request: {type: 'plan'}, command: 'bun index.ts demo'})
    const b = queueRun(dir, {request: {type: 'final'}, command: 'bun index.ts demo --render=final', servers: ['http://a:8188']})
    expect(a.id).not.toBe(b.id)
    expect(readQueue(dir).map(q => q.command)).toEqual(['bun index.ts demo', 'bun index.ts demo --render=final'])
    expect(unqueue(dir, 'none')).toBe(false)
    expect(unqueue(dir, a.id)).toBe(true)
    expect(takeFirst(dir)).toMatchObject({command: 'bun index.ts demo --render=final', servers: ['http://a:8188']})
    expect(takeFirst(dir)).toBeUndefined()
})

test('the runs that ended, newest first; a line that cannot be read is left out', () => {
    mkdirSync(join(dir, 'logs'), {recursive: true})
    const run = (command: string) => JSON.stringify({command, startedAt: '2026-11-12T10:00:00Z', state: 'finished'})
    writeFileSync(join(dir, 'logs', 'runs.jsonl'), `${run('first')}\nnot json\n${run('second')}\n`)
    expect(pastRuns(dir).map(r => r.command)).toEqual(['second', 'first'])
    expect(pastRuns(dir, 1).map(r => r.command)).toEqual(['second'])
})
