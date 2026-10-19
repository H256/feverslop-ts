import {existsSync, rmSync, statSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, join} from "node:path";
import type {Assignment, Character, InstrumentStems, LyricSection, LyricsTiming, MusicMap, Slot, SlotVocal, Stems, StoryBeat, Timeline, Transcript} from "./project.ts";
import {refineSections, slotVocals} from "./lyrics.ts";
import {formatTime, round} from "./frames.ts";
import {log} from "./log.ts";
import {runProcess, SHORT_PROCESS_TIMEOUT_MS} from "./process.ts";

/**
 * "[Verse 1]\n[Low, gravelly vocals]\nline\nline" -> [{label: 'Verse 1', notes: ['Low, gravelly vocals'], lines: [...]}]
 * Tags on lines right after each other - no lyric line and no blank line between them - are one section: the first names
 * it, the others say how it sounds (the way Suno writes a part). Read one section per tag, a description became a section
 * of its own with an invented boundary, since the song analysis cuts the song into exactly as many sections as there are
 * labels. A blank line or a lyric line ends the run of tags: "[Guitar Solo]\n\n[Bridge]" are two sections.
 * perTag: one section per tag, as it was read before - for a project whose song analysis was made with those labels.
 */
export function parseLyricSections(lyrics: string, perTag = false): LyricSection[] {
    const sections: LyricSection[] = []
    let afterTag = false
    for (const raw of lyrics.split('\n')) {
        const line = raw.trim()
        const tag = line.match(/^\[(.+)]$/)
        if (tag && afterTag && !perTag) (sections.at(-1)!.notes ??= []).push(tag[1]!.trim())
        else if (tag) sections.push({label: tag[1]!.trim(), lines: []})
        else if (line) sections.at(-1)?.lines.push(line)
        afterTag = Boolean(tag)
    }
    return sections
}

/**
 * The sections of a project's lyrics: read per tag, as before, while its song analysis (`analyzed`, the labels of music.sections)
 * was made with those labels - else every project with a heading and description tags would analyze its song again on the
 * next run, and redo everything built on it (beats, shots, clips). --redo=music reads them as one section.
 */
export function projectLyricSections(lyrics: string, analyzed?: string[]): LyricSection[] {
    const sections = parseLyricSections(lyrics)
    const perTag = parseLyricSections(lyrics, true)
    const analyzedWith = (read: LyricSection[]) => analyzed !== undefined && read.map(s => s.label).join('|') === analyzed.join('|')
    return !analyzedWith(sections) && analyzedWith(perTag) ? perTag : sections
}

export async function analyzeSong(songFile: string, labels: string[]): Promise<MusicMap> {
    const stdout = await runProcess(['uv', 'run', 'tools/analyze_song.py', songFile, JSON.stringify(labels)], {errorMessage: err => `Song analysis failed:\n${err}`})
    return JSON.parse(stdout)
}

// demucs htdemucs_ft: the song's stems as WAV files in <projectDir>/stems/, paths relative to the project.
// Only the vocals stem is used downstream (lip-sync reference, transcription) - htdemucs_ft gives it the
// cleanest separation of the demucs family, at the cost of not splitting out guitar/piano/other individually.
export async function separateStems(songFile: string, projectDir: string): Promise<Stems> {
    await runVocalsTool(['separate', songFile, join(projectDir, 'stems')], 'Stem separation')
    const names = ['vocals', 'drums', 'bass', 'other'] as const
    return Object.fromEntries(names.map(name => [name, `stems/${name}.wav`])) as Stems
}

// htdemucs_6s: guitar/piano only, on top of the htdemucs_ft stems already on disk (never overwritten - see
// tools/vocals.py) - run only for the instruments a character's propStem actually needs, since htdemucs_ft's
// "other" stem (used for every other propStem) is too coarse to time a guitar's or piano's own entry against.
export async function separateInstrumentStems(songFile: string, projectDir: string, names: ('guitar' | 'piano')[]): Promise<InstrumentStems> {
    await runVocalsTool(['separate', songFile, join(projectDir, 'stems'), 'htdemucs_6s', ...names], 'Instrument stem separation')
    return Object.fromEntries(names.map(name => [name, `stems/${name}.wav`])) as InstrumentStems
}

// Whisper large-v3 on the vocals stem, word timestamps, the lyrics as prompt
export async function transcribeVocals(vocalsFile: string, language: string, lyricsFile: string): Promise<Transcript> {
    return JSON.parse(await runVocalsTool(['transcribe', vocalsFile, language, lyricsFile], 'Transcription'))
}

