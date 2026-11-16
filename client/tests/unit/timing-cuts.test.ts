import {expect, test} from 'bun:test'
import {ref} from 'vue'
import type {TimingLine, TimingView} from '../../../shared/workspace'
import {useTimingDraft} from '../../src/features/timing/useTimingDraft'

const line = (n: number, words: [string, number, number][]): TimingLine => ({
  line: n,
  section: 'Verse',
  text: words.map(w => w[0]).join(' '),
  words: words.map(([text, start, end]) => ({text, start, end})),
  estimated: false,
  byHand: false,
  beats: [],
})
// the second clip starts at 3.2 s: it falls into "Traum" (2.5 - 4) and 0.01 s after the start of "Nacht"
const view = (): TimingView => ({
  duration: 20,
  lines: [
    line(0, [
      ['Ein', 1, 2.5],
      ['Traum', 2.5, 4],
    ]),
    line(1, [
      ['Nacht', 6.99, 8],
      ['du', 8, 9],
    ]),
  ],
  cuts: [
    {id: 'clip-1', start: 0, end: 3.2},
    {id: 'clip-2', start: 3.2, end: 7},
    {id: 'clip-3', start: 7, end: 20},
  ],
  beats: [],
  unplanned: [],
  outdated: [],
})
const draftOf = (v = view()) => ({v, draft: useTimingDraft(ref(v))})

test('a word a cut falls into: where it would be split, guessed from the time', () => {
  const {v, draft} = draftOf()
  const [first] = draft.cutSplits(v.lines[0]!)
  expect(first!.before).toBe('Tr')
  expect(first!.after).toBe('aum')
  expect(first!.time).toBe(3.2)
  expect(first!.ok).toBe(true)
})

test('a cut a hair after the start of a word cannot split it, the other words are not touched', () => {
  const {v, draft} = draftOf()
  const [near] = draft.cutSplits(v.lines[1]!)
  expect(near).toBeUndefined()
  const tight = draftOf({...view(), lines: [line(1, [['Nacht', 6.97, 8]])]})
  const [blocked] = tight.draft.cutSplits(tight.v.lines[0]!)
  expect(blocked!.ok).toBe(false)
})

test('splitting at the cut keeps every letter and the whole span, and joining puts it back', () => {
  const {v, draft} = draftOf()
  const count = draft.splitAtCuts(draft.cutSplits(v.lines[0]!))
  expect(count).toBe(1)
  const words = draft.wordsOf(v.lines[0]!)
  expect(words.map(w => w.text).join('|')).toBe('Ein|Tr|aum')
  expect(words[1]!.start).toBe(2.5)
  expect(words[1]!.end).toBe(3.2)
  expect(words[2]!.start).toBe(3.2)
  expect(words[2]!.end).toBe(4)
  expect(words[2]!.joined).toBe(true)
  // no cut falls into a word any more
  expect(draft.crossing(v.lines[0]!).length).toBe(0)
  // one step back is the whole split
  draft.undo()
  expect(draft.wordsOf(v.lines[0]!).length).toBe(2)
})

test('the same word can be split again after joining: the parts become one word at the old time span', () => {
  const {v, draft} = draftOf()
  draft.splitAtCuts(draft.cutSplits(v.lines[0]!))
  draft.pickWord(v.lines[0]!, 1)
  draft.pickWord(v.lines[0]!, 2, true)
  draft.join()
  const words = draft.wordsOf(v.lines[0]!)
  expect(words.map(w => w.text).join('|')).toBe('Ein|Traum')
  expect(words[1]!.start).toBe(2.5)
  expect(words[1]!.end).toBe(4)
  draft.split(3, 3.2)
  expect(
    draft
      .wordsOf(v.lines[0]!)
      .map(w => w.text)
      .join('|'),
  ).toBe('Ein|Tra|um')
})
