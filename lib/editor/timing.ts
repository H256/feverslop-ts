import {existsSync, readFileSync, renameSync, statSync, writeFileSync} from "node:fs";
import {isAbsolute, join, relative, resolve} from "node:path";
import type {ClipRequest} from "../compose.ts";
import {withProjectLock} from "../lock.ts";
import {MIN_WORD_SEC, slotVocals} from "../lyrics.ts";
import type {Project, TimedLine} from "../project.ts";
import {readClipRequests} from "../render-state.ts";
import type {EditorTarget} from "./project.ts";
import type {TimingWord, TimingLine, TimingView, TimingChange, TimingResult} from '../../shared/workspace.ts';
export type {TimingWord, TimingLine, TimingView, TimingChange, TimingResult} from '../../shared/workspace.ts';

// When the lyrics are sung, as the workspace shows and changes it: lyricsTiming in project.json, from the alignment with the
// transcript (step 2c). A line it barely found has times spread over the line only - a guess that can be seconds off. Moving
// words here keeps the cut of the song: every clip's vocals are worked out again from the new times (what step 10 does for
// them), and the beats whose clips sing something else lose their shot plan - the next plan run plans just those again.
// Cutting the song anew around the new times is --redo=timeline, and it plans every shot again: the page offers it apart.

/** Below this share of its words found in the transcript a line's times are a guess (lib/lyrics.ts lowConfidence). */
const ESTIMATED_BELOW = 0.5


const readJson = <T>(file: string): T | undefined => existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as T : undefined
const round = (t: number) => Math.round(t * 1000) / 1000

/** A sound file of the project, relative to it - only one inside it: the page is served nothing else. */
export function insideProject(dir: string, file: string | undefined) {
    if (!file) return undefined
    const path = relative(dir, resolve(dir, file.replace(/\\/g, '/'))).replace(/\\/g, '/')
    if (path.startsWith('..') || isAbsolute(path) || !existsSync(join(dir, path))) return undefined
    return {file: path, v: Math.round(statSync(join(dir, path)).mtimeMs)}
}

type Request = Pick<ClipRequest, 'id' | 'beatId'>

export function timingView(dir: string, data: Project, requests: Request[]): TimingView | undefined {
    const timing = data.lyricsTiming
    if (!timing) return undefined
    const beatOfSlot = new Map((data.mapping ?? []).map(m => [m.slotId, m.beatId]))
    const slots = data.timeline?.slots ?? []
    const beats = data.beats ?? []
    const planned = (id: string) => data.shotMoments?.[id] !== undefined
    return {
        duration: data.music?.durationSec ?? Math.max(0, ...timing.lines.map(l => l.end)),
        lines: timing.lines.map(l => ({
            line: l.line, section: l.section, text: l.text,
            words: l.words.map(w => ({text: w.text, start: w.start, end: w.end})),
            estimated: !l.byHand && l.confidence < ESTIMATED_BELOW,
            byHand: !!l.byHand,
            beats: [...new Set(slots.filter(s => s.vocals?.some(v => v.line === l.line)).map(s => beatOfSlot.get(s.id)).filter(b => b !== undefined))],
        })),
        cuts: slots.map(s => ({id: s.id, start: s.start, end: s.end, beat: beatOfSlot.get(s.id)})),
        beats: beats.map(b => ({id: b.id, planned: planned(b.id), clips: requests.filter(c => c.beatId === b.id).map(c => c.id)})),
        unplanned: data.shotMoments ? beats.filter(b => !planned(b.id)).map(b => b.id) : [],
        audio: insideProject(dir, data.stems?.vocals) ?? insideProject(dir, readJson<{ song?: string }>(join(dir, 'output', 'timeline.json'))?.song),
    }
}

/**
 * The new word times put into the project data, in place: lyricsTiming (the line's start and end follow its words, it
 * counts as placed by hand), every clip's vocals worked out again, and the shot plan dropped of every beat with a clip that
 * sings something else now. Throws on what cannot be: a line that is not there, another number of words, words out of
 * order or overlapping, shorter than MIN_WORD_SEC, outside the song.
 */
