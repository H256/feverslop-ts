import type {Project, TimedLine} from '../project.ts'
import type {ConfirmedPassage} from '../../shared/timing-refinement.ts'

export const timingLocked = (line: TimedLine) => !!(line.byHand || line.words.some(w => w.anchor || w.joined || w.group))

/** Presence is staged only. The original project is never changed while preparing. */
export function passageInput(original: Project, request: ConfirmedPassage) {
    if (request?.confirmSung !== true || !Number.isInteger(request.line)) throw new Error('Confirm that the selected line is sung.')
    const data = structuredClone(original)
    const all = data.lyricsTiming?.lines ?? []
    const selected = all.find(l => l.line === request.line)
    if (!selected || selected.adlib) throw new Error('Choose a canonical lyric line for passage refinement.')
    if (timingLocked(selected))
        throw new Error('The selected line has protected manual timing, anchors or groups. Retain or reset those edits explicitly first.')
    if (!selected.words.length) throw new Error('Place the selected line roughly before retrying this passage.')
    selected.presenceByHand = true
    delete selected.off
    const canonical = all.filter(l => !l.adlib).sort((a, b) => a.line - b.line)
    const at = canonical.indexOf(selected)
    const present = (l: TimedLine) => !l.off && (l.confidence > 0 || l.presenceByHand || timingLocked(l))
    const lines = [
        ...canonical.slice(0, at).filter(present).slice(-3),
        selected,
        ...canonical
            .slice(at + 1)
            .filter(present)
            .slice(0, 2),
    ]
    if (lines.some(l => !Number.isFinite(l.start) || !Number.isFinite(l.end) || l.end <= l.start || !l.words.length))
        throw new Error('Place the passage and its neighbours roughly before retrying.')
    const start = Math.max(0, Math.min(...lines.map(l => l.start)) - 2)
    const end = Math.min(data.music?.durationSec ?? 0, Math.max(...lines.map(l => l.end)) + 3)
    if (!Number.isFinite(end) || end <= start || end - start > 30) throw new Error('The passage must fit within 30 seconds. Correct its rough placement first.')
    const next = canonical[at + 1]
    const targets = [selected.line, ...(next && present(next) && !timingLocked(next) ? [next.line] : [])]
    return {data, lines, window: {start, end, targets}}
}
