import {vocalText} from './lyrics.ts';
import type {LyricsTiming, Singing, TimedWord} from "./project.ts";

// A singer can change within a line: a line of `singing` then has parts, each from a word of the line on (the index into
// lyricsTiming's words of that line) with its own singers. The line's `singers` stay the singers of all its parts, so
// whatever asks who sings a line at all (the beats, the singers of a section) reads it as before. Where the change falls
// in a clip comes from the words' times: a word is sung by the part it starts in - the boundary lies halfway between the
// last word of one part and the first of the next, so a word time off by a frame does not move it into the other part.

export type SingingPart = { from: number, singers: string[] }
export type SingingLine = Singing['lines'][number]

const sameSingers = (a: string[], b: string[]) => a.length === b.length && a.every(id => b.includes(id))

/**
 * Parts as they are kept: sorted, inside the line's words, starting at word 0, each with singers, neighbours with the same
 * singers merged - undefined when that leaves a single part (the line is then sung by its `singers` as a whole).
 */
export function normalizeParts(parts: SingingPart[] | undefined, wordCount: number): SingingPart[] | undefined {
    if (!parts?.length || wordCount < 2) return undefined
    const sorted = [...parts]
        .filter(p => Number.isInteger(p.from) && p.from >= 0 && p.from < wordCount && p.singers.length)
        .map(p => ({from: p.from, singers: [...new Set(p.singers)]}))
        .sort((a, b) => a.from - b.from)
    const merged: SingingPart[] = []
    for (const part of sorted) {
        const before = merged.at(-1)
        if (before?.from === part.from) before.singers = part.singers            // two parts from one word: the later one counts
        else if (before && sameSingers(before.singers, part.singers)) continue
        else merged.push(part)
    }
    if (!merged.length) return undefined
    merged[0]!.from = 0
    return merged.length > 1 ? merged : undefined
}

/** The singers of a line with parts: all of theirs, in the order they first sing. */
export const singersOfParts = (parts: SingingPart[]) => [...new Set(parts.flatMap(p => p.singers))]

/** Song seconds where each part starts - the first one at minus infinity; undefined without parts or word times. */
function boundaries(line: SingingLine, timing: LyricsTiming | undefined): number[] | undefined {
    if (!line.parts?.length) return undefined
    const words = timing?.lines.find(l => l.line === line.line)?.words
    if (!words?.length) return undefined
    return line.parts.map((part, k) => {
        if (k === 0) return -Infinity
        const word = words[Math.min(part.from, words.length - 1)]!
        const before = words[part.from - 1]
        return before ? (before.end + word.start) / 2 : word.start
    })
}

/**
 * A sung piece of a line in a clip (times relative to `origin`, in song seconds), split where its singer changes: one
 * piece per part it reaches, each with the part's singers. A line without parts is one piece with the line's singers.
 */
export function splitBySinger<V extends { start: number, end: number, text: string, words: TimedWord[] }>(
    vocal: V, origin: number, line: SingingLine | undefined, timing: LyricsTiming | undefined, fallback: string[],
): (V & { singers: string[] })[] {
    const whole = [{...vocal, singers: line?.singers ?? fallback}]
    const starts = line && boundaries(line, timing)
    if (!line?.parts || !starts || !vocal.words.length) return whole
    const partOf = (w: TimedWord) => {
        const at = origin + w.start
        let k = 0
        while (k + 1 < starts.length && starts[k + 1]! <= at) k++
        return k
    }
    const pieces: (V & { singers: string[] })[] = []
    let current: { k: number, words: TimedWord[] } | undefined
    const close = () => {
        if (!current) return
        const words = current.words
        pieces.push({...vocal, text: vocalText(words, words.at(-1) === vocal.words.at(-1) && vocal.text === vocalText(vocal.words) + '-', words[0] === vocal.words[0] && !!words[0]?.joined), start: words[0]!.start, end: words.at(-1)!.end, words, singers: line.parts![current.k]!.singers})
    }
    for (const w of vocal.words) {
        const k = partOf(w)
        if (current?.k !== k) {
            close()
            current = {k, words: []}
        }
        current.words.push(w)
    }
    close()
    return pieces
}
