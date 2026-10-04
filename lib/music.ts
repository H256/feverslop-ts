import {join} from "node:path";
import type {Assignment, InstrumentStems, LyricSection, LyricsTiming, MusicMap, Slot, Stems, StoryBeat, Timeline, Transcript} from "./project.ts";
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
export function buildTimeline(music: MusicMap, lyricSections: LyricSection[], maxClipSec: number, timing?: LyricsTiming): Timeline {
    const barSec = 240 / music.bpm
    const barsPerSlot = 2 ** Math.floor(Math.log2(Math.max(1, Math.floor(maxClipSec / barSec))))
    const slots: Slot[] = []
    const sections = timing ? refineSections(music, lyricSections, timing) : music.sections

    sections.forEach((section, sectionIndex) => {
        const bars = music.downbeats
            .map((time, index) => ({time, index}))
            .filter(b => b.time >= section.start - 0.05 && b.time < section.end - 0.05)
        const groups: typeof bars[] = []
        // the section's opening slot starts at section.start, not at its first bar, so it doesn't lose
        // a pickup/lead-in before the first downbeat - but that lead-in still counts against its time
        // budget, so the first group gets fewer bars than barsPerSlot whenever there is one, however many
        // it takes to keep (lead-in + those bars) within maxClipSec
        let firstSize = barsPerSlot
        while (firstSize > 1 && bars[firstSize] && bars[firstSize]!.time - section.start > maxClipSec) firstSize--
        if (bars.length) groups.push(bars.slice(0, firstSize))
        for (let i = firstSize; i < bars.length; i += barsPerSlot) groups.push(bars.slice(i, i + barsPerSlot))
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
        if (beforeLast && last.length < barsPerSlot && (section.end - beforeLast[0]!.time) <= maxClipSec) {
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

        // the fallback without word timing: the section's lines spread evenly over its clips
        const lines = lyricSections[sectionIndex]?.lines ?? []
        lines.forEach((line, i) => sectionSlots[Math.floor(i * sectionSlots.length / lines.length)]!.lyrics.push(line))
        slots.push(...sectionSlots)
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
 * - beats with a lyric anchor landing outside that song section
 * - run lengths deviating from the beat's share of the screen time (weight)
 */
export function mapBeatsToSlots(beats: StoryBeat[], slots: Slot[]): Assignment[] {
    const B = beats.length
    const S = slots.length
    if (B > S) throw new Error(`${B} story beats but only ${S} clips - raise the clip count or regenerate fewer beats`)

    const totalWeight = beats.reduce((sum, b) => sum + b.weight, 0)
    const target = beats.map(b => b.weight / totalWeight * S)
    const normalize = (label: string) => label.toLowerCase().replace(/[^a-z]/g, '')

    const slotCost = (beat: StoryBeat, slot: Slot) =>
        Math.abs(beat.intensity - slot.energy)
        + (beat.lyricAnchor && normalize(beat.lyricAnchor) !== normalize(slot.section) ? 1 : 0)
        + (beat.kind === 'hit' && slot.energy < 0.5 ? 0.5 : 0)

    // prefix[b][i] = cost of slots 0..i-1 all assigned to beat b
    const prefix = beats.map(beat => {
        const sums = [0]
        for (const slot of slots) sums.push(sums.at(-1)! + slotCost(beat, slot))
        return sums
    })
    const runCost = (b: number, from: number, to: number) =>
        prefix[b]![to]! - prefix[b]![from]! + 0.5 * ((to - from - target[b]!) ** 2) / Math.max(1, target[b]!)

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