// Instrument activity: where a stem is actually played - grounds a character's on-screen prop use (a guitarist's playing)
// in whether that stem is audible there. Not the vocal-activity detection of tools/vocals.py: that one wants 0.4 s in a
// row above a threshold between the stem's own quiet and loud levels - right for a voice with real pauses, but a drum or
// bass stem drops between its hits and plays through most of a song, so it found the drums of a rock song active for
// 18 of 215 s, and the band was told to keep their instruments still while they were heard (tides-of-eternal-flame).
// Here the energy is averaged over one bar - a groove keeps it up between its hits - and held against the stem's own
// playing level: active where it is at most ACTIVITY_MARGIN_DB below the stem's loud bars, and above the floor where a
// separated stem only carries the bleed of the others (a vocals stem between its lines sits near -60 dBFS).
const ACTIVITY_SAMPLE_RATE = 8000
const ACTIVITY_HOP_SEC = 0.05
const ACTIVITY_MARGIN_DB = 20
const ACTIVITY_FLOOR_DB = -50

export async function stemActivity(stemFile: string, bpm: number): Promise<{ start: number, end: number }[]> {
    const raw = join(tmpdir(), `activity-${process.pid}-${basename(stemFile)}.f32`)
    await runProcess(['ffmpeg', '-y', '-v', 'error', '-i', stemFile, '-ac', '1', '-ar', String(ACTIVITY_SAMPLE_RATE), '-f', 'f32le', raw], {timeoutMs: SHORT_PROCESS_TIMEOUT_MS, errorMessage: err => `ffmpeg failed to decode ${stemFile}:\n${err}`})
    try {
        const samples = new Float32Array(await Bun.file(raw).arrayBuffer())
        return activityRanges(framePower(samples, ACTIVITY_SAMPLE_RATE, ACTIVITY_HOP_SEC), ACTIVITY_HOP_SEC, 240 / bpm)
    } finally {
        rmSync(raw, {force: true})
    }
}

/** The mean square of the samples per frame of `hopSec`. */
export function framePower(samples: Float32Array, sampleRate: number, hopSec: number): number[] {
    const hop = Math.round(sampleRate * hopSec)
    const power: number[] = []
    for (let i = 0; i + hop <= samples.length; i += hop) {
        let sum = 0
        for (let k = i; k < i + hop; k++) sum += samples[k]! * samples[k]!
        power.push(sum / hop)
    }
    return power
}

/**
 * The stretches where the per-frame power, averaged over one bar around each frame, lies above the stem's own threshold
 * (see stemActivity). Gaps up to a bar are bridged (a break of a beat or two is still the same playing), stretches
 * shorter than half a bar are dropped (a single hit or bleed spike). The averaging blurs each edge by up to half a bar.
 */
export function activityRanges(power: number[], hopSec: number, barSec: number): { start: number, end: number }[] {
    if (!power.length) return []
    const half = Math.max(1, Math.round(barSec / hopSec / 2))
    const prefix = [0]
    for (const p of power) prefix.push(prefix.at(-1)! + p)
    const level = power.map((_, i) => {
        const from = Math.max(0, i - half), to = Math.min(power.length, i + half + 1)
        return 10 * Math.log10((prefix[to]! - prefix[from]!) / (to - from) + 1e-12)
    })
    const loud = [...level].sort((a, b) => a - b)[Math.floor(0.95 * (level.length - 1))]!
    const threshold = Math.max(loud - ACTIVITY_MARGIN_DB, ACTIVITY_FLOOR_DB)

    const ranges: { start: number, end: number }[] = []
    level.forEach((db, i) => {
        if (db <= threshold) return
        const last = ranges.at(-1)
        if (last && i * hopSec - last.end <= barSec) last.end = (i + 1) * hopSec
        else ranges.push({start: i * hopSec, end: (i + 1) * hopSec})
    })
    return ranges.filter(r => r.end - r.start >= barSec / 2).map(r => ({start: round(r.start), end: round(r.end)}))
}

// progress (and the model downloads on first use) are shown as they happen, stdout is the result
async function runVocalsTool(args: string[], what: string) {
    return runProcess(['uv', 'run', 'tools/vocals.py', ...args], {
        stderr: 'inherit',
        errorMessage: () => `${what} failed (tools/vocals.py ${args[0]}) - see the output above`,
    })
}

