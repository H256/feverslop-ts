import type {LyricSection, LyricsTiming, MusicMap, MusicSection, Slot, SlotVocal, TimedLine, TimedWord, TranscriptWord} from "./project.ts";

export type ActivityRange = { start: number, end: number }
import {frameAt, round, secondsAt} from "./frames.ts";

// Aligns the known lyrics to Whisper's transcript of the vocals stem - plain code, deterministic.

const MATCH_SIMILARITY = 0.7    // words match from this normalized Levenshtein similarity on
const SKIP_LYRIC = -0.4         // a lyric word Whisper didn't hear
const SKIP_HEARD = -0.3         // a word Whisper heard that isn't in the lyrics (ad-lib, hallucination)
const TYPICAL_WORD_SEC = 0.45   // length of a word that has to be interpolated
const SECTION_SLACK_SEC = 8     // how far a matched word may lie outside its estimated section without a penalty
const LOOP_WORDS = 3            // this many words in a row on (nearly) one timestamp are a whisper repeat-loop, not singing
const LOOP_SPREAD_SEC = 0.1
const ADLIB_GAP_SEC = 1.2       // heard words further apart than this belong to different ad-lib lines
const ADLIB_MIN_WORDS = 2
const ADLIB_MIN_ACTIVE = 0.5    // share of an ad-lib line that has to lie inside vocal activity
const ADLIB_SURE = 0.7          // ... or whisper is this sure of the words (quiet backing vocals stay under the activity threshold)
const ADLIB_MIN_WORD_PROBABILITY = 0.3
const GUESS_MIN_ACTIVE = 0.4    // share of a guessed (never heard) word that has to lie inside vocal activity - else nobody sings it
const ADLIB_REPLACES_BELOW = 0.5 // a lyric line that was mostly not heard gives way to ad-libs sung over it
const MIN_WORD_SEC = 0.05       // shorter than this is a word without a real position - nobody can lip-sync it

export type SungLine = { line: number, sectionIndex: number, section: string, text: string, words: string[] }

/**
 * The sung lines of the lyrics, numbered in song order - lines that are only a performance note like
 * "(Drums build rapidly)" are not sung, notes inside a line are dropped.
 */
export function sungLines(lyricSections: LyricSection[]): SungLine[] {
    const lines: SungLine[] = []
    lyricSections.forEach((section, sectionIndex) => {
        for (const raw of section.lines) {
            const text = raw.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
            const words = text.split(' ').filter(w => normalizeWord(w))
            if (words.length) lines.push({line: lines.length, sectionIndex, section: section.label, text, words})
        }
    })
    return lines
}

// "Dragon's," -> "dragons", "Über" -> "uber"
export function normalizeWord(word: string) {
    return word.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]/gu, '')
}

