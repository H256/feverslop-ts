import type {TimingLine, TimingView, TimingWord} from '../../../../shared/workspace'
import {clamp} from '../../lib/format'

/** The shortest a word can be made. */
export const MIN_WORD = 0.05
export type Span = {start: number, end: number}

/** Words as changed: 0 ≤ start, start + MIN_WORD ≤ end ≤ duration. Undefined when they are the line's own again. */
export function fixWords(line: TimingLine, words: Span[], duration: number): TimingWord[] | undefined {
  const fixed = words.map(w => {
    const start = clamp(w.start, 0, duration - MIN_WORD)
    return {start, end: clamp(w.end, start + MIN_WORD, duration)}
  })
  const same = fixed.every((w, n) => Math.abs(w.start - line.words[n]!.start) < 0.0005 && Math.abs(w.end - line.words[n]!.end) < 0.0005)
  return same ? undefined : fixed.map((w, n) => ({...w, text: line.words[n]!.text}))
}

/** A whole line moved, as far as the song goes: it keeps its length at either end. */
export function shifted(words: Span[], by: number, duration = Infinity) {
  const first = words[0]?.start ?? 0, last = words.at(-1)?.end ?? 0
  const step = clamp(by, -first, Math.max(-first, duration - last))
  return words.map(w => ({start: w.start + step, end: w.end + step}))
}

/**
 * A word or its edge stops at its neighbor. Shared-boundary movement is an explicit action.
 */
export function movedWord(words: TimingWord[], n: number, by: number, edge: 'start' | 'end' | undefined, duration: number): TimingWord[] {
  const out = words.map(w => ({...w}))
  const w = out[n]!, prev = out[n - 1], next = out[n + 1]
  const low = prev ? prev.end : 0
  const high = next ? next.start : duration
  if (edge === 'start') w.start = clamp(w.start + by, low, w.end - MIN_WORD)
  else if (edge === 'end') w.end = clamp(w.end + by, w.start + MIN_WORD, high)
  else {
    const length = w.end - w.start
    w.start = clamp(w.start + by, low, high - length)
    w.end = w.start + length
  }
  return out
}

/** The cuts between clips inside a time span: the first clip's start is no cut. */
export const cutsIn = (view: TimingView, from: number, to: number) => view.cuts.slice(1).filter(c => c.start > from && c.start < to)
/** The words a cut falls into: sung half in one clip, half in the next. */
export const crossingOf = (view: TimingView, words: TimingWord[]) => words.flatMap(w => cutsIn(view, w.start + 0.02, w.end - 0.02).map(cut => ({word: w, cut})))

/** What saving does: the clips whose vocals change, the beats planned again - worked out as the server does it, roughly. */
export function timingChanges(view: TimingView, moved: TimingLine[], wordsOf: (line: TimingLine) => TimingWord[]) {
  const touched = new Set<string>()
  for (const line of moved) {
    const words = wordsOf(line)
    const audible = (ws: TimingWord[]) => JSON.stringify(ws.map(({text, start, end, joined}) => ({text, start, end, joined: !!joined})))
    if (audible(words) === audible(line.words)) continue
    const span = [Math.min(words[0]!.start, line.words[0]!.start), Math.max(words.at(-1)!.end, line.words.at(-1)!.end)] as const
    for (const cut of view.cuts) if (cut.end > span[0] && cut.start < span[1] && cut.beat) touched.add(cut.beat)
  }
  const beats = [...touched]
  const beatOf = (id: string) => view.beats.find(x => x.id === id)
  return {
    lines: moved, beats,
    replanned: beats.filter(b => beatOf(b)?.planned),
    clips: [...new Set(beats.flatMap(b => beatOf(b)?.clips ?? []))].sort(),
    crossing: moved.flatMap(line => crossingOf(view, wordsOf(line))),
  }
}
