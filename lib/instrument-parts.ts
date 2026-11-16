import {round} from './frames.ts'

/**
 * The stretches of a song where nobody sings, split into parts by the song's energy, and how each instrument stem plays in every
 * part (#1021). A section the lyrics call "Guitar Solo" can hold a solo, a break of staccato hits and a build-up; the plan and the
 * video model get one label for all of it. The activity of lib/music.ts bridges gaps up to a bar and cannot tell them apart.
 *
 * Measured only, from the stems: nothing here knows a word like "solo", and nothing says that anybody plays - the caller
 * decides whether a band is on screen at all. Without vocals (a song without singing) the whole song is one gap.
 */

/** How a stem plays in a part, against its own playing level: through (sustained), with pauses between hits, or not at all (still). */
export type Articulation = 'sustained' | 'hits' | 'partial' | 'still'
export type PartLevel = 'pause' | 'low' | 'mid' | 'high'

export type PartStem = {
    stem: string
    /** the part's level against the stem's own loud bars (the 95th percentile), in dB: above 0 = louder than it usually gets */
    relDb: number
    /** the share of the part (0..1) in which the stem plays */
    duty: number
    /** pauses of half a second or more far below the stem's playing level inside the part - the gaps between hits */
    pauses: number
    articulation: Articulation
}

export type SongPart = {
    start: number
    end: number
    energy: number
    level: PartLevel
    stems: PartStem[]
    /** the stem that is above its own usual level while the others are not: it carries the part (a solo) */
    leads?: string
}
export type InstrumentGap = {start: number; end: number; parts: SongPart[]}

export const MIN_GAP_SEC = 8
export const MIN_PART_SEC = 4
// a stem plays where it is at most this far below its loud bars, and a pause is far below that
const PLAYING_MARGIN_DB = 20
const PAUSE_MARGIN_DB = 30
const WINDOW_SEC = 0.25
// the vocals stem between its lines sits near -60 dBFS - the same rule as the instrument activity (lib/music.ts)
const VOCAL_MARGIN_DB = 20
const VOCAL_FLOOR_DB = -50
// a stem has to be above its usual level by this much more than every other stem to lead
const LEAD_MARGIN_DB = 1
// and it is above its own usual level by more than this: a stem on its level is no lead, whatever the rounding says
const LEAD_MIN_DB = 0.5
// bars with less than this energy are a pause, the rest is low/mid/high by the song's own thirds
const PAUSE_ENERGY = 0.1

export type PartsInput = {
    downbeats: number[]
    durationSec: number
    barEnergy: number[]
    /** the frame power of the vocals stem - left out, the song has no singing */
    vocals?: number[]
    /** the frame power of every instrument stem, by name */
    stems: Record<string, number[]>
    hopSec: number
    minGapSec?: number
    minPartSec?: number
}

const db = (power: number) => 10 * Math.log10(power + 1e-12)
const percentile = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.floor(q * (xs.length - 1))]!

function meanPower(power: number[], hopSec: number, from: number, to: number): number {
    const i = Math.max(0, Math.floor(from / hopSec)),
        j = Math.min(power.length, Math.ceil(to / hopSec))
    let sum = 0
    for (let k = i; k < j; k++) sum += power[k]!
    return j > i ? sum / (j - i) : 0
}

/** The vocal gaps of at least `minGapSec`, as ranges of bars [from, to). */
function vocalGapBars(input: PartsInput, edges: number[]): [number, number][] {
    const bars = edges.length - 1
    let singing: boolean[]
    if (input.vocals) {
        const levels = Array.from({length: bars}, (_, i) => db(meanPower(input.vocals!, input.hopSec, edges[i]!, edges[i + 1]!)))
        const threshold = Math.max(percentile(levels, 0.95) - VOCAL_MARGIN_DB, VOCAL_FLOOR_DB)
        singing = levels.map(level => level > threshold)
    } else singing = Array.from({length: bars}, () => false)
    const gaps: [number, number][] = []
    for (let i = 0; i < bars;) {
        if (singing[i]) {
            i++
            continue
        }
        let j = i
        while (j < bars && !singing[j]) j++
        if (edges[j]! - edges[i]! >= (input.minGapSec ?? MIN_GAP_SEC)) gaps.push([i, j])
        i = j
    }
    return gaps
}

type Run = {level: PartLevel; from: number; to: number}

