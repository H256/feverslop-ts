import {existsSync, readFileSync, statSync} from "node:fs";
import {writeJsonFile} from "../json-file.ts";
import {isAbsolute, join, relative, resolve} from "node:path";
import type {ClipRequest} from "../compose.ts";
import {splitBySinger} from '../singing-parts.ts';
import {withProjectLock} from "../lock.ts";
import {MIN_WORD_SEC, normalizeWord, slotVocals} from "../lyrics.ts";
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

/** How long each word of a line without words is laid out, to be dragged where it is sung. */
const UNPLACED_WORD_SEC = 0.4

/**
 * The words of a line as the page moves them. A line the alignment found sung nowhere keeps no words (lib/lyrics.ts) and has
 * no length - nothing to see or drag: its words are laid out one after the other from where it would start. Given back
 * unmoved they are not saved, so the line stays as it was.
 */
export function wordsToPlace(line: TimedLine, duration: number): TimedLine['words'] {
    if (line.words.length) return line.words
    const texts = line.text.split(' ').filter(w => normalizeWord(w))
    const start = Math.max(0, Math.min(line.start, duration - texts.length * UNPLACED_WORD_SEC))
    return texts.map((text, n) => ({text, start: round(start + n * UNPLACED_WORD_SEC), end: round(start + (n + 1) * UNPLACED_WORD_SEC)}))
}

/** A sound file of the project, relative to it - only one inside it: the page is served nothing else. */
export function insideProject(dir: string, file: string | undefined) {
    if (!file) return undefined
    const path = relative(dir, resolve(dir, file.replace(/\\/g, '/'))).replace(/\\/g, '/')
    if (path.startsWith('..') || isAbsolute(path) || !existsSync(join(dir, path))) return undefined
    return {file: path, v: Math.round(statSync(join(dir, path)).mtimeMs)}
}

type Request = Pick<ClipRequest, 'id' | 'beatId'> & Partial<Pick<ClipRequest, 'vocals'>>

/** A clip's request is made from the vocals of its slot; times differ by a frame or so from how they were rounded. */
const SAME_TIME = 0.12

/**
 * The clips whose request still has other vocals than the timing says now - which lines. A move on the Timing page changes the vocals
 * of the slots at once, but the requests (what the prompt says is sung, and when) only with the next plan run. The request leaves out
 * a line nobody sings, so only lines with a singer are expected there: the singers of its entry in `singing`, and for a line without
 * an entry (the lyrics have more lines than the singing: a repeated chorus) all of them, as the request does it. Without singers there
 * are no vocals in a request, and nothing is said.
 */
export function outdatedClips(data: Project, requests: Request[]): {clip: string, lines: number[]}[] {
    if (!data.singing || !data.timeline) return []
    const singing = data.singing
    const sung = (line: number) => (singing.lines.find(l => l.line === line)?.singers ?? singing.singers).length > 0
    // per line: where it starts and ends in the clip
    const spans = (entries: {line: number, start: number, end: number}[]) => {
        const found = new Map<number, [number, number]>()
        for (const e of entries) {
            const was = found.get(e.line)
            found.set(e.line, was ? [Math.min(was[0], e.start), Math.max(was[1], e.end)] : [e.start, e.end])
        }
        return found
    }
    const outdated: {clip: string, lines: number[]}[] = []
    for (const slot of data.timeline.slots ?? []) {
        const request = requests.find(r => r.id === slot.id)
        if (!request) continue
        const expected = spans((slot.vocals ?? []).filter(v => sung(v.line)))
        const carried = spans((request.vocals ?? []).map(v => ({line: v.line, start: v.at, end: v.end})))
        const texts = (entries: {line: number, text: string}[]) => {
            const result = new Map<number, string[]>()
            for (const e of entries) result.set(e.line, [...(result.get(e.line) ?? []), e.text])
            return result
        }
        const expectedText = texts((slot.vocals ?? []).flatMap(v => splitBySinger(v, slot.start, singing.lines.find(l => l.line === v.line), data.lyricsTiming, singing.singers).filter(p => p.singers.length)))
        const carriedText = texts(request.vocals ?? [])
        const lines = [...new Set([...expected.keys(), ...carried.keys()])].filter(line => {
            const a = expected.get(line), b = carried.get(line)
            return !a || !b || (expectedText.get(line) ?? []).join(' ') !== (carriedText.get(line) ?? []).join(' ') || Math.abs(a[0] - b[0]) > SAME_TIME || Math.abs(a[1] - b[1]) > SAME_TIME
        }).sort((a, b) => a - b)
        if (lines.length) outdated.push({clip: slot.id, lines})
    }
    return outdated
}

