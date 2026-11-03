import type {TimingLine, TimingView, TimingWord} from '../../../../shared/workspace'
import {clamp} from '../../lib/format'

/** The shortest a word can be made. */
export const MIN_WORD = 0.05
export type Span = {start: number, end: number}

/** Words as changed: kept in order, at least MIN_WORD long, inside the song. Undefined when they are the line's own again. */
export function fixWords(line: TimingLine, words: Span[], duration: number): TimingWord[] | undefined {
  const fixed = words.map(w => ({start: Math.max(0, Math.min(w.start, duration - MIN_WORD)), end: Math.min(duration, Math.max(w.end, w.start + MIN_WORD))}))
  const same = fixed.every((w, n) => Math.abs(w.start - line.words[n]!.start) < 0.0005 && Math.abs(w.end - line.words[n]!.end) < 0.0005)
  return same ? undefined : fixed.map((w, n) => ({...w, text: line.words[n]!.text}))
}

export const shifted = (words: Span[], by: number) => words.map(w => ({start: w.start + by, end: w.end + by}))

/**
 * A word moved, or one of its edges: a neighbour it runs into gives way, down to MIN_WORD - an estimated line has its words spread
 * without gaps, and a word that could not push would not move at all.
 */
export function movedWord(words: TimingWord[], n: number, by: number, edge: 'start' | 'end' | undefined, duration: number): TimingWord[] {
  const out = words.map(w => ({...w}))
  const w = out[n]!, prev = out[n - 1], next = out[n + 1]
  const low = prev ? prev.start + MIN_WORD : 0
  const high = next ? next.end - MIN_WORD : duration
  if (edge === 'start') w.start = clamp(w.start + by, low, w.end - MIN_WORD)
  else if (edge === 'end') w.end = clamp(w.end + by, w.start + MIN_WORD, high)
  else {
    const length = w.end - w.start
    w.start = clamp(w.start + by, low, high - length)
    w.end = w.start + length
  }
  if (prev && prev.end > w.start) prev.end = w.start
  if (next && next.start < w.end) next.start = w.end
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
