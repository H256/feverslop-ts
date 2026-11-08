import {expect, test} from 'bun:test'
import {ref} from 'vue'
import {useTimingDraft} from '../../src/features/timing/useTimingDraft'
import type {TimingView} from '../../../shared/workspace'

const view = (): TimingView => ({duration: 20, lines: [
  {line: 0, section: 'Verse', text: 'one two', words: [{text: 'one', start: 1, end: 2}, {text: 'two', start: 2.5, end: 3}], estimated: true, byHand: false, beats: []},
  {line: 1, section: 'Verse', text: 'three', words: [{text: 'three', start: 5, end: 6}], estimated: false, byHand: false, beats: []},
], cuts: [], beats: [], unplanned: [], outdated: []})

test('selection across lines translates together; undo and redo restore the complete edit', () => {
  const shown = ref(view()), draft = useTimingDraft(shown)
  draft.choose(0)
  draft.choose(1, true)
  draft.remember()
  draft.moveSelection(1)
  draft.settle()
  expect(draft.wordsOf(shown.value.lines[0]!)[0]!.start).toBe(2)
  expect(draft.wordsOf(shown.value.lines[1]!)[0]!.start).toBe(6)
  draft.undo()
  expect(draft.edits.value.size).toBe(0)
  draft.redo()
  expect(draft.edits.value.size).toBe(2)
})
test('split and join are serialized, reversible structural edits', () => {
  const shown = ref(view()), draft = useTimingDraft(shown)
  draft.pickWord(shown.value.lines[1]!, 0)
  draft.split(2, 5.5)
  expect(draft.wordsOf(shown.value.lines[1]!).map(w => w.text)).toEqual(['th', 'ree'])
  expect(draft.request().lines[0]!.words![1]!.text).toBe('ree')
  draft.join()
  expect(draft.wordsOf(shown.value.lines[1]!).map(w => w.text)).toEqual(['three'])
  draft.undo()
  expect(draft.wordsOf(shown.value.lines[1]!)).toHaveLength(2)
})
test('new editing after undo invalidates redo; grouping preserves inner timing', () => {
  const shown = ref(view()), draft = useTimingDraft(shown)
  draft.choose(0)
  draft.groupSelection()
  expect(draft.wordsOf(shown.value.lines[0]!)[0]!.group).toBe(draft.wordsOf(shown.value.lines[0]!)[1]!.group)
  expect(draft.wordsOf(shown.value.lines[0]!)[1]!.start).toBe(2.5)
  draft.undo()
  draft.remember()
  draft.moveSelection(0.2)
  expect(draft.future.length).toBe(0)
})

test('a selection click or rejected edit after undo preserves redo', () => {
  const shown = ref(view()), draft = useTimingDraft(shown)
  draft.groupSelection()
  draft.undo()
  draft.remember(); draft.settle()
  expect(draft.future.length).toBe(1)
  draft.redo()
  expect(draft.wordsOf(shown.value.lines[0]!)[0]!.group !== undefined).toBe(true)
})

test('resetting or discarding a split repairs the selection before the next move', () => {
  for (const reset of [true, false]) {
    const shown = ref(view()), draft = useTimingDraft(shown)
    draft.pickWord(shown.value.lines[1]!, 0)
    draft.split(2, 5.5)
    reset ? draft.resetLine(shown.value.lines[1]!) : draft.discard()
    expect(draft.word.value).toBeUndefined()
    expect(draft.selectedWords.value.map(w => w.text)).toEqual(['three'])
    draft.remember(); draft.moveSelection(.1); draft.settle()
    expect(draft.wordsOf(shown.value.lines[1]!)[0]!.start).toBe(5.1)
  }
})

test('fitting a selection through several pointer updates is one undo step', () => {
  const shown = ref(view()), draft = useTimingDraft(shown)
  draft.remember()
  draft.fitLive(1, 4)
  draft.fitLive(1, 5)
  draft.settle()
  expect(draft.history.length).toBe(1)
  expect(draft.wordsOf(shown.value.lines[0]!)[1]!.end).toBe(5)
  draft.undo()
  expect(draft.wordsOf(shown.value.lines[0]!)[1]!.end).toBe(3)
})
