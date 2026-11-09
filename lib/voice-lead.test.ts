import {describe, expect, test} from 'bun:test'
import {RATE, voiceLead} from '../shared/timing-fit.ts'

// the loudness of a stem at 100 values a second: silent, with stretches of singing
const stem = (seconds: number, sung: [number, number][]) =>
  Array.from({length: Math.round(seconds * RATE)}, (_, i) => sung.some(([a, b]) => i / RATE >= a && i / RATE < b) ? 0.6 : 0.004)

describe('singing heard before the first word of a line', () => {
  test('a word the timing lost: the sound runs into the first word from before it', () => {
    // schwarzer-flur line 21: "Die" sung from 105.1, the timing starts at "ich" (105.8)
    expect(voiceLead([{start: 105.8, end: 106.0}, {start: 106.0, end: 106.4}], stem(110, [[105.1, 106.4]]), 103)).toBeCloseTo(0.7, 1)
  })
  test('a pause before the first word: nothing', () => {
    expect(voiceLead([{start: 105.8, end: 106.4}], stem(110, [[103, 104.5], [105.8, 106.4]]), 103)).toBe(0)
  })
  test('a short gap (a breath, a consonant) still belongs to it', () => {
    expect(voiceLead([{start: 105.8, end: 106.4}], stem(110, [[105.2, 105.7], [105.8, 106.4]]), 103)).toBeCloseTo(0.6, 1)
  })
  test('never back past notBefore - the cut or the words sung before', () => {
    expect(voiceLead([{start: 105.8, end: 106.4}], stem(110, [[104, 106.4]]), 105.5)).toBeCloseTo(0.3, 1)
  })
  test('without words or loudness: none', () => {
    expect(voiceLead([], stem(1, []), 0)).toBe(0)
    expect(voiceLead([{start: 0, end: 1}], [], 0)).toBe(0)
  })
})