// 1 - Levenshtein distance / length of the longer word
export function similarity(a: string, b: string) {
    if (a === b) return 1
    if (!a || !b) return 0
    let previous = Array.from({length: b.length + 1}, (_, j) => j)
    for (let i = 1; i <= a.length; i++) {
        const row = [i]
        for (let j = 1; j <= b.length; j++) {
            row[j] = Math.min(previous[j]! + 1, row[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
        }
        previous = row
    }
    return 1 - previous[b.length]! / Math.max(a.length, b.length)
}

/**
 * Start and end of every sung line and word. The lyric words are aligned to the transcript words in order
 * (Needleman-Wunsch), a pair matches when the words are similar enough. Lyric words Whisper didn't hear get
 * interpolated times between their matched neighbours, grounded in `activity` (RMS vocal-activity ranges from the
 * audio, independent of whisper) when given - growled/screamed vocals whisper can't transcribe still show up
 * there, so an unheard word lands inside a real singing window instead of spread blindly across a whole gap.
 * `sections` (the estimate from the audio) is optional and only breaks ties - e.g. which of three identical
 * choruses a heard chorus belongs to.
 */
export function alignLyrics(lyricSections: LyricSection[], heard: TranscriptWord[], sections?: MusicSection[], activity?: ActivityRange[]): LyricsTiming {
    const lines = sungLines(lyricSections)
    const lyric = lines.flatMap(line => line.words.map(text => ({text, norm: normalizeWord(text), line: line.line, sectionIndex: line.sectionIndex})))
    const transcript = clampToActivity(dropLoops(heard), activity).map(w => ({...w, norm: normalizeWord(w.text)})).filter(w => w.norm)
    const n = lyric.length
    const m = transcript.length
    if (n === 0) return {lines: []}

    const matchScore = (i: number, j: number) => {
        const sim = similarity(lyric[i]!.norm, transcript[j]!.norm)
        if (sim < MATCH_SIMILARITY) return -Infinity
        const section = sections?.[lyric[i]!.sectionIndex]
        const time = transcript[j]!.start
        const outside = section ? Math.max(0, section.start - SECTION_SLACK_SEC - time, time - section.end - SECTION_SLACK_SEC) : 0
        return 1 + sim - Math.min(0.8, outside / 20)
    }

    // score[i][j]: best alignment of lyric[0..i) with transcript[0..j); move: 0 = match, 1 = skip lyric, 2 = skip heard
    const width = m + 1
    const score = new Float64Array((n + 1) * width)
    const move = new Uint8Array((n + 1) * width)
    for (let i = 1; i <= n; i++) {
        score[i * width] = i * SKIP_LYRIC
        move[i * width] = 1
    }
    for (let j = 1; j <= m; j++) {
        score[j] = j * SKIP_HEARD
        move[j] = 2
    }
    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            const match = score[(i - 1) * width + j - 1]! + matchScore(i - 1, j - 1)
            const skipLyric = score[(i - 1) * width + j]! + SKIP_LYRIC
            const skipHeard = score[i * width + j - 1]! + SKIP_HEARD
            const best = Math.max(match, skipLyric, skipHeard)
            score[i * width + j] = best
            move[i * width + j] = best === match ? 0 : best === skipLyric ? 1 : 2
        }
    }

    // lyric word -> matched transcript word
    const matchOf = new Array<number | undefined>(n)
    for (let i = n, j = m; i > 0 || j > 0;) {
        const step = move[i * width + j]
        if (step === 0) matchOf[--i] = --j
        else if (step === 1) i--
        else j--
    }
    // a line whose only matches are short words ("the", "in") most likely matched stray words - trust none of them
    for (const line of lines) {
        const own = lyric.flatMap((w, i) => w.line === line.line && matchOf[i] !== undefined ? [i] : [])
        if (own.every(i => lyric[i]!.norm.length <= 3)) for (const i of own) matchOf[i] = undefined
    }

    const timed: (TimedWord & { sim: number })[] = lyric.map((word, i) => {
        const j = matchOf[i]
        return j === undefined
            ? {text: word.text, start: NaN, end: NaN, sim: 0}
            : {text: word.text, start: transcript[j]!.start, end: transcript[j]!.end, sim: similarity(word.norm, transcript[j]!.norm)}
    })
    if (timed.every(w => w.sim === 0)) throw new Error('None of the lyrics were found in the transcript - is lyricsLanguage right, and are there vocals in the song?')
    interpolate(timed, lyric.map(w => w.sectionIndex), activity)

    // a word whisper never heard was placed by guesswork: where the vocal stem is silent nobody sings it, and a mouth
    // moving without sound is worse than a missing word
    const sungAt = (w: { start: number, end: number }) => {
        if (!activity?.length) return true
        const covered = activity.reduce((sum, r) => sum + Math.max(0, Math.min(w.end, r.end) - Math.max(w.start, r.start)), 0)
        return w.end > w.start && covered >= GUESS_MIN_ACTIVE * (w.end - w.start)
    }
    let k = 0
    const timedLines: TimedLine[] = lines.map(line => {
        const words = timed.slice(k, k += line.words.length)
        return {
            line: line.line,
            sectionIndex: line.sectionIndex,
            section: line.section,
            text: line.text,
            start: words[0]!.start,
            end: words.at(-1)!.end,
            words: words.filter(w => w.sim > 0 || sungAt(w)).map(({text, start, end}) => ({text, start, end})),
            confidence: round(words.reduce((sum, w) => sum + w.sim, 0) / words.length),
        }
    })

    const matched = new Set(matchOf.filter(j => j !== undefined))
    const adlibs = adlibLines(transcript.flatMap((w, j) => matched.has(j) ? [] : [w]), new Set(lyric.map(w => w.norm)), activity)
    if (!adlibs.length) return {lines: timedLines}

    // a lyric line that was mostly not heard, with ad-libs sung where its words were guessed, is a wrong guess - it
    // keeps no words (two lines can't be sung at once)
    const overlapsAdlib = (line: TimedLine) => adlibs.some(a => Math.min(line.end, a.end) - Math.max(line.start, a.start) > 0.15 || (line.end <= line.start && line.start >= a.start && line.start <= a.end))
    for (const line of timedLines) if (line.confidence < ADLIB_REPLACES_BELOW && overlapsAdlib(line)) line.words = []

    // each ad-lib line goes right behind the heard lyric line before it, numbered after the lyric lines
    const out = [...timedLines]
    adlibs.forEach((adlib, n) => {
        const before = out.findLastIndex(l => l.confidence > 0 && l.words.length > 0 && l.start <= adlib.start)
        const anchor = out[before] ?? out[0]!
        out.splice(before + 1, 0, {...adlib, line: lines.length + n, sectionIndex: anchor.sectionIndex, section: anchor.section})
    })
    return {lines: out}
}