export function timingView(dir: string, data: Project, requests: Request[]): TimingView | undefined {
    const timing = data.lyricsTiming
    if (!timing) return undefined
    const beatOfSlot = new Map((data.mapping ?? []).map(m => [m.slotId, m.beatId]))
    const slots = data.timeline?.slots ?? []
    const beats = data.beats ?? []
    const planned = (id: string) => data.shotMoments?.[id] !== undefined
    const duration = data.music?.durationSec ?? Math.max(0, ...timing.lines.map(l => l.end))
    return {
        duration,
        lines: timing.lines.map(l => ({
            line: l.line, section: l.section, text: l.text,
            words: wordsToPlace(l, duration).map(w => ({...w})),
            estimated: l.words.some(w => w.estimated) || (!l.byHand && l.confidence < ESTIMATED_BELOW),
            byHand: !!l.byHand,
            ...(l.words.length ? {} : {unplaced: true}),
            ...(l.off ? {off: true} : {}),
            beats: [...new Set(slots.filter(s => s.vocals?.some(v => v.line === l.line)).map(s => beatOfSlot.get(s.id)).filter(b => b !== undefined))],
        })),
        cuts: slots.map(s => ({id: s.id, start: s.start, end: s.end, beat: beatOfSlot.get(s.id)})),
        beats: beats.map(b => ({id: b.id, planned: planned(b.id), clips: requests.filter(c => c.beatId === b.id).map(c => c.id)})),
        unplanned: data.shotMoments ? beats.filter(b => !planned(b.id)).map(b => b.id) : [],
        outdated: outdatedClips(data, requests),
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
    const singing = data.singing ? structuredClone(data.singing) : undefined
    const seen = new Set<number>()
    const lines: TimedLine[] = timing.lines.map(l => ({...l, words: [...l.words]}))
    for (const entry of change.lines) {
        if (!entry || seen.has(entry.line)) throw new Error('invalid or duplicate line')
        seen.add(entry.line)
        if (entry.off !== undefined && typeof entry.off !== 'boolean') throw new Error('invalid off')
        const line = lines.find(l => l.line === entry.line)
        if (!line) throw new Error(`no sung line ${entry.line}`)
        const name = `line ${entry.line + 1} ("${line.text}")`
        // left out, or sung again: the line keeps its words either way
        if (entry.off !== undefined && entry.off !== !!line.off) {
            if (entry.off) line.off = true
            else delete line.off
            result.changed.push(line.line)
        }
        if (entry.words === undefined) {
            if (entry.off === undefined) throw new Error(`${name}: neither words nor "off" given`)
            continue
        }
        const placed = wordsToPlace(line, data.music?.durationSec ?? Math.max(0, ...timing.lines.map(l => l.end)))
        if (!Array.isArray(entry.words) || !entry.words.length) throw new Error(`${name}: no words`)
        const structural = entry.words.some(w => w && w.text !== undefined)
        if (!structural && entry.words.length !== placed.length) throw new Error(`${name} has ${placed.length} words, not ${entry.words.length}`)
        const words = entry.words.map((w, n) => {
            if (!w || (structural && (typeof w.text !== 'string' || !w.text.length || /\s/.test(w.text)))) throw new Error(`${name}: invalid word text`)
            for (const key of ['joined', 'anchor', 'estimated'] as const) if (w[key] !== undefined && typeof w[key] !== 'boolean') throw new Error(`${name}: invalid ${key}`)
            if (w.group !== undefined && (typeof w.group !== 'string' || !w.group.trim())) throw new Error(`${name}: invalid group`)
            const word = {...(structural ? {} : placed[n]), text: structural ? w.text! : placed[n]!.text, start: round(Number(w.start)), end: round(Number(w.end))}
            for (const key of ['joined', 'anchor', 'estimated', 'group'] as const) if (w[key] !== undefined) Object.assign(word, {[key]: w[key]})
            return word
        })
        const source = (items: typeof placed) => items.map((w, i) => `${i && !w.joined ? ' ' : ''}${w.text}`).join('')
        if (words[0]!.joined || source(words) !== source(placed)) throw new Error(`${name}: words must preserve source text`)
        const singerLine = singing?.lines.find(l => l.line === line.line)
        if (structural && singerLine?.parts) {
            const offsets = (items: typeof placed) => { let at = 0; return items.map((w, i) => { if (i && !w.joined) at++; const start = at; at += w.text.length; return start }) }
            const oldOffsets = offsets(placed), newOffsets = offsets(words)
            singerLine.parts = singerLine.parts.map(part => {
                const from = newOffsets.indexOf(oldOffsets[part.from]!)
                if (from < 0) throw new Error(`${name}: cannot join across a singer change`)
                return {...part, from}
            })
        }
        words.forEach((w, n) => {
            if (!Number.isFinite(w.start) || !Number.isFinite(w.end)) throw new Error(`${name}: "${w.text}" has no time`)
            if (w.end - w.start < MIN_WORD_SEC - 1e-9) throw new Error(`${name}: "${w.text}" is shorter than ${MIN_WORD_SEC} s`)
            if (w.start < 0 || w.end > duration + 1e-9) throw new Error(`${name}: "${w.text}" is outside the song`)
            if (n > 0 && w.start < words[n - 1]!.end - 1e-9) throw new Error(`${name}: "${w.text}" starts before "${words[n - 1]!.text}" ends`)
        })
        // given back as it was (bun run timing --set has every line): times are kept to the millisecond, so they are compared so
        const same = words.length === placed.length && words.every((w, n) => {
            const before = placed[n]!
            return w.start === round(before.start) && w.end === round(before.end) &&
                (['text', 'joined', 'anchor', 'estimated', 'group'] as const).every(key => w[key] === before[key])
        })
        if (same) continue
        const placementChanged = words.length !== placed.length || words.some((w, n) => {
            const before = placed[n]!
            return w.start !== round(before.start) || w.end !== round(before.end) || w.text !== before.text || !!w.joined !== !!before.joined
        })
        const reviewed = structural && words.every(w => w.estimated === false)
        if (!line.words.length && !placementChanged && !reviewed) throw new Error(`${name}: Place or review this line before grouping or anchoring`)
        line.words = words
        line.start = words[0]!.start
        line.end = words.at(-1)!.end
        if (placementChanged || reviewed) {
            line.confidence = 1
            line.byHand = true
        }
        if (!result.changed.includes(line.line)) result.changed.push(line.line)
    }
    if (!result.changed.length) return result
    data.lyricsTiming = {...timing, lines}
    if (singing) data.singing = singing

    // the cut stays: what each clip sings is worked out again, as step 10 does it
    const slots = data.timeline?.slots ?? []
    // Anchors, review flags and UI groups do not change what is sung. Keep them in the saved
    // words, but do not discard expensive shot plans merely for organizing the editor.
    const audible = (vocals: NonNullable<typeof slots[number]['vocals']>) => vocals.map(v => ({
        ...v, words: v.words.map(({text, start, end, joined}) => ({text, start, end, ...(joined ? {joined} : {})})),
    }))
    for (const slot of slots) {
        const vocals = slotVocals(slot, data.lyricsTiming)
        const changed = JSON.stringify(audible(vocals)) !== JSON.stringify(audible(slot.vocals ?? []))
        slot.vocals = vocals
        if (!changed) continue
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
    for (const line of lines.filter(l => result.changed.includes(l.line) && !l.off)) for (const w of line.words) {
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
        writeJsonFile(file, data)
        return result
    })
}
