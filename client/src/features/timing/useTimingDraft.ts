import {computed, reactive, ref, shallowRef, type Ref} from 'vue'
import type {TimingChange, TimingLine, TimingView, TimingWord} from '../../../../shared/workspace'
import {clamp} from '../../lib/format'
import {crossingOf, movedWord, timingChanges} from './words'
import {translate, splitWord, joinWords, fitSelection, markWords, validateWords} from './edit'

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
  const future = reactive<Edits[]>([])
  const origin = ref<{line: number; word?: number}>()
  const collapsed = ref(new Set<string>())
  const selected = ref<number | undefined>(view.value.lines.find(l => l.estimated)?.line ?? view.value.lines[0]?.line)
  const word = ref<number>()
  const pad = ref(2.5)

  const lineOf = (n: number | undefined) => view.value.lines.find(l => l.line === n)
  const line = computed(() => lineOf(selected.value))
  const wordsOf = (l: TimingLine) => edits.value.get(l.line) ?? l.words
  const startOf = (l: TimingLine) => wordsOf(l)[0]?.start ?? 0
  const endOf = (l: TimingLine) => wordsOf(l).at(-1)?.end ?? 0
  const isChanged = (l: TimingLine) => edits.value.has(l.line)
  // a line left out is not sung: no cut falls into it
  const crossing = (l: TimingLine) => (l.off ? [] : crossingOf(view.value, wordsOf(l)))

  /** Before a change: what there was, for Ctrl+Z. */
  const remember = () => {
    history.push(copy(edits.value))
    if (history.length > UNDO_STEPS) history.shift()
  }
  /** A drag that changed nothing is no undo step. */
  const settle = () => {
    if (history.length && sameEdits(history.at(-1)!, edits.value)) history.pop()
  }
  const undo = () => {
    const before = history.pop()
    if (before) {
      future.push(copy(edits.value))
      edits.value = before
      origin.value = undefined
      word.value = undefined
    }
  }
  const redo = () => {
    const after = future.pop()
    if (after) {
      history.push(copy(edits.value))
      edits.value = after
      origin.value = undefined
      word.value = undefined
    }
  }
  const setWords = (l: TimingLine, words: TimingWord[]) => {
    validateWords(words, view.value.duration)
    words = words.map((w, n) => {
      const previous = l.words[n]
      const moved = !previous || previous.start !== w.start || previous.end !== w.end
      return {
        ...w,
        start: Math.round(w.start * 1000) / 1000,
        end: Math.round(w.end * 1000) / 1000,
        ...(moved && l.estimated && w.estimated === undefined ? {estimated: true} : {}),
      }
    })
    const next = new Map(edits.value)
    JSON.stringify(words) === JSON.stringify(l.words)
      ? next.delete(l.line)
      : next.set(
          l.line,
          words.map(w => ({...w})),
        )
    if (!sameEdits(next, edits.value)) future.splice(0)
    edits.value = next
  }
  const moveLine = (l: TimingLine, by: number) => setWords(l, translate(wordsOf(l), 0, wordsOf(l).length - 1, by, view.value.duration))
  const moveWord = (l: TimingLine, n: number, by: number, edge?: 'start' | 'end') => setWords(l, movedWord(wordsOf(l), n, by, edge, view.value.duration))
  const resetLine = (l: TimingLine) => {
    remember()
    setWords(l, l.words)
    settle()
    origin.value = undefined
    word.value = undefined
  }
  /** The first word of each line given starts where its sound does: `leads` is how early it starts, by line. One undo step for all. */
  const tighten = (leads: Map<number, number>) => {
    remember()
    for (const [n, lead] of leads) {
      const l = lineOf(n)
      if (l && lead > 0) moveWord(l, 0, lead, 'start')
    }
    settle()
  }
  const discard = () => {
    edits.value = new Map()
    history.splice(0)
    future.splice(0)
    origin.value = undefined
    word.value = undefined
  }

  /** The part of the song seen in the editor: the chosen line with some seconds around it, at least four seconds. */
  const window = computed(() => {
    const l = line.value
    if (!l) return {from: 0, to: 10}
    const chosen = selectedWords.value
    const from = Math.max(0, Math.min(startOf(l), ...chosen.map(w => w.start)) - pad.value)
    return {from, to: Math.min(view.value.duration, Math.max(endOf(l) + pad.value, ...chosen.map(w => w.end + pad.value), from + 4))}
  })
  const zoom = (factor: number) => {
    pad.value = clamp(pad.value * factor, 0.3, 30)
  }
  const choose = (n: number, extend = false) => {
    if (!extend) origin.value = {line: n}
    else origin.value ??= {line: selected.value ?? n, word: word.value}
    selected.value = n
    word.value = undefined
  }
  const pickWord = (l: TimingLine, n: number, extend = false) => {
    if (!extend) origin.value = {line: l.line, word: n}
    else origin.value ??= {line: selected.value ?? l.line, word: word.value ?? 0}
    selected.value = l.line
    word.value = n
  }
  const selection = computed(() => {
    const a = origin.value ?? {line: selected.value, word: undefined},
      b = {line: selected.value, word: word.value}
    const ai = view.value.lines.findIndex(l => l.line === a.line),
      bi = view.value.lines.findIndex(l => l.line === b.line)
    const lo = Math.min(ai, bi),
      hi = Math.max(ai, bi)
    return view.value.lines.flatMap((l, i) => {
      if (i < lo || i > hi) return []
      let first = 0,
        last = wordsOf(l).length - 1
      if (ai === bi && a.word !== undefined && b.word !== undefined) {
        first = Math.min(a.word, b.word)
        last = Math.max(a.word, b.word)
      } else {
        if (i === lo) first = (ai <= bi ? a.word : b.word) ?? 0
        if (i === hi) last = (ai <= bi ? b.word : a.word) ?? last
      }
      const count = wordsOf(l).length
      if (!count) return []
      first = clamp(first, 0, count - 1)
      last = clamp(last, first, count - 1)
      return [{line: l, first, last}]
    })
  })
  const selectedWords = computed(() => selection.value.flatMap(s => wordsOf(s.line).slice(s.first, s.last + 1)))
  const contains = (l: TimingLine, n: number) => selection.value.some(s => s.line.line === l.line && n >= s.first && n <= s.last)
  const moveSelection = (by: number) => {
    let low = -Infinity,
      high = Infinity
    for (const s of selection.value) {
      const ws = wordsOf(s.line)
      low = Math.max(low, (ws[s.first - 1]?.end ?? 0) - ws[s.first]!.start)
      high = Math.min(high, (ws[s.last + 1]?.start ?? view.value.duration) - ws[s.last]!.end)
    }
    const step = Math.max(low, Math.min(high, by))
    for (const s of selection.value) setWords(s.line, translate(wordsOf(s.line), s.first, s.last, step, view.value.duration))
  }
  const action = (run: () => void) => {
    const redoBefore = future.map(copy)
    remember()
    try {
      run()
    } catch (e) {
      edits.value = history.pop()!
      future.splice(0, future.length, ...redoBefore)
      throw e
    }
    settle()
  }
  const patchSelection = (patch: Partial<TimingWord>) =>
    action(() => {
      for (const s of selection.value)
        setWords(
          s.line,
          wordsOf(s.line).map((w, n) => (n >= s.first && n <= s.last ? {...w, ...patch} : w)),
        )
    })
  const groupSelection = () => patchSelection({group: `group-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`})
  const split = (character: number, time: number) => {
    const s = selection.value[0]
    if (!s || selection.value.length !== 1 || s.first !== s.last) throw new Error('Select one word to split.')
    action(() => setWords(s.line, splitWord(wordsOf(s.line), s.first, character, time)))
    pickWord(s.line, s.first)
    pickWord(s.line, s.first + 1, true)
  }
  const join = () => {
    const s = selection.value[0]
    if (!s || selection.value.length !== 1) throw new Error('Select parts in one line.')
    action(() => setWords(s.line, joinWords(wordsOf(s.line), s.first, s.last)))
    pickWord(s.line, s.first)
  }
  const previewFit = (from: number, to: number) => {
    if (!selectedWords.value.length) throw new Error('Select a passage first.')
    return fitSelection(selectedWords.value, 0, selectedWords.value.length - 1, from, to, view.value.duration)
  }
  const replaceSelection = (words: TimingWord[], rememberAction = true) => {
    let offset = 0
    const updates = selection.value.map(s => {
      const ws = wordsOf(s.line).map(w => ({...w}))
      ws.splice(s.first, s.last - s.first + 1, ...words.slice(offset, offset + s.last - s.first + 1))
      offset += s.last - s.first + 1
      validateWords(ws, view.value.duration)
      return {line: s.line, words: ws}
    })
    const apply = () => {
      for (const u of updates) setWords(u.line, u.words)
    }
    if (rememberAction) action(apply)
    else apply()
  }
  const fit = (from: number, to: number) => replaceSelection(previewFit(from, to))
  const fitLive = (from: number, to: number) => replaceSelection(previewFit(from, to), false)
  const mark = (marks: number[]) => replaceSelection(markWords(selectedWords.value, marks, view.value.duration))
  const boundary = (l: TimingLine, n: number, time: number) => {
    const ws = wordsOf(l).map(w => ({...w}))
    if (!ws[n] || !ws[n + 1]) return
    time = clamp(time, ws[n]!.start + 0.05, ws[n + 1]!.end - 0.05)
    ws[n]!.end = time
    ws[n + 1]!.start = time
    validateWords(ws, view.value.duration)
    setWords(l, ws)
  }
  const unchecked = (l: TimingLine) => wordsOf(l).some(w => w.estimated ?? l.estimated)
  /** Tab and Shift+Tab: the next or the word before, then the line again. */
  const nextWord = (back: boolean) => {
    const count = (line.value && wordsOf(line.value).length) ?? 0
    const next = word.value === undefined ? (back ? count - 1 : 0) : word.value + (back ? -1 : 1)
    if (line.value) next < 0 || next >= count ? choose(line.value.line) : pickWord(line.value, next)
  }

  const moved = computed(() => view.value.lines.filter(isChanged))
  const changes = computed(() => timingChanges(view.value, moved.value, wordsOf))
  const request = (): TimingChange => ({
    lines: moved.value.map(l => {
      const ws = wordsOf(l)
      const meta = (x: TimingWord) => JSON.stringify({text: x.text, joined: x.joined, anchor: x.anchor, estimated: x.estimated, group: x.group})
      const structural = ws.length !== l.words.length || ws.some((w, n) => !l.words[n] || meta(w) !== meta(l.words[n]!))
      return {line: l.line, words: ws.map(w => (structural ? {...w} : {start: w.start, end: w.end}))}
    }),
  })
  /** Lines of one singer come one after the other: one running into the next is mostly a line moved too far. */
  const overlaps = computed(() => {
    const l = line.value
    if (!l || l.off) return []
    // the lines sung around it: one left out overlaps nothing
    const at = view.value.lines.indexOf(l)
    const before = view.value.lines
        .slice(0, at)
        .reverse()
        .find(x => !x.off),
      after = view.value.lines.slice(at + 1).find(x => !x.off)
    return [before && endOf(before) > startOf(l) + 0.02 ? before : undefined, after && startOf(after) < endOf(l) - 0.02 ? after : undefined].filter(
      (x): x is TimingLine => !!x,
    )
  })
  return {
    edits,
    history,
    future,
    collapsed,
    selection,
    selectedWords,
    contains,
    pickWord,
    moveSelection,
    groupSelection,
    split,
    join,
    patchSelection,
    fit,
    fitLive,
    previewFit,
    mark,
    boundary,
    unchecked,
    selected,
    word,
    pad,
    line,
    window,
    changes,
    overlaps,
    lineOf,
    wordsOf,
    startOf,
    endOf,
    isChanged,
    crossing,
    remember,
    settle,
    undo,
    redo,
    moveLine,
    moveWord,
    resetLine,
    tighten,
    discard,
    zoom,
    choose,
    nextWord,
    request,
  }
}
export type TimingDraft = ReturnType<typeof useTimingDraft>
