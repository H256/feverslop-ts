import {computed, reactive, ref, shallowRef, type Ref} from 'vue'
import type {SingingLine, SingingView} from '../../../../shared/workspace'
import {clamp} from '../../lib/format'
import {hueAt} from '../../lib/terms'
import {changeOf, changesOf, partsOfView, singersOf, splitAt, type Part} from './parts'

/**
 * Who sings which line, as changed on the page and not saved yet. The singers of the song come first, in their order: their colours
 * and number keys stay put while lines are changed. What is changed is measured against the reading the draft started from, not
 * against the newest one: lines another hand changed meanwhile are not changes made here.
 */
export function useSingingDraft(view: Ref<SingingView>) {
  const pool = ref<string[]>([])
  const assigned = reactive(new Map<number, Part[]>())
  // the part of a line the number keys go to
  const active = reactive(new Map<number, number>())
  const base = shallowRef(view.value)
  const reset = () => {
    base.value = view.value
    pool.value = [...view.value.singers]
    assigned.clear()
    for (const line of view.value.lines) assigned.set(line.line, partsOfView(line))
    active.clear()
  }
  reset()
  const partsOf = (line: SingingLine) => assigned.get(line.line) ?? partsOfView(line)
  const hueOf = (id: string) => hueAt(Math.max(0, pool.value.indexOf(id)))
  const nameOf = (id: string) => view.value.characters.find(c => c.id === id)?.name ?? id
  const changes = computed(() => changesOf(base.value, partsOf))
  const isChanged = (line: SingingLine) => changes.value.lines.some(l => l.line === line.line)
  const activeOf = (line: SingingLine) => active.get(line.line) ?? 0

  const toggle = (line: SingingLine, id: string, k = activeOf(line)) => {
    const parts = partsOf(line)
    const part = parts[k] ?? parts[0]!
    part.singers.has(id) ? part.singers.delete(id) : part.singers.add(id)
    active.set(line.line, parts.indexOf(part))
  }
  /** Every line of a section sung by one singer - or by none of them, when all were. */
  const toggleAll = (lines: SingingLine[], id: string) => {
    const all = lines.every(l => partsOf(l).every(p => p.singers.has(id)))
    for (const l of lines) for (const p of partsOf(l)) all ? p.singers.delete(id) : p.singers.add(id)
  }
  const split = (line: SingingLine, word: number) => {
    active.set(line.line, splitAt(partsOf(line), word))
  }
  const movePart = (line: SingingLine, by: number) => {
    active.set(line.line, clamp(activeOf(line) + by, 0, partsOf(line).length - 1))
  }
  const addSinger = (id: string) => {
    if (id && !pool.value.includes(id)) pool.value.push(id)
  }
  const lineCount = (id: string) => view.value.lines.filter(l => singersOf(partsOf(l)).has(id)).length
  const request = () => changeOf(changes.value.lines, partsOf)
  return {pool, partsOf, hueOf, nameOf, changes, isChanged, activeOf, toggle, toggleAll, split, movePart, addSinger, lineCount, request, reset}
}
export type SingingDraft = ReturnType<typeof useSingingDraft>
