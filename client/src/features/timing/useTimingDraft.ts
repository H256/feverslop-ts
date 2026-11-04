import {computed, reactive, ref, shallowRef, type Ref} from 'vue'
import type {TimingChange, TimingLine, TimingView, TimingWord} from '../../../../shared/workspace'
import {clamp} from '../../lib/format'
import {clearedCut, crossingOf, fixWords, movedWord, shifted, timingChanges, type Span} from './words'

const UNDO_STEPS = 200
type Edits = Map<number, TimingWord[]>
const copy = (edits: Edits): Edits => new Map([...edits].map(([k, v]) => [k, v.map(w => ({...w}))]))
const sameEdits = (a: Edits, b: Edits) => JSON.stringify([...a]) === JSON.stringify([...b])

/**
 * When the lyrics are sung, as moved on the page and not saved yet: the words of each moved line, an undo history, the line and the
 * word chosen, and how much is seen around the line.
 */
export function useTimingDraft(view: Ref<TimingView>) {
  const edits = shallowRef<Edits>(new Map())
  const history = reactive<Edits[]>([])
  const selected = ref<number | undefined>(view.value.lines.find(l => l.estimated)?.line ?? view.value.lines[0]?.line)
  const word = ref<number>()
  const pad = ref(2.5)

  const lineOf = (n: number | undefined) => view.value.lines.find(l => l.line === n)
  const line = computed(() => lineOf(selected.value))
  const wordsOf = (l: TimingLine) => edits.value.get(l.line) ?? l.words
  const startOf = (l: TimingLine) => wordsOf(l)[0]?.start ?? 0
  const endOf = (l: TimingLine) => wordsOf(l).at(-1)?.end ?? 0
  const isChanged = (l: TimingLine) => edits.value.has(l.line)
  const crossing = (l: TimingLine) => crossingOf(view.value, wordsOf(l))

  /** Before a change: what there was, for Ctrl+Z. */
  const remember = () => {
    history.push(copy(edits.value))
    if (history.length > UNDO_STEPS) history.shift()
  }
  /** A drag that changed nothing is no undo step. */
  const settle = () => { if (history.length && sameEdits(history.at(-1)!, edits.value)) history.pop() }
  const undo = () => { const before = history.pop(); if (before) edits.value = before }
  const setWords = (l: TimingLine, words: Span[]) => {
    const next = new Map(edits.value)
    const fixed = fixWords(l, words, view.value.duration)
    fixed ? next.set(l.line, fixed) : next.delete(l.line)
    edits.value = next
  }
  const moveLine = (l: TimingLine, by: number) => setWords(l, shifted(wordsOf(l), by, view.value.duration))
  const moveWord = (l: TimingLine, n: number, by: number, edge?: 'start' | 'end') => setWords(l, movedWord(wordsOf(l), n, by, edge, view.value.duration))
  const resetLine = (l: TimingLine) => { remember(); setWords(l, l.words) }
  /** The first word of each line given starts where its sound does: `leads` is how early it starts, by line. One undo step for all. */
  const tighten = (leads: Map<number, number>) => {
    remember()
    for (const [n, lead] of leads) {
      const l = lineOf(n)
      if (l && lead > 0) moveWord(l, 0, lead, 'start')
    }
    settle()
  }
  /** The clip cuts inside the words of a line taken out, each by the smallest change (words.clearedCut). One undo step. */
  const clearCuts = (l: TimingLine) => {
    remember()
    for (let guard = 0; guard < l.words.length * 2; guard++) {
      const found = crossing(l)[0]
      if (!found) break
      setWords(l, clearedCut(wordsOf(l), wordsOf(l).indexOf(found.word), found.cut.start, view.value.duration))
    }
    settle()
  }
  const discard = () => { edits.value = new Map(); history.splice(0) }

  /** The part of the song seen in the editor: the chosen line with some seconds around it, at least four seconds. */
  const window = computed(() => {
    const l = line.value
    if (!l) return {from: 0, to: 10}
    const from = Math.max(0, startOf(l) - pad.value)
    return {from, to: Math.min(view.value.duration, Math.max(endOf(l) + pad.value, from + 4))}
  })
  const zoom = (factor: number) => { pad.value = clamp(pad.value * factor, 0.3, 30) }
  const choose = (n: number) => { selected.value = n; word.value = undefined }
  /** Tab and Shift+Tab: the next or the word before, then the line again. */
  const nextWord = (back: boolean) => {
    const count = line.value?.words.length ?? 0
    const next = word.value === undefined ? (back ? count - 1 : 0) : word.value + (back ? -1 : 1)
    word.value = next < 0 || next >= count ? undefined : next
  }

  const moved = computed(() => view.value.lines.filter(isChanged))
  const changes = computed(() => timingChanges(view.value, moved.value, wordsOf))
  const request = (): TimingChange => ({lines: moved.value.map(l => ({line: l.line, words: wordsOf(l).map(w => ({start: w.start, end: w.end}))}))})
  /** Lines of one singer come one after the other: one running into the next is mostly a line moved too far. */
  const overlaps = computed(() => {
    const l = line.value
    if (!l) return []
    const at = view.value.lines.indexOf(l)
    const before = view.value.lines[at - 1], after = view.value.lines[at + 1]
    return [before && endOf(before) > startOf(l) + 0.02 ? before : undefined, after && startOf(after) < endOf(l) - 0.02 ? after : undefined].filter((x): x is TimingLine => !!x)
  })
  return {
    edits, history, selected, word, pad, line, window, changes, overlaps,
    lineOf, wordsOf, startOf, endOf, isChanged, crossing,
    remember, settle, undo, moveLine, moveWord, resetLine, tighten, clearCuts, discard, zoom, choose, nextWord, request,
  }
}
export type TimingDraft = ReturnType<typeof useTimingDraft>