/**
 * Whisper sometimes loops on a hard stretch and writes the same words over and over on one timestamp. Such a stack
 * carries no timing at all and drags matching lyric lines to its timestamp - the stack is dropped.
 */
export function dropLoops(words: TranscriptWord[]): TranscriptWord[] {
    const kept: TranscriptWord[] = []
    for (let i = 0; i < words.length;) {
        let j = i + 1
        while (j < words.length && Math.abs(words[j]!.start - words[i]!.start) <= LOOP_SPREAD_SEC) j++
        if (j - i < LOOP_WORDS) kept.push(...words.slice(i, j))
        i = j
    }
    return kept
}

/**
 * Whisper stretches a word over the pause after it (a lone "Wo" before a break lasting 4 s) - a word ends when the
 * vocal activity it starts in ends.
 */
export function clampToActivity(words: TranscriptWord[], activity?: ActivityRange[]): TranscriptWord[] {
    if (!activity?.length) return words
    return words.map(w => {
        const range = activity.find(r => w.start >= r.start - 0.15 && w.start < r.end)
        return range && w.end > range.end + 0.3 ? {...w, end: Math.max(w.start + MIN_WORD_SEC, range.end)} : w
    })
}

/**
 * The words whisper heard that match no lyric word - a singer repeating the hook longer than lyrics.txt says, adlibs.
 * They are real singing when they sound like the song's own words and sit in vocal activity (whisper's other
 * inventions like "AAAAAAAA" fail the first test), so they become lines of their own that the singer lip-syncs.
 */
function adlibLines(unmatched: (TranscriptWord & { norm: string })[], vocabulary: Set<string>, activity?: ActivityRange[]): TimedLine[] {
    const real = unmatched.filter(w => w.end > w.start && w.probability >= ADLIB_MIN_WORD_PROBABILITY && [...vocabulary].some(v => similarity(v, w.norm) >= MATCH_SIMILARITY))
    const groups: (typeof real)[] = []
    for (const word of real) {
        const group = groups.at(-1)
        if (group && word.start - group.at(-1)!.end <= ADLIB_GAP_SEC) group.push(word)
        else groups.push([word])
    }
    return groups.filter(g => g.length >= ADLIB_MIN_WORDS).flatMap(group => {
        const start = group[0]!.start
        const end = group.at(-1)!.end
        const sure = group.length >= 3 && group.reduce((sum, w) => sum + w.probability, 0) / group.length >= ADLIB_SURE
        if (activity?.length && !sure) {
            const active = activity.reduce((sum, r) => sum + Math.max(0, Math.min(end, r.end) - Math.max(start, r.start)), 0)
            if (active / (end - start) < ADLIB_MIN_ACTIVE) return []
        }
        return [{
            line: -1,
            sectionIndex: -1,
            section: '',
            text: group.map(w => w.text).join(' '),
            start,
            end,
            words: group.map(({text, start, end}) => ({text, start, end})),
            confidence: round(group.reduce((sum, w) => sum + w.probability, 0) / group.length),
            adlib: true,
        }]
    })
}