// Cuts the clip's part out of the song - it becomes the clip's <Audio 1>
export async function cutAudio(songFile: string, start: number, end: number, outFile: string) {
    await runProcess(['ffmpeg', '-y', '-v', 'error', '-ss', String(start), '-to', String(end), '-i', songFile, '-c:a', 'pcm_s16le', outFile], {timeoutMs: SHORT_PROCESS_TIMEOUT_MS, errorMessage: err => `ffmpeg failed for ${outFile}:\n${err}`})
}

// Several instrument stems as one track (a mixed <Audio N>, lib/compose.ts mixStem): summed, not averaged - amix would lower each
// part by the number of inputs, and a separated stem is no louder than its part of the song. Made again only when a stem is newer.
export async function mixStems(files: string[], outFile: string): Promise<string> {
    if (existsSync(outFile) && files.every(f => statSync(f).mtimeMs <= statSync(outFile).mtimeMs)) return outFile
    await runProcess(['ffmpeg', '-y', '-v', 'error', ...files.flatMap(f => ['-i', f]), '-filter_complex', `amix=inputs=${files.length}:duration=longest:normalize=0`, '-c:a', 'pcm_s16le', outFile], {timeoutMs: SHORT_PROCESS_TIMEOUT_MS, errorMessage: err => `ffmpeg failed to mix ${outFile}:\n${err}`})
    return outFile
}

/**
 * Cuts every section into clips of a power-of-two bar count that fits the hardware limit.
 * With the lyrics timing, the sections start where their vocals start and every clip gets the words sung in it.
 */
/**
 * Splits the bars of a section into clips of 1..maxBars bars so that as few sung words as possible are cut in two by a clip
 * boundary: a clip that ends in the middle of a word leaves the video model half a word at its end and a fragment at the start
 * of the next clip. Only the timing of the words is used. Dynamic programming over the bar boundaries, minimizing
 * - a word cut by a boundary (1 each), a line that goes on over a boundary between two words (small),
 * - the clip length deviating from `barsPerSlot` (small - the usual length stays the usual one).
 * Returns the bar index where each clip starts, or undefined if no split keeps every clip within maxClipSec.
 */
export function chooseClipStarts(barTimes: number[], sectionStart: number, sectionEnd: number, barsPerSlot: number, maxBars: number, maxClipSec: number, timing: LyricsTiming): number[] | undefined {
    const n = barTimes.length
    if (!n) return undefined
    const words = timing.lines.flatMap(l => l.words)
    const margin = 0.05
    const cutCost = (t: number) => {
        const cut = words.filter(w => w.start < t - margin && w.end > t + margin).length
        if (cut) return cut
        return timing.lines.some(l => l.start < t - margin && l.end > t + margin) ? 0.1 : 0
    }
    const timeAt = (k: number) => k === 0 ? sectionStart : k === n ? sectionEnd : barTimes[k]!
    // best[j]: cheapest way to have clips cover bars 0..j-1, with a boundary before bar j
    const best: number[] = Array(n + 1).fill(Infinity)
    const from: number[] = Array(n + 1).fill(-1)
    best[0] = 0
    for (let j = 1; j <= n; j++) {
        for (let len = 1; len <= Math.min(maxBars, j); len++) {
            const i = j - len
            if (best[i] === Infinity || timeAt(j) - timeAt(i) > maxClipSec) continue
            const cost = best[i]! + (j < n ? cutCost(timeAt(j)) : 0) + 0.15 * Math.abs(len - barsPerSlot)
            if (cost < best[j]!) { best[j] = cost; from[j] = i }
        }
    }
    if (best[n] === Infinity) return undefined
    const starts: number[] = []
    for (let j = n; j > 0; j = from[j]!) starts.unshift(from[j]!)
    return starts
}

// the shortest clip a split at a vocal gap leaves - below it the clip stays as it is
const MIN_GAP_CLIP_SEC = 1
// a cut before the voice comes in lands on the downbeat right before it when that is this close, else just before the word
const DOWNBEAT_SNAP_SEC = 0.3
const ONSET_LEAD_SEC = 0.1
// after the last word the mouth closes: the cut comes a moment later
const RELEASE_SEC = 0.2

/**
 * config.vocalGap: a clip in which the singing starts more than `gap` seconds after its start is cut where the voice comes
 * in, and one in which it stops more than `gap` seconds before its end is cut where it stops. A generation that opens on
 * seconds of silence starts the lip movement early, whatever the prompt says about closed lips - the silence gets a clip
 * of its own. A cut before the voice lands on the downbeat right before it when that is close. Two silent pieces next to
 * each other (the tail of one clip, the lead-in of the next) become one clip when it fits into maxClipSec.
 */
