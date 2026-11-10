import {reactive, watch} from 'vue'

/**
 * Which parts of the timeline page are shown (#772): the player and every lane but the clips can be hidden, for room. Kept per
 * browser - a viewer's own arrangement, nothing a project depends on.
 */
export type LaneKey = 'player' | 'groups' | 'beats' | 'wave' | 'lines' | 'cast'
const KEY = 'timeline.lanes'
const read = (): Partial<Record<LaneKey, boolean>> => {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown
    return kept && typeof kept === 'object' ? (kept as Partial<Record<LaneKey, boolean>>) : {}
  } catch {
    return {}
  }
}
export const lanes = reactive<Record<LaneKey, boolean>>({player: true, groups: true, beats: true, wave: true, lines: true, cast: true, ...read()})
watch(lanes, now => {
  try {
    localStorage.setItem(KEY, JSON.stringify(now))
  } catch {
    // kept for this visit only
  }
})