export function applyTiming(data: Project, change: TimingChange, requests: Request[]): TimingResult {
    const timing = data.lyricsTiming
    if (!timing) throw new Error('the lyrics have no timing in this project - "alignLyrics" is off, or the plan has not aligned them yet')
    if (!Array.isArray(change?.lines)) throw new Error('no lines')
    const duration = data.music?.durationSec ?? Infinity
    const result: TimingResult = {changed: [], slots: [], replanned: [], staleClips: [], crossing: []}
    const lines: TimedLine[] = timing.lines.map(l => ({...l, words: [...l.words]}))
    for (const entry of change.lines) {
        const line = lines.find(l => l.line === entry.line)
        if (!line) throw new Error(`no sung line ${entry.line}`)
        const name = `line ${entry.line + 1} ("${line.text}")`
        if (!Array.isArray(entry.words) || entry.words.length !== line.words.length) throw new Error(`${name} has ${line.words.length} words, not ${entry.words?.length}`)
        const words = entry.words.map((w, n) => ({text: line.words[n]!.text, start: round(Number(w.start)), end: round(Number(w.end))}))
        words.forEach((w, n) => {
            if (!Number.isFinite(w.start) || !Number.isFinite(w.end)) throw new Error(`${name}: "${w.text}" has no time`)
            if (w.end - w.start < MIN_WORD_SEC - 1e-9) throw new Error(`${name}: "${w.text}" is shorter than ${MIN_WORD_SEC} s`)
            if (w.start < 0 || w.end > duration + 1e-9) throw new Error(`${name}: "${w.text}" is outside the song`)
            if (n > 0 && w.start < words[n - 1]!.end - 1e-9) throw new Error(`${name}: "${w.text}" starts before "${words[n - 1]!.text}" ends`)
        })
        // given back as it was (bun run timing --set has every line): times are kept to the millisecond, so they are compared so
        const same = words.every((w, n) => w.start === round(line.words[n]!.start) && w.end === round(line.words[n]!.end))
        if (same) continue
        line.words = words
        line.start = words[0]!.start
        line.end = words.at(-1)!.end
        line.confidence = 1
        line.byHand = true
        result.changed.push(line.line)
    }
    if (!result.changed.length) return result
    data.lyricsTiming = {...timing, lines}

    // the cut stays: what each clip sings is worked out again, as step 10 does it
    const slots = data.timeline?.slots ?? []
    for (const slot of slots) {
        const vocals = slotVocals(slot, data.lyricsTiming)
        if (JSON.stringify(vocals) === JSON.stringify(slot.vocals ?? [])) continue
        slot.vocals = vocals
        result.slots.push(slot.id)
    }
    const beatOfSlot = new Map((data.mapping ?? []).map(m => [m.slotId, m.beatId]))
    const beats = new Set(result.slots.map(id => beatOfSlot.get(id)).filter(b => b !== undefined))
    for (const beatId of beats) {
        if (data.shotMoments?.[beatId] === undefined) continue
        delete data.shotMoments[beatId]
        delete data.partials?.shotMoments?.[beatId]
        result.replanned.push(beatId)
    }
    result.staleClips = requests.filter(c => beats.has(c.beatId)).map(c => c.id)
    // a cut inside a moved word: the word is sung half in one clip, half in the next
    const cutTimes = slots.slice(1).map(s => s.start)
    for (const line of lines.filter(l => result.changed.includes(l.line))) for (const w of line.words) {
        const cut = cutTimes.find(t => t > w.start + 0.02 && t < w.end - 0.02)
        if (cut !== undefined) result.crossing.push({line: line.line, word: w.text, cut})
    }
    return result
}

export async function readTiming(target: EditorTarget): Promise<TimingView | undefined> {
    const data = readJson<Project>(join(target.dir, 'project.json')) ?? {}
    return timingView(target.dir, data, await readClipRequests<ClipRequest>(target.dir))
}

export async function writeTiming(target: EditorTarget, change: TimingChange): Promise<TimingResult> {
    if (target.kind !== 'music') throw new Error('lyrics timing is for music videos')
    const requests = await readClipRequests<ClipRequest>(target.dir)
    return withProjectLock(target.dir, target.id, () => {
        const file = join(target.dir, 'project.json')
        const data = readJson<Project>(file)
        if (!data) throw new Error('no project.json yet - run the plan first')
        const result = applyTiming(data, change, requests)
        if (!result.changed.length) return result
        // next to it first, as the pipeline writes it: a crash mid-write never leaves half a project.json
        const partial = `${file}.${process.pid}.partial`
        writeFileSync(partial, JSON.stringify(data, null, 2))
        renameSync(partial, file)
        return result
    })
}