export function splitAtVocalGaps<T extends Pick<Slot, 'start' | 'end' | 'bars'>>(slots: T[], timing: LyricsTiming, downbeats: number[], gap: number, maxClipSec: number, barSec: number): T[] {
    if (gap <= 0) return slots
    const words = timing.lines.flatMap(l => l.words)
    const piece = (slot: T, start: number, end: number) => ({...slot, start, end, bars: Math.max(1, Math.round((end - start) / barSec))})
    const pieces: { slot: T, silent: boolean }[] = []
    for (const slot of slots) {
        const sung = words.filter(w => w.start >= slot.start - 0.05 && w.start < slot.end)
        if (!sung.length) {
            pieces.push({slot, silent: true})
            continue
        }
        let start = slot.start
        const onset = sung[0]!.start
        const before = downbeats.find(d => d <= onset && d > onset - DOWNBEAT_SNAP_SEC)
        const into = before ?? round(onset - ONSET_LEAD_SEC)
        if (onset - start > gap && into - start >= MIN_GAP_CLIP_SEC && slot.end - into >= MIN_GAP_CLIP_SEC) {
            pieces.push({slot: piece(slot, start, into), silent: true})
            start = into
        }
        const stop = Math.max(...sung.map(w => w.end))
        const after = downbeats.find(d => d >= stop && d < stop + DOWNBEAT_SNAP_SEC)
        const out = after ?? round(stop + RELEASE_SEC)
        if (slot.end - stop > gap && out - start >= MIN_GAP_CLIP_SEC && slot.end - out >= MIN_GAP_CLIP_SEC) {
            pieces.push({slot: piece(slot, start, out), silent: false}, {slot: piece(slot, out, slot.end), silent: true})
        } else {
            pieces.push({slot: start === slot.start ? slot : piece(slot, start, slot.end), silent: false})
        }
    }
    // a silent piece next to a silent piece: one clip, if it fits
    const merged: typeof pieces = []
    for (const p of pieces) {
        const last = merged.at(-1)
        if (last?.silent && p.silent && p.slot.end - last.slot.start <= maxClipSec) last.slot = piece(last.slot, last.slot.start, p.slot.end)
        else merged.push({...p})
    }
    return merged.map(p => p.slot)
}

