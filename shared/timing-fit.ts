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
        if (!loud[i]) {
            i++
            continue
        }
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
export function leadOf(words: {start: number; end: number}[], peaks: number[]): number {
    if (!words.length || !peaks.length) return 0
    const bin = (t: number) => Math.max(0, Math.min(peaks.length, Math.round(t * RATE)))
    const first = words[0]!,
        last = words.at(-1)!
    const from = bin(first.start - AROUND)
    const sound = soundIn(peaks, from, bin(last.end + AROUND))
    const start = bin(first.start),
        end = Math.max(start, bin(first.end))
    let at = start
    while (at < end && sound[at - from] !== true) at++
    return (at - start) / RATE
}

/** A gap in the sound shorter than this (0.15 s) still belongs to the same singing: a consonant, a breath between two words. */
/**
 * Singing heard at least this long before a line's first word is a word the timing lost, not the onset of the word itself: lines placed
 * by hand on schwarzer-flur have 0.3 to 0.4 s of a soft onset ("Sch-") before their first word, the line that lost "Die" 0.6 s. Shorter
 * leads are left as the timing has them.
 */
export const MISSING_WORD_LEAD = 0.5
const GAP_BINS = 15

/**
 * How long before the first word of a line its singing is already heard, in seconds - 0 where nothing is: the sound running into the
 * first word without a real pause, looked for back to `notBefore` (seconds of the song, e.g. the cut or the end of the line before). The
 * sign of a word the timing lost (#738: "Die ich in mir verberg" timed from "ich" on, sung from 0.7 s before it) - so a shot does not
 * forbid the lip-sync while the words are already heard. The timing itself is left as it is.
 */
export function voiceLead(words: {start: number; end: number}[], peaks: number[], notBefore: number): number {
    if (!words.length || !peaks.length) return 0
    const bin = (t: number) => Math.max(0, Math.min(peaks.length, Math.round(t * RATE)))
    const first = words[0]!
    const from = bin(Math.max(notBefore, first.start - AROUND))
    const start = bin(first.start)
    if (start <= from) return 0
    const sound = soundIn(peaks, from, bin(words.at(-1)!.end))
    let at = start,
        silent = 0
    for (let k = start - 1; k >= from; k--) {
        if (sound[k - from]) {
            at = k
            silent = 0
        } else if (++silent > GAP_BINS) break
    }
    return (start - at) / RATE
}

/** A new attack must come out of a level this much lower than itself (a held vowel that goes on is none)... */
const ATTACK_FROM_LOW = 1.8
/** ...and rise by this much of what is sung around: a dip and a new syllable, or the sound after a pause. */
const ATTACK_RISE = 0.18
/** A new sound must itself be at least this much of what is sung around: the little bumps between words are noise, not syllables. */
const ATTACK_LEVEL = 0.22
/** The level is looked at this many values before, and this many after (0.08 s back, 0.03 s on). */
const BEFORE_BINS = 8
const AHEAD_BINS = 3
/** After an attack the next one is not looked for within this many values (0.12 s): one syllable has one. */
const REFRACTORY_BINS = 12

/**
 * Where a new sound starts between two times of the song, in seconds: after a pause, or after a dip in a held vowel (the next
 * word taking up the note). Where a word of the timing can start - the stops for dragging a boundary between two lines, so it
 * lands on what is heard and not on a guess. A hint to snap to, not a measurement of any word: a held note has none inside it.
 */
export function onsetsIn(peaks: number[], from: number, to: number): number[] {
    if (!peaks.length) return []
    const bin = (t: number) => Math.max(0, Math.min(peaks.length, Math.round(t * RATE)))
    const a = Math.max(0, bin(from) - BEFORE_BINS),
        b = bin(to)
    const window = peaks.slice(a, b)
    if (window.length < BEFORE_BINS + AHEAD_BINS + 1) return []
    const sorted = [...window].sort((x, y) => x - y)
    const around = Math.max(FLOOR, sorted[Math.floor(sorted.length * 0.9)] ?? 0)
    const env = window.map((_, i) => {
        const part = window.slice(Math.max(0, i - 1), i + 2)
        return part.reduce((sum, v) => sum + v, 0) / part.length
    })
    const out: number[] = []
    let skip = 0
    for (let i = BEFORE_BINS; i < env.length - AHEAD_BINS; i++) {
        if (skip > 0) {
            skip--
            continue
        }
        const low = Math.min(...env.slice(i - BEFORE_BINS, i))
        const high = env[i + AHEAD_BINS]!
        if (high < ATTACK_LEVEL * around || high - low < ATTACK_RISE * around || high < ATTACK_FROM_LOW * low) continue
        // the start of the rise, not its top: back to where the level was still the low one
        let start = i
        while (start > BEFORE_BINS && env[start - 1]! > low + (high - low) * 0.25) start--
        const t = (a + start) / RATE
        if (t >= from && t <= to) out.push(t)
        skip = REFRACTORY_BINS
    }
    return out
}
