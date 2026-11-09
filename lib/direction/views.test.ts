import {expect, test} from 'bun:test'
import {directionViewCache} from './views.ts'

test('view choices follow accepted camera edits and baseline restores, retaining unaffected beats', () => {
    const base = {a: {view: 'front'}, b: {view: 'side'}}
    const edited = {...base, a: {view: 'back'}}
    const initial = directionViewCache(base, base, {a: [0], b: [1]})
    expect(initial.invalidated).toBe(false)
    const change = directionViewCache(base, edited, initial.kept, initial.keys)
    expect(change.kept).toEqual({b: [1]})
    expect(change.invalidated).toBe(true)
    const repeat = directionViewCache(base, edited, {a: [3], b: [1]}, change.keys)
    expect(repeat.invalidated).toBe(false)
    const restore = directionViewCache(base, base, repeat.kept, repeat.keys)
    expect(restore.kept).toEqual({b: [1]})
    expect(restore.invalidated).toBe(true)
    expect(directionViewCache(base, edited, {a: [0]}).kept).toEqual({})
})
