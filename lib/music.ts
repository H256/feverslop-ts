import {join} from "node:path";
import type {Assignment, Character, InstrumentStems, LyricSection, LyricsTiming, MusicMap, Slot, SlotVocal, Stems, StoryBeat, Timeline, Transcript} from "./project.ts";
import {refineSections, slotVocals} from "./lyrics.ts";
import {formatTime, round} from "./frames.ts";
import {log} from "./log.ts";
import {runProcess, SHORT_PROCESS_TIMEOUT_MS} from "./process.ts";

// "[Verse 1]\nline\nline" -> [{label: 'Verse 1', lines: [...]}]
export function parseLyricSections(lyrics: string): LyricSection[] {
    const sections: LyricSection[] = []
    for (const raw of lyrics.split('\n')) {
        const line = raw.trim()
        const tag = line.match(/^\[(.+)]$/)
        if (tag) sections.push({label: tag[1]!.trim(), lines: []})
        else if (line) sections.at(-1)?.lines.push(line)
    }
    return sections
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

// Same RMS-energy activity detection as the vocals transcription uses, run standalone on any stem - grounds a
// character's on-screen prop use (e.g. a guitarist's playing) in whether that stem is actually audible there
export async function stemActivity(stemFile: string): Promise<{ start: number, end: number }[]> {
    const result = JSON.parse(await runVocalsTool(['activity', stemFile], 'Stem activity')) as { activity: { start: number, end: number }[] }
    return result.activity
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

export function buildTimeline(music: MusicMap, lyricSections: LyricSection[], maxClipSec: number, timing?: LyricsTiming): Timeline {
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

        // the fallback without word timing: the section's lines spread evenly over its clips
        const lines = lyricSections[sectionIndex]?.lines ?? []
        lines.forEach((line, i) => sized[Math.floor(i * sized.length / lines.length)]!.lyrics.push(line))
        slots.push(...sized)
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
