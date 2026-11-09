import type {TimingWord} from '../../../../shared/workspace'
import {MIN_WORD} from './words'
import {frameAt} from '../../../../lib/frames'

const round = (t: number) => Math.round(t * 1000) / 1000
const copy = (words: TimingWord[]) => words.map(w => ({...w}))

export const clipWords = (words: TimingWord[], from: number, to: number) =>
  words.filter(w => w.end - w.start >= MIN_WORD && frameAt(w.start) >= frameAt(from) && frameAt(w.start) < frameAt(to))
export function clipText(words: TimingWord[], from: number, to: number): string {
  const selected = clipWords(words, from, to)
  if (!selected.length) return ''
  const last = words.indexOf(selected.at(-1)!)
  return (selected[0]!.joined ? '-' : '') + selected.map((w, i) => `${i && !w.joined ? ' ' : ''}${w.text}`).join('') + (words[last + 1]?.joined ? '-' : '')
}

export function validateWords(words: TimingWord[], duration: number) {
  if (!words.length) throw new Error('Select at least one word.')
  words.forEach((w, i) => {
    if (!Number.isFinite(w.start) || !Number.isFinite(w.end) || w.start < 0 || w.end > duration + 0.0001 || w.end - w.start < MIN_WORD - 0.0001)
      throw new Error('Every word needs at least 0.05 seconds inside the song.')
    if (i && w.start < words[i - 1]!.end - 0.0001) throw new Error('Words cannot overlap within a line.')
  })
}

/** Move a consecutive selection without silently changing its neighbors. */
export function translate(words: TimingWord[], first: number, last: number, by: number, duration: number): TimingWord[] {
  const out = copy(words)
  const low = (words[first - 1]?.end ?? 0) - words[first]!.start
  const high = (words[last + 1]?.start ?? duration) - words[last]!.end
  const step = Math.max(low, Math.min(high, by))
  for (let i = first; i <= last; i++) {
    out[i]!.start = round(out[i]!.start + step)
    out[i]!.end = round(out[i]!.end + step)
  }
  return out
}

/** Piecewise affine fitting: confirmed internal onsets are fixed control points. */
export function fitSelection(words: TimingWord[], first: number, last: number, from: number, to: number, duration: number): TimingWord[] {
  const start = words[first]!.start,
    end = words[last]!.end
  if (words[first]!.anchor && Math.abs(from - start) > 0.0001) throw new Error('Release the first anchor before moving this endpoint.')
  const points = [
    {old: start, next: from},
    ...words
      .slice(first + 1, last + 1)
      .filter(w => w.anchor)
      .map(w => ({old: w.start, next: w.start})),
    {old: end, next: to},
  ]
  if (points.some((p, i) => i > 0 && p.next <= points[i - 1]!.next)) throw new Error('The endpoints must stay outside the confirmed anchors.')
  const map = (t: number) => {
    const n = Math.max(
      0,
      points.findIndex((p, i) => i < points.length - 1 && t <= points[i + 1]!.old),
    )
    const a = points[n]!,
      b = points[n + 1]!
    return round(a.next + ((t - a.old) / (b.old - a.old)) * (b.next - a.next))
  }
  const out = copy(words)
  for (let i = first; i <= last; i++) out[i] = {...out[i]!, start: map(out[i]!.start), end: map(out[i]!.end), estimated: true}
  validateWords(out, duration)
  return out
}

export function splitWord(words: TimingWord[], index: number, character: number, time: number): TimingWord[] {
  const w = words[index]!
  if (!Number.isInteger(character) || character <= 0 || character >= w.text.length || /\s/.test(w.text[character - 1]! + w.text[character]!))
    throw new Error('Choose a boundary inside the word.')
  if (time - w.start < MIN_WORD || w.end - time < MIN_WORD) throw new Error('Both parts need at least 0.05 seconds.')
  const right = {...w, text: w.text.slice(character), start: round(time), joined: true}
  delete right.anchor
  return [...copy(words.slice(0, index)), {...w, text: w.text.slice(0, character), end: round(time)}, right, ...copy(words.slice(index + 1))]
}

export function joinWords(words: TimingWord[], first: number, last: number): TimingWord[] {
  if (last <= first || words.slice(first + 1, last + 1).some(w => !w.joined))
    throw new Error('Only parts of the same source word can be joined. Group whole words instead.')
  const selected = words.slice(first, last + 1)
  const word = {...selected[0]!, text: selected.map(w => w.text).join(''), end: selected.at(-1)!.end}
  if (selected.some(w => w.estimated)) word.estimated = true
  return [...copy(words.slice(0, first)), word, ...copy(words.slice(last + 1))]
}

/** Onsets plus final offset; interior offsets are provisional, never claimed as measured silence. */
export function markWords(words: TimingWord[], marks: number[], duration: number): TimingWord[] {
  if (marks.length !== words.length + 1) throw new Error('Mark every word onset and the final word end.')
  const out = words.map((w, i) => ({...w, start: round(marks[i]!), end: round(marks[i + 1]!), anchor: true, estimated: true}))
  validateWords(out, duration)
  return out
}
