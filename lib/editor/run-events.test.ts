import {expect, test} from 'bun:test'
import {runEvents} from './server.ts'
import type {RunControl} from './runs.ts'
import type {EditorTarget} from './project.ts'

test('run-events closes on abort and stops polling', async () => {
    let polls = 0
    const runs = {
        lines: () => {
            polls++
            return {lines: [], next: 0}
        },
        current: () => ({running: true}),
        events: () => ({events: []}),
    } as unknown as RunControl
    const target = {id: 'test', kind: 'music', dir: '/tmp/test'} as EditorTarget
    const abort = new AbortController()
    const response = runEvents(runs, target, new Request('http://localhost/run-events', {signal: abort.signal}), 0)
    const reader = response.body!.getReader()

    const first = await reader.read()
    expect(first.done).toBe(false)
    expect(new TextDecoder().decode(first.value)).toContain('event: state')
    expect(polls).toBe(1)
    abort.abort()
    expect(await reader.read()).toMatchObject({done: true})
    await new Promise(resolve => setTimeout(resolve, 750))
    expect(polls).toBe(1)
})