export function buildTimeline(music: MusicMap, lyricSections: LyricSection[], maxClipSec: number, timing?: LyricsTiming, vocalGap = 0): Timeline {
    const barSec = 240 / music.bpm
    const barsPerSlot = 2 ** Math.floor(Math.log2(Math.max(1, Math.floor(maxClipSec / barSec))))
    const slots: Slot[] = []
    const sections = timing ? refineSections(music, lyricSections, timing) : music.sections

    sections.forEach((section, sectionIndex) => {
        const bars = music.downbeats
            .map((time, index) => ({time, index}))
            .filter(b => b.time >= section.start - 0.05 && b.time < section.end - 0.05)
        let groups: typeof bars[] = []
        // with the lyrics timing the clips are cut where no sung word is cut in two (chooseClipStarts)
        const starts = timing ? chooseClipStarts(bars.map(b => b.time), section.start, section.end, barsPerSlot, Math.max(1, Math.floor(maxClipSec / barSec)), maxClipSec, timing) : undefined
        if (starts) groups = starts.map((from, k) => bars.slice(from, starts[k + 1] ?? bars.length))
        // otherwise: the section's opening slot starts at section.start, not at its first bar, so it doesn't lose
        // a pickup/lead-in before the first downbeat - but that lead-in still counts against its time
        // budget, so the first group gets fewer bars than barsPerSlot whenever there is one, however many
        // it takes to keep (lead-in + those bars) within maxClipSec
        let firstSize = barsPerSlot
        while (!starts && firstSize > 1 && bars[firstSize] && bars[firstSize]!.time - section.start > maxClipSec) firstSize--
        if (!starts && bars.length) groups.push(bars.slice(0, firstSize))
        if (!starts) for (let i = firstSize; i < bars.length; i += barsPerSlot) groups.push(bars.slice(i, i + barsPerSlot))
        if (groups.length === 0) {
            // no downbeat inside it - typically an intro before the beat tracker locks on (the first downbeat
            // can be 10+ s into a drumless intro). A real section still needs clips or the video has a gap there:
            // cut it into equal parts by time. Zero length sections (the refined last one at the very end) get none.
            const length = section.end - section.start
            if (length < 1) {
                log.warn(`section "${section.label}" (${formatTime(section.start, true)} – ${formatTime(section.end, true)}) has no bar of its own and gets no clip - unless it is empty, the video has a gap there. Check the section times (music.sections / lyricsTiming in project.json), then --redo=timeline`)
                return
            }
            const parts = Math.ceil(length / maxClipSec)
            const part = length / parts
            const sectionSlots = Array.from({length: parts}, (_, i) => ({
                id: '',
                index: 0,
                section: section.label,
                start: section.start + i * part,
                end: i === parts - 1 ? section.end : section.start + (i + 1) * part,
                bars: Math.max(1, Math.round(part / barSec)),
                energy: section.energy,
                lyrics: [] as string[],
            }))
            const lines = lyricSections[sectionIndex]?.lines ?? []
            lines.forEach((line, i) => sectionSlots[Math.floor(i * sectionSlots.length / lines.length)]!.lyrics.push(line))
            slots.push(...sectionSlots)
            return
        }

        // a short leftover is merged into the previous clip if that still fits
        const last = groups.at(-1)!
        const beforeLast = groups.at(-2)
        if (!starts && beforeLast && last.length < barsPerSlot && (section.end - beforeLast[0]!.time) <= maxClipSec) {
            groups.splice(-2, 2, [...beforeLast, ...last])
        }

        const sectionSlots = groups.map((group, i) => {
            const start = i === 0 ? section.start : group[0]!.time
            const end = i === groups.length - 1 ? section.end : groups[i + 1]![0]!.time
            const energies = group.map(b => music.barEnergy[b.index] ?? 0)
            return {
                id: '',
                index: 0,
                section: section.label,
                start,
                end,
                bars: group.length,
                energy: energies.reduce((a, b) => a + b, 0) / energies.length,
                lyrics: [] as string[],
            }
        })

        // a clip that is too long however the bars fall (a long lead-in before the first few late downbeats, a gap
        // between two bars) is cut by time into equal parts: no cut point of the music is left inside the limit
        const sized = sectionSlots.flatMap(slot => {
            const length = slot.end - slot.start
            if (length <= maxClipSec + 1e-6) return [slot]
            const parts = Math.ceil(length / maxClipSec - 1e-6)
            const part = length / parts
            return Array.from({length: parts}, (_, i) => ({
                ...slot,
                start: slot.start + i * part,
                end: i === parts - 1 ? slot.end : slot.start + (i + 1) * part,
                bars: Math.max(1, Math.round(part / barSec)),
            }))
        })

        // a long silence before the singing starts or after it stops is a clip of its own (config.vocalGap)
        const split = timing ? splitAtVocalGaps(sized, timing, music.downbeats, vocalGap, maxClipSec, barSec) : sized
        // the fallback without word timing: the section's lines spread evenly over its clips
        const lines = lyricSections[sectionIndex]?.lines ?? []
        split.forEach(slot => slot.lyrics = [])
        lines.forEach((line, i) => split[Math.floor(i * split.length / lines.length)]!.lyrics.push(line))
        slots.push(...split)
    })

    slots.forEach((slot, i) => {
        slot.index = i
        slot.id = `slot-${String(i + 1).padStart(3, '0')}`
        slot.start = round(slot.start)
        slot.end = round(slot.end)
        slot.energy = round(slot.energy)
        if (timing) slot.vocals = slotVocals(slot, timing)
    })
    return {maxClipSec, barsPerSlot, aligned: Boolean(timing), sections, slots}
}

/**
 * Stretches the story beats over the slots, in story order, every beat getting at least one slot.
 * Dynamic programming over contiguous runs, minimizing:
 * - intensity of the beat vs energy of the music
 * - run lengths deviating from the beat's share of the screen time (weight)
 */
// how hard a beat's run of clips is pulled towards its share of the screen time - the energy match alone would give a
// whole low-energy-cost stretch of the song to one beat and a single clip to its neighbour
const RUN_LENGTH_WEIGHT = 2

