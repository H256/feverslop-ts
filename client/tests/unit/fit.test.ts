import {describe, expect, test} from 'bun:test'
import {EARLY_FROM, leadOf, RATE} from '../../src/features/timing/fit'

// the loudness of a stem at 100 values a second: silent, with a stretch of singing
const stem = (seconds: number, sung: [number, number][], level = 0.6) =>
  Array.from({length: Math.round(seconds * RATE)}, (_, i) => sung.some(([a, b]) => i / RATE >= a && i / RATE < b) ? level : 0.004)

describe('where the first word of a line starts against its sound', () => {
  test('on the sound: nothing early', () => {
    expect(leadOf([{start: 5, end: 5.6}, {start: 5.6, end: 6.2}], stem(10, [[5, 6.2]]))).toBe(0)
  })
  test('before the sound: as long as the silence at the start of the first word', () => {
    expect(leadOf([{start: 4.4, end: 5.6}, {start: 5.6, end: 6.2}], stem(10, [[5, 6.2]]))).toBeCloseTo(0.6, 1)
  })
  test('a word with no sound in it at all is silent as a whole - a line a long way off', () => {
    expect(leadOf([{start: 1, end: 1.8}, {start: 1.8, end: 2.4}], stem(10, [[5, 6.2]]))).toBeCloseTo(0.8, 1)
  })
  test('a click is no sound, the words after the first do not matter, a quiet passage still counts', () => {
    const peaks = stem(10, [[5.5, 6.5]])
    peaks[510] = 0.9
    expect(leadOf([{start: 5, end: 5.8}, {start: 5.8, end: 6.4}], peaks)).toBeCloseTo(0.5, 1)
    // the same line sung quietly: the level is what is sung around it
    expect(leadOf([{start: 5, end: 5.8}], stem(10, [[5.5, 6.5]], 0.08))).toBeCloseTo(0.5, 1)
  })
  test('without words or loudness: none', () => {
    expect(leadOf([], stem(1, []))).toBe(0)
    expect(leadOf([{start: 0, end: 1}], [])).toBe(0)
    // a line moved by hand is 0.03 s off at most: well under what is said to be early
    expect(EARLY_FROM > 0.03).toBe(true)
  })
})
