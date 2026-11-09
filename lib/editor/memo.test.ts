import {expect, test} from 'bun:test'
import {boundedMemo} from './memo.ts'

test('a result is made once while it is among the newest', () => {
    const memo = boundedMemo<number>(2)
    let made = 0
    const make = () => ++made
    expect([memo('a', make), memo('a', make)]).toEqual([1, 1])
})
test('the least recently used result goes when there are more than max', () => {
    const memo = boundedMemo<string>(2)
    let made = 0
    const make = () => `v${++made}`
    memo('a', make)
    memo('b', make)
    memo('a', make) // a is newer than b now
    memo('c', make) // b goes
    expect(memo('a', make)).toBe('v1')
    expect(memo('b', make)).toBe('v4')
})
