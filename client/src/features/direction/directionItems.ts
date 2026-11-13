import type {DirectionEdit, DirectionRule, DirectionScope, DirectionView} from '../../../../shared/direction'
import {SHOT_FIELDS, shotField} from '../../../../shared/direction'
import {withNames} from '../../lib/format'

// The list of the Direction page as plain functions (#839): its items from the view, the filter, the groups, and the words for a
// scope, an edit and a change of a shot. The page and its tests use the same ones.

type Name = (id: string) => string

export type Item = {
  key: string
  rule?: DirectionRule
  edit?: DirectionEdit
  scope: DirectionScope
  text: string
  issues: string[]
  planned: boolean
  /** made for shots planned again since: nothing to decide but clearing it (or, for an instruction, keeping it for the new shot) */
  leftover: boolean
  /** left open for the preview to write: someone brought in with nothing to do, words that still name someone taken out */
  writes: boolean
}
export type Group = {key: string; title: string; label?: string; order: number; general: Item[]; shots: {id: string; items: Item[]}[]}

/** Two scopes are the same scope. */
export const sameScope = (a: DirectionScope, b: DirectionScope) =>
  a.kind === b.kind && (a.kind === 'time' ? b.kind === 'time' && a.start === b.start && a.end === b.end : !('id' in a) || ('id' in b && a.id === b.id))

export const scopeText = (s: DirectionScope) => (s.kind === 'global' ? 'Whole project' : s.kind === 'time' ? `${s.start}–${s.end} s` : `${s.kind}: ${s.id}`)
export const describeEdit = (e: DirectionEdit, name: Name) =>
  e.remove ? `${name(e.remove)} is not in the picture` : e.add ? `${name(e.add)} is in the picture` : `the shot is ${e.size}`
/** "beat-06:shot2" -> "beat-06"; a beat or scene id stays. */
export const shotGroup = (id: string) => (id.lastIndexOf(':shot') > 0 ? id.slice(0, id.lastIndexOf(':shot')) : id)
export const shotNumber = (id: string) => Number(id.slice(id.lastIndexOf(':shot') + 5)) || 0

/** A shot before or after a change, readable: its fields and, for each person, theirs - pose and motion included. */
export function describeShot(data: Record<string, unknown>, name: Name): string {
  const fields = (obj: Record<string, unknown>) =>
    Object.entries(obj)
      .filter(([key]) => key in SHOT_FIELDS)
      .map(([key, value]) => `${shotField(key)}: ${Array.isArray(value) ? value.map(String).map(name).join(', ') : String(value)}`)
  const lines = fields(data)
  if (data.people && typeof data.people === 'object')
    for (const [id, person] of Object.entries(data.people))
      lines.push(
        `${name(id)}\n${fields(person as Record<string, unknown>)
          .map(s => `  ${s}`)
          .join('\n')}`,
      )
  return lines.join('\n')
}

/** Every instruction and edit of the view as an item of the list. */
export function itemsOf(v: DirectionView, name: Name): Item[] {
  return [
    ...v.rules.map(rule => ({
      key: `r:${rule.id}`,
      rule,
      scope: rule.scope,
      text: rule.text,
      issues: [v.unresolved.find(r => r.ruleId === rule.id)?.message].filter((m): m is string => !!m),
      planned: !!rule.planned,
      leftover: !!rule.binding && !!v.unresolved.find(u => u.ruleId === rule.id)?.stale,
      writes: false,
    })),
    ...v.edits.map(edit => ({
      key: `e:${edit.id}`,
      edit,
      scope: edit.scope,
      text: describeEdit(edit, name),
      issues: v.editIssues.filter(i => i.editId === edit.id).map(i => i.message),
      planned: false,
      leftover: v.editIssues.some(i => i.editId === edit.id && i.stale),
      writes: v.editIssues.some(i => i.editId === edit.id && i.mentions),
    })),
  ]
}

const about = (item: Item) => [item.rule?.characterId, item.edit?.remove, item.edit?.add, item.scope.kind === 'character' ? item.scope.id : undefined]
/** The items with these words (in the text or the scope) and about this character - by id, or by name in the text. */
export function filterItems(items: Item[], words: string, who: string, name: Name): Item[] {
  const wanted = words.trim().toLowerCase()
  return items.filter(
    item =>
      (!wanted || `${item.text} ${scopeText(item.scope)}`.toLowerCase().includes(wanted)) &&
      (!who || about(item).includes(who) || item.text.includes(name(who))),
  )
}

/**
 * The list (#783): everything by what it is about - the whole video, a character, a stretch of the song, then beat by beat (scene by
 * scene) in the order of the plan, and in it shot by shot. Leftovers and items to decide are listed apart, not here.
 */
export function groupItems(items: Item[], v: Pick<DirectionView, 'groups'>, name: Name): Group[] {
  const groups = new Map<string, Group>()
  const order = new Map(v.groups.map((g, n) => [g.id, n]))
  const groupFor = (scope: DirectionScope): Group => {
    const [key, title, label, rank] =
      scope.kind === 'global'
        ? ['~global', 'Whole video', undefined, -3]
        : scope.kind === 'character'
          ? [`~character:${scope.id}`, `${name(scope.id)}, throughout`, undefined, -2]
          : scope.kind === 'time'
            ? [`~time:${scope.start}-${scope.end}`, `${scope.start}–${scope.end} s of the song`, undefined, -1]
            : (() => {
                const id = scope.kind === 'shot' ? shotGroup(scope.id) : scope.id
                return [id, id, v.groups.find(g => g.id === id)?.label, order.get(id) ?? 9999] as const
              })()
    if (!groups.has(key)) groups.set(key, {key, title, label, order: rank, general: [], shots: []})
    return groups.get(key)!
  }
  for (const item of items.filter(item => !item.leftover && (!item.issues.length || item.writes))) {
    const group = groupFor(item.scope)
    if (item.scope.kind !== 'shot') group.general.push(item)
    else {
      const shotId = item.scope.id
      let shot = group.shots.find(s => s.id === shotId)
      if (!shot) group.shots.push((shot = {id: shotId, items: []}))
      shot.items.push(item)
    }
  }
  for (const group of groups.values()) group.shots.sort((a, b) => shotNumber(a.id) - shotNumber(b.id))
  return [...groups.values()].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key))
}

/** A change of one shot, field by field - only what changed, the shot's fields first, then each person's. */
export function shotDiff(before: Record<string, unknown>, after: Record<string, unknown>, name: Name) {
  const show = (value: unknown) =>
    Array.isArray(value)
      ? value.map(v => name(String(v))).join(', ')
      : value === undefined
        ? '—'
        : typeof value === 'string'
          ? withNames(value)
          : (JSON.stringify(value) ?? '')
  const rows: {label: string; before: string; after: string}[] = []
  const compare = (prefix: string, a: Record<string, unknown>, b: Record<string, unknown>) => {
    for (const key of Object.keys(SHOT_FIELDS))
      if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) rows.push({label: `${prefix}${shotField(key)}`, before: show(a[key]), after: show(b[key])})
  }
  compare('', before, after)
  const bp = (before.people ?? {}) as Record<string, Record<string, unknown>>
  const ap = (after.people ?? {}) as Record<string, Record<string, unknown>>
  for (const id of new Set([...Object.keys(bp), ...Object.keys(ap)])) compare(`${name(id)} · `, bp[id] ?? {}, ap[id] ?? {})
  return rows
}