/**
 * Times for the unmatched words, in place. When `activity` covers enough of the gap between the two matched
 * neighbours, the run is spread proportionally across every real activity range in that gap (see
 * `spreadOverActivity`) - grounded in actual singing/screaming, not guesswork. Otherwise it falls back to a
 * blind split: the words of the previous matched word's section follow it, the rest lead up to the next
 * matched word - so an unheard line before an instrumental gap doesn't get stretched over the whole gap.
 */
function interpolate(words: TimedWord[], sectionOf: number[], activity?: ActivityRange[]) {
    const known = (i: number) => !Number.isNaN(words[i]!.start)
    for (let a = 0; a < words.length; a++) {
        if (known(a)) continue
        let b = a
        while (b + 1 < words.length && !known(b + 1)) b++
        const count = b - a + 1
        const prev = a > 0 ? a - 1 : undefined
        const next = b + 1 < words.length ? b + 1 : undefined
        const lo = prev !== undefined ? words[prev]!.end : Math.max(0, words[next!]!.start - count * TYPICAL_WORD_SEC)
        const hi = next !== undefined ? words[next]!.start : lo + count * TYPICAL_WORD_SEC

        const spread = activity?.length ? spreadOverActivity(lo, hi, count, activity) : undefined
        if (spread) {
            for (let i = a; i <= b; i++) Object.assign(words[i]!, spread[i - a])
            a = b
            continue
        }

        const per = Math.max(0, Math.min(TYPICAL_WORD_SEC, (hi - lo) / count))
        let split = a
        if (next === undefined) split = b + 1
        else if (prev !== undefined) while (split <= b && sectionOf[split] === sectionOf[prev]) split++
        for (let i = a; i < split; i++) Object.assign(words[i]!, {start: round(lo + (i - a) * per), end: round(lo + (i - a + 1) * per)})
        for (let i = split; i <= b; i++) Object.assign(words[i]!, {start: round(hi - (b + 1 - i) * per), end: round(hi - (b - i) * per)})
        a = b
    }
}

// Spreads `count` words proportionally (by duration) across every activity range that overlaps [lo, hi] - a
// gap can straddle several separate sung/screamed bursts, and packing every word into just the loudest one
// (the old behaviour) silently ignored the rest. Falls back to undefined (blind spread) when the real overlap
// is too thin to place `count` words in without stacking them on top of each other.
function spreadOverActivity(lo: number, hi: number, count: number, activity: ActivityRange[]): { start: number, end: number }[] | undefined {
    const segments = activity
        .map(r => ({start: Math.max(lo, r.start), end: Math.min(hi, r.end)}))
        .filter(r => r.end > r.start)
    const total = segments.reduce((sum, s) => sum + (s.end - s.start), 0)
    if (!segments.length || total < count * 0.15) return undefined

    // words per segment, proportional to its share of the covered duration - largest fractional remainder
    // first, so the per-segment counts always add up to exactly `count`
    const raw = segments.map(s => count * (s.end - s.start) / total)
    const counts = raw.map(Math.floor)
    let remaining = count - counts.reduce((a, b) => a + b, 0)
    for (const [, i] of raw.map((r, i) => [r - counts[i]!, i] as const).sort((a, b) => b[0] - a[0])) {
        if (remaining <= 0) break
        counts[i]!++
        remaining--
    }

    const words: { start: number, end: number }[] = []
    segments.forEach((seg, i) => {
        const n = counts[i]!
        if (!n) return
        const per = Math.min(TYPICAL_WORD_SEC, (seg.end - seg.start) / n)
        for (let w = 0; w < n; w++) words.push({start: round(seg.start + w * per), end: round(seg.start + (w + 1) * per)})
    })
    return words.length === count ? words : undefined
}

