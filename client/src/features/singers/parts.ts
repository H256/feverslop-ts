import type {SingingChange, SingingLine, SingingPart, SingingView} from '../../../../shared/workspace'

/**
 * Who sings a line, as parts: one part from word 0 when the singer does not change within it, else one per change of singer
 * (lib/singing-parts.ts). Pure functions over the page's working copy; the Vue state is in useSingingDraft.
 */
export type Part = {from: number; singers: Set<string>}

export const partsOfView = (line: SingingLine): Part[] =>
  (line.parts ?? [{from: 0, singers: line.singers}]).map(p => ({from: p.from, singers: new Set(p.singers)}))
export const singersOf = (parts: Part[]) => new Set(parts.flatMap(p => [...p.singers]))

/** As the server keeps them: neighbours with the same singers are one part, and the first starts at word 0. */
export function kept(parts: Part[]): SingingPart[] {
  const out: SingingPart[] = []
  for (const p of parts) {
    const ids = [...p.singers].sort()
    if (out.length && out.at(-1)!.singers.join() === ids.join()) continue
    out.push({from: out.length ? p.from : 0, singers: ids})
  }
  return out
}
export const sameParts = (a: Part[], b: Part[]) => JSON.stringify(kept(a)) === JSON.stringify(kept(b))
export const describe = (parts: Part[], nameOf: (id: string) => string) => parts.map(p => [...p.singers].map(nameOf).join(' + ')).join(' / ')

/** A click between two words: the singer changes there - or, on a change that is there, it is taken back. The part to go on with. */
export function splitAt(parts: Part[], word: number): number {
  const at = parts.findIndex(p => p.from === word)
  if (at > 0) {
    parts.splice(at, 1)
    return at - 1
  }
  const k = parts.findLastIndex(p => p.from < word)
  parts.splice(k + 1, 0, {from: word, singers: new Set(parts[k]!.singers)})
  return k + 1
}

/** Where part k of a line is sung: the whole line when it is one part, else from its first word to its last. */
export function spanOf(line: SingingLine, parts: Part[], k: number) {
  if (parts.length < 2 || !line.words.length) return {start: line.start, end: line.end}
  const last = (parts[k + 1]?.from ?? line.words.length) - 1
  return {start: line.words[parts[k]!.from]?.start, end: line.words[last]?.end}
}
/** The words of part k of a line. */
export const partText = (line: SingingLine, parts: Part[], k: number) =>
  line.words
    .slice(parts[k]!.from, parts[k + 1]?.from ?? line.words.length)
    .map(w => w.text)
    .join(' ')

/** What saving the changed lines does, worked out as the server does it: the beats planned again, the clips that go stale. */
export function changesOf(view: SingingView, partsOf: (line: SingingLine) => Part[]) {
  const lines = view.lines.filter(l => !sameParts(partsOf(l), partsOfView(l)))
  const beats = [...new Set(lines.flatMap(l => l.beats))]
  const beatOf = (id: string) => view.beats.find(b => b.id === id)
  const added: {beat: string; id: string}[] = []
  for (const beat of beats) {
    const here = new Set(lines.filter(l => l.beats.includes(beat)).flatMap(l => [...singersOf(partsOf(l))]))
    for (const id of here) if (!beatOf(beat)?.characterIds.includes(id)) added.push({beat, id})
  }
  // a new singer, or one who no longer sings, changes every clip they are in: a silent singer keeps the mouth closed there
  const used = new Set(view.lines.flatMap(l => [...singersOf(partsOf(l))]))
  const newSingers = [...used].filter(id => !view.singers.includes(id))
  const formerSingers = view.singers.filter(id => !used.has(id))
  const clipsOf = (id: string) => view.characters.find(ch => ch.id === id)?.clips ?? []
  return {
    lines,
    beats,
    added,
    newSingers,
    formerSingers,
    replanned: beats.filter(b => beatOf(b)?.planned),
    clips: [...new Set([...beats.flatMap(b => beatOf(b)?.clips ?? []), ...[...newSingers, ...formerSingers].flatMap(clipsOf)])].sort(),
    empty: view.lines.filter(l => partsOf(l).some(p => !p.singers.size)),
    unplaced: lines.filter(l => !l.beats.length),
  }
}
export type SingingChanges = ReturnType<typeof changesOf>

/** The request for the changed lines: parts only where the singer changes within a line. */
export const changeOf = (lines: SingingLine[], partsOf: (line: SingingLine) => Part[]): SingingChange => ({
  lines: lines.map(l => {
    const parts = kept(partsOf(l))
    return parts.length > 1 ? {line: l.line, singers: [...singersOf(partsOf(l))], parts} : {line: l.line, singers: parts[0]!.singers}
  }),
})

/** The lines in their sections, in the order of the song. */
export function sectionsOf(lines: SingingLine[]) {
  const sections: {name: string; lines: SingingLine[]}[] = []
  for (const line of lines) {
    const name = line.section ?? ''
    if (!sections.length || sections.at(-1)!.name !== name) sections.push({name, lines: []})
    sections.at(-1)!.lines.push(line)
  }
  return sections
}
