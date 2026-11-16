import {expect, test} from 'bun:test'
import {ref} from 'vue'
import type {TimingLine, TimingView} from '../../../shared/workspace'
import {useTimingDraft} from '../../src/features/timing/useTimingDraft'

const line = (n: number, words: [string, number, number][]): TimingLine => ({
  line: n,
  section: 'Chorus',
  text: words.map(w => w[0]).join(' '),
  words: words.map(([text, start, end]) => ({text, start, end})),
  estimated: false,
  byHand: false,
  beats: [],
})
const view = (): TimingView => ({
  duration: 20,
  lines: [
    line(0, [
      ['Ich', 1, 2],
      ['bin', 2, 3],
    ]),
    // starts a whole word too early: inside the vowel of "bin"
    line(1, [
      ['nicht', 2.5, 3.5],
      ['mehr', 3.5, 5],
    ]),
  ],
  cuts: [],
  beats: [],
  unplanned: [],
  outdated: [],
})

test('the boundary of two lines: the earlier one ends there, the later one is fitted after it', () => {
  const v = view()
  const draft = useTimingDraft(ref(v))
  const [a, b] = v.lines as [TimingLine, TimingLine]
  draft.moveBoundary(a, b, 4)
  expect(draft.wordsOf(a).at(-1)!.end).toBe(4)
  expect(draft.wordsOf(a)[0]!.start).toBe(1)
  expect(draft.wordsOf(a)[0]!.end).toBe(2)
  expect(draft.startOf(b)).toBe(4)
  expect(draft.endOf(b)).toBe(5)
  const words = draft.wordsOf(b)
  expect(words[0]!.end <= words[1]!.start).toBe(true)
  expect(words.every(w => w.end - w.start >= 0.05)).toBe(true)
})

test('a boundary dragged live is always worked out from where the drag began', () => {
  const v = view()
  const draft = useTimingDraft(ref(v))
  const [a, b] = v.lines as [TimingLine, TimingLine]
  const base = draft.boundaryBase(a, b)
  draft.moveBoundary(a, b, 4.5, base)
  draft.moveBoundary(a, b, 3.2, base)
  expect(draft.wordsOf(a).at(-1)!.end).toBe(3.2)
  expect(draft.startOf(b)).toBe(3.2)
  expect(draft.endOf(b)).toBe(5)
})

test('where the later line has no room after the boundary it moves along as a whole', () => {
  const v = view()
  const draft = useTimingDraft(ref(v))
  const [a, b] = v.lines as [TimingLine, TimingLine]
  draft.moveBoundary(a, b, 4.95)
  expect(draft.wordsOf(a).at(-1)!.end).toBe(4.95)
  expect(draft.startOf(b)).toBe(4.95)
  expect(draft.endOf(b)).toBe(7.45)
})

test('with push the later line keeps its length and its words keep their places', () => {
  const v = view()
  const draft = useTimingDraft(ref(v))
  const [a, b] = v.lines as [TimingLine, TimingLine]
  draft.moveBoundary(a, b, 4, undefined, true)
  const words = draft.wordsOf(b)
  expect(words[0]!.start).toBe(4)
  expect(words[0]!.end).toBe(5)
  expect(words[1]!.start).toBe(5)
  expect(words[1]!.end).toBe(6.5)
})

test('the earlier line keeps room for its own last word', () => {
  const v = view()
  const draft = useTimingDraft(ref(v))
  const [a, b] = v.lines as [TimingLine, TimingLine]
  let message = ''
  try {
    draft.moveBoundary(a, b, 2.01)
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  expect(message).toContain('at least 0.05')
  expect(draft.edits.value.size).toBe(0)
})
