import {expect, test} from 'bun:test'
import {withDirection} from './status.ts'

const render = {command: 'bun index.ts x --render=videos --refresh=clips', why: '37 stale'}

test('a direction waiting for its review is the next step once nothing is left to plan, on its page (#782)', () => {
    const {next, notes} = withDirection(render, {pending: true, unresolved: ['shot b5:shot1 "Elias strides": planned again']}, [], 'music', 'x')
    expect(next).toEqual({
        command: 'bun run direction x --preview',
        why: 'direction needs review: a rule to rebind or remove, then preview and take',
        page: 'direction',
    })
    expect(notes.map(([label]) => label)).toEqual(['Direction'])
    expect(withDirection(render, {pending: true, unresolved: []}, [], 'film', 'f').next.command).toBe('bun run direction f --film --preview')
})

test('steps to plan come first; no review, no change', () => {
    const plan = {command: 'bun index.ts x', why: '1 step(s) to generate: shotViews'}
    expect(withDirection(plan, {pending: true, unresolved: []}, ['shotViews'], 'music', 'x').next).toBe(plan)
    expect(withDirection(render, {pending: false, unresolved: []}, [], 'music', 'x')).toEqual({next: render, notes: []})
    expect(withDirection(render, undefined, [], 'music', 'x')).toEqual({next: render, notes: []})
})
