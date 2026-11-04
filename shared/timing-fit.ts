/**
 * Whether the first word of a line starts where the singing does (#578). The alignment often gives the first word after a pause the
 * time the pause began: its box then covers silence, up to a second, and the line looks late or the word long. Measured on the loudness
 * the page has, 100 values a second. On the projects of this repository the lines moved by hand have 0 to 0.03 s of silence at the start
 * of their first word, the ones seen to be early 0.3 to 0.9 s; the end of a line and the words inside it have none worth speaking of
 * (a note dies away, a word has its consonants), so only the start is measured.
 */
export const RATE = 100
/** Below this, of the loudest moment of the whole song, is the stem's own noise. */
const FLOOR = 0.03
/** Sound is more than this of what is sung around the line... */
const RELATIVE = 0.12
/** ...for at least this many values in a row (0.03 s): a click is none. */
const SOUND_BINS = 3
/** How far around the line what is sung there is looked at, in seconds. */
const AROUND = 3

/** From where on a start is early enough to say so, in seconds. */
export const EARLY_FROM = 0.15

/** Where there is sound in a stretch of the loudness: a flag per value. */
function soundIn(peaks: number[], from: number, to: number): boolean[] {
  const values = peaks.slice(from, to)
  const sorted = [...values].sort((a, b) => a - b)
  const level = Math.max(FLOOR, RELATIVE * (sorted[Math.floor(sorted.length * 0.9)] ?? 0))
  const loud = values.map(v => v > level)
  for (let i = 0; i < loud.length;) {
    if (!loud[i]) { i++; continue }
    let end = i
    while (end < loud.length && loud[end]) end++
    if (end - i < SOUND_BINS) for (let k = i; k < end; k++) loud[k] = false
    i = end
  }
  return loud
}

/**
 * How long the first word of a line starts before its sound, in seconds - 0 where it starts on it. `words` are the times of the line;
 * a word with no sound in it at all is silent as a whole.
 */
export function leadOf(words: {start: number, end: number}[], peaks: number[]): number {
  if (!words.length || !peaks.length) return 0
  const bin = (t: number) => Math.max(0, Math.min(peaks.length, Math.round(t * RATE)))
  const first = words[0]!, last = words.at(-1)!
  const from = bin(first.start - AROUND)
  const sound = soundIn(peaks, from, bin(last.end + AROUND))
  const start = bin(first.start), end = Math.max(start, bin(first.end))
  let at = start
  while (at < end && sound[at - from] !== true) at++
  return (at - start) / RATE
}
