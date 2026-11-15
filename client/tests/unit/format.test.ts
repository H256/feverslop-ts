import {expect, test} from 'bun:test'
import {clock} from '../../src/lib/format'

test('clock never shows 60 seconds', () => {
  expect(clock(59.96)).toBe('1:00.0')
  expect(clock(119.99)).toBe('2:00.0')
  expect(clock(59.96, false)).toBe('0:59')
  expect(clock(61.25)).toBe('1:01.3')
  expect(clock(-3)).toBe('0:00.0')
  expect(clock(5)).toBe('0:05.0')
})
