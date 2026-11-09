import {computed, reactive} from 'vue'
import type {ElementKind, LookChange, LookElement, LookField} from '../../../../shared/workspace'
import {sameText} from '../../composables/useDraft'

export const LOOK_FIELDS: {field: LookField; label: string; rows: number}[] = [
  {field: 'look', label: 'Look - what its picture is made from', rows: 4},
  {field: 'description', label: 'Description - what the clip prompts say of it', rows: 3},
  {field: 'anchors', label: 'Background - kept behind the people of every shot here', rows: 2},
  {field: 'layout', label: 'Floor plan - every beat here is staged in it', rows: 3},
]
const keyOf = (element: {kind: ElementKind; id: string}) => `${element.kind}:${element.id}`
type Edit = {kind: ElementKind; id: string} & Partial<Record<LookField, string>>

/**
 * The looks changed on the page, text by text, and those to be written anew by the language model. A changed text keeps every other
 * character's and place's texts; what is written from it is written again for that one only.
 */
export function useLookEdits() {
  const edits = reactive(new Map<string, Edit>())
  const again = reactive(new Set<string>())
  const valueOf = (element: LookElement, field: LookField) => edits.get(keyOf(element))?.[field] ?? element[field] ?? ''
  const set = (element: LookElement, field: LookField, value: string) => {
    const entry: Edit = edits.get(keyOf(element)) ?? {kind: element.kind, id: element.id}
    if (sameText(value, element[field])) delete entry[field]
    else entry[field] = value
    edits.set(keyOf(element), entry)
  }
  const isAgain = (element: LookElement) => again.has(keyOf(element))
  const setAgain = (element: LookElement, on: boolean) => {
    on ? again.add(keyOf(element)) : again.delete(keyOf(element))
  }
  const changed = computed(() => [...edits.values()].filter(edit => Object.keys(edit).length > 2))
  const pending = computed(() =>
    [changed.value.length && `${changed.value.length} ${changed.value.length === 1 ? 'text' : 'texts'} changed`, again.size && `${again.size} to write anew`]
      .filter(Boolean)
      .join(' · '),
  )
  const dirty = computed(() => changed.value.length > 0 || again.size > 0)
  const change = (): LookChange => ({
    elements: changed.value,
    again: [...again].map(key => ({kind: key.slice(0, key.indexOf(':')) as ElementKind, id: key.slice(key.indexOf(':') + 1)})),
  })
  const clear = () => {
    edits.clear()
    again.clear()
  }
  return {valueOf, set, isAgain, setAgain, pending, dirty, change, clear}
}
export type LookEdits = ReturnType<typeof useLookEdits>
