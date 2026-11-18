import {expect, test} from 'bun:test'
import {clock, nextSaid} from '../../src/lib/format'

test('clock never shows 60 seconds', () => {
  expect(clock(59.96)).toBe('1:00.0')
  expect(clock(119.99)).toBe('2:00.0')
  expect(clock(59.96, false)).toBe('0:59')
  expect(clock(61.25)).toBe('1:01.3')
  expect(clock(-3)).toBe('0:00.0')
  expect(clock(5)).toBe('0:05.0')
})

test('nextSaid: a changed cast is a count, the step names of a plan go', () => {
  expect(nextSaid('casting.json changed: maren is made by the project again, kael is made by the project again - planned again: blocking')).toBe(
    'Cast changed: 2 changes',
  )
  expect(nextSaid('casting.json changed: hall is played by library:hall-v2')).toBe('Cast changed: 1 change')
  expect(nextSaid('22 step(s) to generate: songStyle, music, lyrics')).toBe('22 step(s) to generate')
  expect(nextSaid('3 stale')).toBe('3 stale')
})