export function mapBeatsToSlots(beats: StoryBeat[], slots: Slot[]): Assignment[] {
    const B = beats.length
    const S = slots.length
    if (B > S) throw new Error(`${B} story beats but only ${S} clips - raise the clip count or regenerate fewer beats`)

    const totalWeight = beats.reduce((sum, b) => sum + b.weight, 0)
    const target = beats.map(b => b.weight / totalWeight * S)
    const slotCost = (beat: StoryBeat, slot: Slot) =>
        Math.abs(beat.intensity - slot.energy)
        + (beat.kind === 'hit' && slot.energy < 0.5 ? 0.5 : 0)

    // prefix[b][i] = cost of slots 0..i-1 all assigned to beat b
    const prefix = beats.map(beat => {
        const sums = [0]
        for (const slot of slots) sums.push(sums.at(-1)! + slotCost(beat, slot))
        return sums
    })
    const runCost = (b: number, from: number, to: number) =>
        prefix[b]![to]! - prefix[b]![from]! + RUN_LENGTH_WEIGHT * ((to - from - target[b]!) ** 2) / Math.max(1, target[b]!)

    // best[b][i] = cost of assigning beats 0..b-1 to slots 0..i-1
    const best = Array.from({length: B + 1}, () => new Array<number>(S + 1).fill(Infinity))
    const cut = Array.from({length: B + 1}, () => new Array<number>(S + 1).fill(-1))
    best[0]![0] = 0
    for (let b = 1; b <= B; b++) {
        for (let i = b; i <= S - (B - b); i++) {
            for (let k = b - 1; k < i; k++) {
                const cost = best[b - 1]![k]! + runCost(b - 1, k, i)
                if (cost < best[b]![i]!) {
                    best[b]![i] = cost
                    cut[b]![i] = k
                }
            }
        }
    }

    const assignments: Assignment[] = []
    for (let b = B, i = S; b > 0; b--) {
        const k = cut[b]![i]!
        for (let s = k; s < i; s++) assignments[s] = {slotId: slots[s]!.id, beatId: beats[b - 1]!.id}
        i = k
    }
    return assignments
}


/** A beat that is a fight: a big moment (kind "hit") with a crowd of creatures in it - orcs, witches, a pack. */
export function isFightBeat(beat: StoryBeat, characters: Character[]): boolean {
    return beat.kind === 'hit' && beat.characterIds.some(id => characters.find(c => c.id === id)?.isGroup === true)
}

/**
 * config.fightClips: the clips of a fight beat are cut into pieces of `barsPerPiece` bars (one bar is about two
 * seconds) - one shot and one action each, a clip with only the people of that shot as references (compose.ts).
 * The ids and indexes of all slots are numbered anew, the mapping follows; lyrics stay with the first piece of a slot,
 * sung lines go to the piece they are sung in (times relative to the piece).
 */
export function splitFightSlots(slots: Slot[], mapping: Assignment[], beats: StoryBeat[], characters: Character[], music: MusicMap, barsPerPiece = 1): { slots: Slot[], mapping: Assignment[] } {
    const fights = new Set(beats.filter(b => isFightBeat(b, characters)).map(b => b.id))
    const out: Slot[] = []
    const outMapping: Assignment[] = []
    slots.forEach((slot, i) => {
        const beatId = mapping[i]!.beatId
        if (!fights.has(beatId)) {
            out.push({...slot})
            outMapping.push({slotId: '', beatId})
            return
        }
        const bars = music.downbeats.filter(t => t >= slot.start - 0.05 && t < slot.end - 0.05)
        const cuts = bars.filter((_, k) => k > 0 && k % barsPerPiece === 0 && bars[k]! > slot.start + 0.3 && bars[k]! < slot.end - 0.3)
        const edges = [slot.start, ...cuts, slot.end]
        edges.slice(0, -1).forEach((from, k) => {
            const to = edges[k + 1]!
            const vocals: SlotVocal[] = (slot.vocals ?? []).flatMap(v => {
                const words = v.words
                    .filter(w => slot.start + (w.start + w.end) / 2 >= from && slot.start + (w.start + w.end) / 2 < to)
                    .map(w => ({...w, start: round(slot.start + w.start - from), end: round(slot.start + w.end - from)}))
                if (!words.length) return []
                return [{...v, start: words[0]!.start, end: words.at(-1)!.end, words}]
            })
            out.push({
                ...slot,
                start: from,
                end: to,
                bars: Math.max(1, Math.round(bars.filter(t => t >= from - 0.05 && t < to - 0.05).length)),
                lyrics: k === 0 ? slot.lyrics : [],
                vocals: slot.vocals ? vocals : undefined,
                micro: true,
            })
            outMapping.push({slotId: '', beatId})
        })
    })
    out.forEach((slot, i) => {
        slot.index = i
        slot.id = `slot-${String(i + 1).padStart(3, '0')}`
        outMapping[i]!.slotId = slot.id
    })
    return {slots: out, mapping: outMapping}
}
