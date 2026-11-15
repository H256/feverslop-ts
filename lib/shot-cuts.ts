import {round} from './frames.ts'

// Where the shots of a clip are cut (#968). On the downbeats, more of them with more energy - and where the band of the beat breaks off
// or comes back inside the clip, a cut there too: the quiet gets a shot of its own. One shot that runs from the playing into the quiet
// was rendered playing all through it, whatever its prompt said of the times (tides 2:42, an A/B of three prompts: only the one with
// the quiet in its own shot showed the guitar still); a cut gives the change its own picture.

type Span = {start: number; end: number}

/** A pause of the band shorter than this is no break - a beat between two phrases, a hit; those stay in their shot. */
export const MIN_BREAK = 1.5
/** No shot shorter than this: a cut that would make one is left out. */
export const MIN_SHOT = 1.2
/** A break is cut on the downbeat nearest to it, when there is one this close - else on the break itself. */
const SNAP = 0.6

/**
 * When the whole band is silent for at least MIN_BREAK: the gaps between the ranges in which any of `instruments` is heard (each
 * one's activity, as step propActivity found it). Silence before the first and after the last range counts as well - the band
 * coming in, the band ending. Empty without instruments.
 */
export function bandBreaks(instruments: Span[][], songEnd: number): Span[] {
    const ranges = instruments.flat().sort((a, b) => a.start - b.start)
    if (!ranges.length) return []
    const breaks: Span[] = []
    let heardUntil = 0
    for (const r of ranges) {
        if (r.start - heardUntil >= MIN_BREAK) breaks.push({start: heardUntil, end: r.start})
        heardUntil = Math.max(heardUntil, r.end)
    }
    if (songEnd - heardUntil >= MIN_BREAK) breaks.push({start: heardUntil, end: songEnd})
    return breaks
}

/** The cuts on the downbeats alone: `count` shots, cut on the bars spread over the slot (the clip's start is 0). */
export function barCuts(slot: Span & {bars: number}, count: number, downbeats: number[]): number[] {
    const bars = downbeats.filter(t => t >= slot.start - 0.05 && t < slot.end - 0.05)
    return Array.from({length: count}, (_, j) =>
        j === 0 ? 0 : round((bars[Math.floor((j * slot.bars) / count)] ?? slot.start + ((slot.end - slot.start) * j) / count) - slot.start),
    )
}

/**
 * The cuts that belong to a break of the band: where one begins or ends inside the clip, on the nearest downbeat, in the clip's own time.
 * Nothing else may move them (#982): a sung word that crosses one is no reason to cut the quiet away from its break.
 */
export function breakChanges(slot: Span, downbeats: number[], breaks: Span[]): number[] {
    const duration = slot.end - slot.start
    const inside = (t: number) => t >= MIN_SHOT && t <= duration - MIN_SHOT
    const snap = (t: number) => {
        const near = downbeats.reduce<number | undefined>(
            (best, d) => (Math.abs(d - t) <= SNAP && (best === undefined || Math.abs(d - t) < Math.abs(best - t)) ? d : best),
            undefined,
        )
        return round((near ?? t) - slot.start)
    }
    return breaks
        .filter(b => b.end > slot.start && b.start < slot.end)
        .flatMap(b => [b.start, b.end])
        .map(snap)
        .filter(inside)
}

/**
 * The cuts of a clip, in its own time: those on the bars (barCuts), and one where a break of the band begins or ends inside it -
 * on the nearest downbeat. A cut on the bars inside a break goes: the quiet is one shot. No shot is shorter than MIN_SHOT.
 */
export function shotCuts(slot: Span & {bars: number}, count: number, downbeats: number[], breaks: Span[]): number[] {
    const onBars = barCuts(slot, count, downbeats)
    const changes = breakChanges(slot, downbeats, breaks)
    if (!changes.length) return onBars
    const quiet = (t: number) => breaks.some(b => slot.start + t > b.start && slot.start + t < b.end)
    const kept = onBars.filter(t => t > 0 && !quiet(t) && changes.every(c => Math.abs(c - t) >= MIN_SHOT))
    const cuts = [...new Set([...changes, ...kept])].sort((a, b) => a - b)
    // two changes closer than a shot (a short break near the clip's edge): the later one goes
    return cuts.reduce<number[]>((out, t) => (t - out[out.length - 1]! >= MIN_SHOT ? [...out, t] : out), [0])
}
