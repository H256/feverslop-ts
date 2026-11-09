import {expect, test} from 'bun:test'
import * as edit from '../../src/features/timing/edit'

const words = () => [
  {text: 'ein', start: 1, end: 1.5},
  {text: 'Rosmarienbaum.', start: 2, end: 5},
]
test('split and rejoin retain text, gaps, metadata and outer times', () => {
  const split = edit.splitWord(words(), 1, 5, 3)
  expect(split.map(w => w.text)).toEqual(['ein', 'Rosma', 'rienbaum.'])
  expect(split[2]!.joined).toBe(true)
  expect(edit.joinWords(split, 1, 2)).toEqual(words())
})
test('translation preserves gaps and stops at unselected neighbors', () => {
  const original = words()
  const moved = edit.translate(original, 0, 0, 4, 10)
  expect(moved[0]!.end).toBe(2)
  expect(moved[1]).toEqual(original[1])
  const all = edit.translate(original, 0, 1, 1, 10)
  expect(all.map(w => [w.start, w.end])).toEqual([
    [2, 2.5],
    [3, 6],
  ])
})
test('fitting keeps confirmed onsets and marks inferred timings provisional', () => {
  const source = [
    {text: 'a', start: 1, end: 2},
    {text: 'b', start: 3, end: 4, anchor: true},
    {text: 'c', start: 5, end: 6},
  ]
  const fitted = edit.fitSelection(source, 0, 2, 0, 8, 10)
  expect(fitted[0]!.start).toBe(0)
  expect(fitted[1]!.start).toBe(3)
  expect(fitted[2]!.end).toBe(8)
  expect(fitted.every(w => w.estimated)).toBe(true)
  expect(source[0]!.start).toBe(1)
})
test('onset marking keeps source words and requires ordered marks plus an explicit end', () => {
  const marked = edit.markWords(words(), [2, 3, 6], 10)
  expect(marked.map(w => [w.start, w.end, w.anchor, w.estimated])).toEqual([
    [2, 3, true, true],
    [3, 6, true, true],
  ])
  let rejected = false
  try {
    edit.markWords(words(), [2, 1, 6], 10)
  } catch {
    rejected = true
  }
  expect(rejected).toBe(true)
})

test('clip preview follows start-frame assignment and continuation text', () => {
  const split = edit.splitWord(words(), 1, 5, 3)
  expect(edit.clipText(split, 0, 3)).toBe('ein Rosma-')
  expect(edit.clipText(split, 3, 6)).toBe('-rienbaum.')
  expect(edit.clipText(words(), 3, 6)).toBe('')
})
