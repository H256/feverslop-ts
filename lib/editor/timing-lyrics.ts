import {fingerprintOf, type LyricsTiming, type Project} from '../project.ts'
import {slotVocals} from '../lyrics.ts'

/** Extend the source text without re-aligning the song. Promoted ad-libs get canonical
 * lyric IDs; all remaining timing/singer/slot references are remapped together. */
export function updateInsertedLyrics(source: string, before: LyricsTiming, data: Project, edited: number[]) {
    if (data.inputs?.['lyrics.txt'] && data.inputs['lyrics.txt'] !== fingerprintOf(source.trim()))
        throw new Error('lyrics.txt changed outside the timing editor. Reconcile it before adding words.')
    const rows = source.split(/\r?\n/)
    const positions = rows.flatMap((s, i) => (s.trim() && !/^\[.*\]$/.test(s.trim()) ? [i] : []))
    const old = before.lines.filter(l => !l.adlib).sort((a, b) => a.line - b.line)
    if (positions.length !== old.length || old.some((l, n) => l.line !== n || rows[positions[n]!]!.trim() !== l.text))
        throw new Error('lyrics.txt and timed lyric lines disagree. No files were changed.')
    const timing = data.lyricsTiming!
    const current = new Map(timing.lines.map(l => [l.line, l]))
    const items = old.map((l, n) => ({id: l.line, row: positions[n]!, added: false}))
    const promoted = timing.lines.filter(l => l.adlib && edited.includes(l.line))
    for (const l of promoted) {
        const section = old.filter(x => x.sectionIndex === l.sectionIndex)
        if (!section.length) throw new Error('Cannot find the lyric section for this ad-lib')
        const next = section.find(x => x.start > l.start)
        const row = next ? positions[old.indexOf(next)]! : positions[old.indexOf(section.at(-1)!)]! + 1
        items.push({id: l.line, row, added: true})
    }
    items.sort((a, b) => a.row - b.row || Number(b.added) - Number(a.added) || current.get(a.id)!.start - current.get(b.id)!.start)
    const ids = new Map(items.map((item, n) => [item.id, n]))
    const extras = timing.lines.filter(l => l.adlib && !edited.includes(l.line)).sort((a, b) => a.line - b.line)
    extras.forEach((l, n) => ids.set(l.line, items.length + n))
    const output: string[] = []
    for (let row = 0; row <= rows.length; row++) {
        for (const item of items.filter(x => x.added && x.row === row)) output.push(current.get(item.id)!.text)
        if (row < rows.length) {
            const item = items.find(x => !x.added && x.row === row)
            output.push(item ? current.get(item.id)!.text : rows[row]!)
        }
    }
    for (const l of timing.lines) {
        if (l.adlib && edited.includes(l.line)) delete l.adlib
        l.line = ids.get(l.line)!
    }
    for (const l of data.singing?.lines ?? []) l.line = ids.get(l.line) ?? l.line
    for (const slot of data.timeline?.slots ?? []) {
        slot.vocals = slotVocals(slot, timing)
        slot.lyrics = slot.vocals.map(v => v.text)
    }
    const lyrics = output.join(source.includes('\r\n') ? '\r\n' : '\n')
    data.inputs = {...data.inputs, 'lyrics.txt': fingerprintOf(lyrics.trim())}
    return {lyrics, ids, promoted: promoted.length > 0}
}
