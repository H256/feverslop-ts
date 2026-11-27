import {removeHeld} from './previous-output.ts'
import {afterAll, expect, test} from 'bun:test'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pastRuns, queueRun, readQueue, takeFirst, unqueue} from './run-queue.ts'

const dir = mkdtempSync(join(tmpdir(), 'run-queue-'))
afterAll(() => removeHeld(dir))

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

// a picture rendered again from an edited prompt or an uploaded anchor brings files for its run alone: queued, they wait in the project
test('what a queued run is given waits with it in logs/queued, and goes when it is taken out', () => {
    const given = mkdtempSync(join(tmpdir(), 'given-'))
    writeFileSync(join(given, 'mara.txt'), 'a woman in red')
    const prompt = join(given, 'mara.txt')
    const q = queueRun(dir, {request: {type: 'pictures', ids: ['mara'], promptFile: prompt}, command: `bun index.ts demo --picture-prompt=${prompt}`}, [given])
    expect(existsSync(given)).toBe(false)
    const kept = join(dir, 'logs', 'queued', q.id)
    expect(q.files).toEqual([kept])
    const moved = q.request.promptFile as string
    expect(moved.startsWith(kept)).toBe(true)
    expect(readFileSync(moved, 'utf8')).toBe('a woman in red')
    expect(q.command).toContain(`--picture-prompt=${moved}`)
    expect(unqueue(dir, q.id)).toBe(true)
    expect(existsSync(kept)).toBe(false)
})

test('the first queued run is taken out with its files: the run that starts it drops them as it ends', () => {
    const given = mkdtempSync(join(tmpdir(), 'given-'))
    const q = queueRun(dir, {request: {type: 'pictures', ids: ['mara']}, command: 'bun index.ts demo'}, [given])
    const first = takeFirst(dir)
    expect(first?.id).toBe(q.id)
    expect(first?.files).toEqual([join(dir, 'logs', 'queued', q.id)])
    expect(existsSync(first!.files![0]!)).toBe(true)
})

test('the runs that ended, newest first; a line that cannot be read is left out', () => {
    mkdirSync(join(dir, 'logs'), {recursive: true})
    const run = (command: string) => JSON.stringify({command, startedAt: '2026-11-12T10:00:00Z', state: 'finished'})
    writeFileSync(join(dir, 'logs', 'runs.jsonl'), `${run('first')}\nnot json\n${run('second')}\n`)
    expect(pastRuns(dir).map(r => r.command)).toEqual(['second', 'first'])
    expect(pastRuns(dir, 1).map(r => r.command)).toEqual(['second'])
})