/**
 * Real section boundaries from the sung lines: a section with vocals starts at its first line, snapped back to the
 * downbeat before it (for pickups). Sections without vocals (Intro, Guitar Solo, ...) keep their estimated start,
 * moved into the gap between the vocals around them.
 */
export function refineSections(music: MusicMap, lyricSections: LyricSection[], timing: LyricsTiming): MusicSection[] {
    const estimated = music.sections
    if (estimated.length !== lyricSections.length) return estimated
    const barSec = 240 / music.bpm
    const downbeats = music.downbeats
    const tolerance = 0.15
    const snapDown = (t: number) => {
        const d = downbeats.findLast(d => d <= t + tolerance)
        return d !== undefined && t - d <= barSec + tolerance ? d : t
    }
    const snapUp = (t: number) => downbeats.find(d => d >= t - tolerance) ?? music.durationSec

    const linesOf = (i: number) => timing.lines.filter(l => l.sectionIndex === i)
    // a first line with confidence 0 was never actually heard - it's fully interpolated, spread across
    // whatever activity happened to overlap a (possibly huge) gap between real matches elsewhere in the song,
    // and isn't grounded enough to anchor where the section itself starts - the acoustic estimate is safer
    const vocalStart = estimated.map((_, i) => {
        const first = linesOf(i)[0]
        return first && first.confidence > 0 ? snapDown(first.start) : undefined
    })

    const starts: number[] = []
    estimated.forEach((section, i) => {
        let start: number
        if (i === 0) start = 0
        else if (vocalStart[i] !== undefined) start = vocalStart[i]!
        else {
            const sungBefore = timing.lines.filter(l => l.sectionIndex < i).at(-1)
            const lower = sungBefore ? snapUp(sungBefore.end) : 0
            const upper = vocalStart.slice(i + 1).find(t => t !== undefined) ?? music.durationSec
            // an estimate outside the gap is wrong - the section then starts right after the vocals before it
            start = section.start >= lower && section.start <= upper - barSec ? section.start : lower
        }
        // at least a bar per section
        const previous = starts.at(-1)
        if (previous !== undefined && start < previous + barSec - tolerance) start = snapUp(previous + barSec)
        starts.push(Math.min(start, music.durationSec))
    })

    return estimated.map((section, i) => {
        const start = starts[i]!
        const end = starts[i + 1] ?? music.durationSec
        const energies = downbeats.map((t, b) => ({t, e: music.barEnergy[b] ?? 0})).filter(b => b.t >= start - 0.05 && b.t < end - 0.05).map(b => b.e)
        return {
            label: section.label,
            start: round(start),
            end: round(end),
            energy: energies.length ? round(energies.reduce((a, b) => a + b, 0) / energies.length) : section.energy,
        }
    })
}

/**
 * The words sung inside a clip, grouped per line. A word belongs to the clip whose frames contain its start
 * (lib/frames.ts), times are relative to the clip's first frame.
 */
export function slotVocals(slot: Pick<Slot, 'start' | 'end'>, timing: LyricsTiming): SlotVocal[] {
    const first = frameAt(slot.start)
    const last = frameAt(slot.end)
    const origin = secondsAt(first)
    const relative = (w: TimedWord) => ({text: w.text, start: round(w.start - origin), end: round(w.end - origin)})

    return timing.lines.flatMap(line => {
        const words = line.words.filter(w => w.end - w.start >= MIN_WORD_SEC && frameAt(w.start) >= first && frameAt(w.start) < last).map(relative)
        return words.length
            ? [{line: line.line, text: words.map(w => w.text).join(' '), start: words[0]!.start, end: words.at(-1)!.end, words}]
            : []
    })
}

// lines worth a look by hand
export const lowConfidence = (timing: LyricsTiming, below = 0.5): TimedLine[] => timing.lines.filter(l => l.confidence < below)
