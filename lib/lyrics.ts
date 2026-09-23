import type {LyricSection, LyricsTiming, MusicMap, MusicSection, Slot, SlotVocal, TimedLine, TimedWord, TranscriptWord} from "./project.ts";

export type ActivityRange = { start: number, end: number }
import {frameAt, secondsAt} from "./frames.ts";

// Aligns the known lyrics to Whisper's transcript of the vocals stem - plain code, deterministic.

const MATCH_SIMILARITY = 0.7    // words match from this normalized Levenshtein similarity on
const SKIP_LYRIC = -0.4         // a lyric word Whisper didn't hear
const SKIP_HEARD = -0.3         // a word Whisper heard that isn't in the lyrics (ad-lib, hallucination)
const TYPICAL_WORD_SEC = 0.45   // length of a word that has to be interpolated
const SECTION_SLACK_SEC = 8     // how far a matched word may lie outside its estimated section without a penalty

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
    const transcript = heard.map(w => ({...w, norm: normalizeWord(w.text)})).filter(w => w.norm)
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

    let k = 0
    return {
        lines: lines.map(line => {
            const words = timed.slice(k, k += line.words.length)
            return {
                line: line.line,
                sectionIndex: line.sectionIndex,
                section: line.section,
                text: line.text,
                start: words[0]!.start,
                end: words.at(-1)!.end,
                words: words.map(({text, start, end}) => ({text, start, end})),
                confidence: round(words.reduce((sum, w) => sum + w.sim, 0) / words.length),
            }
        }),
    }
}

/**
 * Times for the unmatched words, in place. A run of unmatched words between two matched ones is split: the
 * words of the previous matched word's section follow it, the rest lead up to the next matched word - so an
 * unheard line before an instrumental gap doesn't get stretched over the whole gap. When `activity` covers part
 * of that gap, the words are further narrowed to the loudest overlapping range instead of spread across the gap.
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
        let lo = prev !== undefined ? words[prev]!.end : Math.max(0, words[next!]!.start - count * TYPICAL_WORD_SEC)
        let hi = next !== undefined ? words[next]!.start : lo + count * TYPICAL_WORD_SEC
        if (activity?.length) [lo, hi] = clampToActivity(lo, hi, activity, count)
        const per = Math.max(0, Math.min(TYPICAL_WORD_SEC, (hi - lo) / count))

        let split = a
        if (next === undefined) split = b + 1
        else if (prev !== undefined) while (split <= b && sectionOf[split] === sectionOf[prev]) split++
        for (let i = a; i < split; i++) Object.assign(words[i]!, {start: round(lo + (i - a) * per), end: round(lo + (i - a + 1) * per)})
        for (let i = split; i <= b; i++) Object.assign(words[i]!, {start: round(hi - (b + 1 - i) * per), end: round(hi - (b - i) * per)})
        a = b
    }
}

// Narrows [lo, hi] to the activity range it overlaps most, when that leaves enough room for `count` words -
// a too-narrow overlap is discarded rather than stacking every word on top of each other
function clampToActivity(lo: number, hi: number, activity: ActivityRange[], count: number): [number, number] {
    let best: ActivityRange | undefined
    let bestOverlap = 0
    for (const range of activity) {
        const overlap = Math.min(hi, range.end) - Math.max(lo, range.start)
        if (overlap > bestOverlap) {
            bestOverlap = overlap
            best = range
        }
    }
    if (!best) return [lo, hi]
    const clampedLo = Math.max(lo, best.start)
    const clampedHi = Math.min(hi, best.end)
    return clampedHi - clampedLo >= count * 0.15 ? [clampedLo, clampedHi] : [lo, hi]
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
    const vocalStart = estimated.map((_, i) => {
        const first = linesOf(i)[0]
        return first ? snapDown(first.start) : undefined
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
        const words = line.words.filter(w => frameAt(w.start) >= first && frameAt(w.start) < last).map(relative)
        return words.length
            ? [{line: line.line, text: words.map(w => w.text).join(' '), start: words[0]!.start, end: words.at(-1)!.end, words}]
            : []
    })
}

// lines worth a look by hand
export const lowConfidence = (timing: LyricsTiming, below = 0.5): TimedLine[] => timing.lines.filter(l => l.confidence < below)

const round = (n: number) => Math.round(n * 1000) / 1000