/** Runs of bars of one energy level; a run shorter than `minPartSec` joins the neighbour whose energy is closer (and has its level), until none is. */
function partRuns(energy: number[], edges: number[], from: number, to: number, thirds: [number, number], minPartSec: number): Run[] {
    const levelOf = (e: number): PartLevel => (e < PAUSE_ENERGY ? 'pause' : e <= thirds[0] ? 'low' : e <= thirds[1] ? 'mid' : 'high')
    const mean = (r: {from: number; to: number}) => energy.slice(r.from, r.to).reduce((a, b) => a + b, 0) / (r.to - r.from)
    const runs: Run[] = []
    for (let i = from; i < to; i++) {
        const level = levelOf(energy[i]!)
        const last = runs.at(-1)
        if (last && last.level === level) last.to = i + 1
        else runs.push({level, from: i, to: i + 1})
    }
    for (;;) {
        const short = runs.findIndex(r => runs.length > 1 && edges[r.to]! - edges[r.from]! < minPartSec)
        if (short < 0) break
        const run = runs[short]!
        const before = runs[short - 1],
            after = runs[short + 1]
        const closer = !before ? after! : !after ? before : Math.abs(mean(before) - mean(run)) <= Math.abs(mean(after) - mean(run)) ? before : after
        closer.from = Math.min(closer.from, run.from)
        closer.to = Math.max(closer.to, run.to)
        runs.splice(short, 1)
        // neighbours that came to the same level are one part
        for (let k = 1; k < runs.length;) {
            if (runs[k]!.level === runs[k - 1]!.level) {
                runs[k - 1]!.to = runs[k]!.to
                runs.splice(k, 1)
            } else k++
        }
    }
    return runs
}

/** How one stem plays between `from` and `to` (seconds), held against its own playing level `loudDb` (stemLoudDb). */
export function howStemPlays(power: number[], hopSec: number, loudDb: number, from: number, to: number) {
    let windows = 0,
        playing = 0,
        pauses = 0,
        quiet = 0
    for (let t = from; t + WINDOW_SEC <= to; t += WINDOW_SEC) {
        const level = db(meanPower(power, hopSec, t, t + WINDOW_SEC))
        windows++
        if (level > loudDb - PLAYING_MARGIN_DB) playing++
        if (level < loudDb - PAUSE_MARGIN_DB) quiet++
        else {
            if (quiet >= 2) pauses++
            quiet = 0
        }
    }
    if (quiet >= 2) pauses++
    const duty = windows ? playing / windows : 0
    const articulation: Articulation = duty < 0.1 ? 'still' : pauses === 0 && duty > 0.85 ? 'sustained' : pauses >= 1 ? 'hits' : 'partial'
    return {duty, pauses, articulation, relDb: db(meanPower(power, hopSec, from, to)) - loudDb}
}

/** A stem's own playing level: its loud bars (the 95th percentile of the level of each bar) over the whole song, in dB. */
export function stemLoudDb(power: number[], hopSec: number, edges: number[]): number {
    return percentile(
        Array.from({length: edges.length - 1}, (_, i) => db(meanPower(power, hopSec, edges[i]!, edges[i + 1]!))),
        0.95,
    )
}

/** The stem above its own usual level while every other one is not (by LEAD_MARGIN_DB or more): it carries the part. `rel`: each stem's relDb. */
export function leadOf(rel: Record<string, number>): string | undefined {
    const ranked = Object.entries(rel).sort((a, b) => b[1] - a[1])
    const [best, second] = ranked
    return best && best[1] > LEAD_MIN_DB && (!second || best[1] - second[1] >= LEAD_MARGIN_DB) ? best[0] : undefined
}

export function instrumentParts(input: PartsInput): InstrumentGap[] {
    const {downbeats, durationSec, barEnergy, hopSec} = input
    if (downbeats.length < 2 || barEnergy.length < downbeats.length) return []
    const edges = [...downbeats, durationSec]
    const thirds: [number, number] = [percentile(barEnergy, 0.33), percentile(barEnergy, 0.66)]
    // each stem's own playing level: its loud bars over the whole song
    const loud: Record<string, number> = {}
    for (const [stem, power] of Object.entries(input.stems)) loud[stem] = stemLoudDb(power, hopSec, edges)
    return vocalGapBars(input, edges).map(([from, to]) => {
        const parts = partRuns(barEnergy, edges, from, to, thirds, input.minPartSec ?? MIN_PART_SEC).map((run): SongPart => {
            const start = edges[run.from]!,
                end = edges[run.to]!
            const stems = Object.entries(input.stems).map(([stem, power]): PartStem => {
                const {relDb, duty, pauses, articulation} = howStemPlays(power, hopSec, loud[stem]!, start, end)
                return {stem, relDb: round(relDb), duty: round(duty), pauses, articulation}
            })
            const leads = leadOf(Object.fromEntries(stems.map(s => [s.stem, s.relDb])))
            const energy = barEnergy.slice(run.from, run.to).reduce((a, b) => a + b, 0) / (run.to - run.from)
            return {start: round(start), end: round(end), energy: round(energy), level: run.level, stems, ...(leads ? {leads} : {})}
        })
        return {start: round(edges[from]!), end: round(edges[to]!), parts}
    })
}
