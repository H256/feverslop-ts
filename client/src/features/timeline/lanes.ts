import {reactive, watch} from 'vue'
import {viewerStore} from '../../lib/browser-store'
import {defineService} from '../../services/service'

/**
 * Which parts of the timeline page are shown (#772): the player and every lane but the clips can be hidden, for room. Kept per
 * browser - a viewer's own arrangement, nothing a project depends on. Made by the timeline page and handed down to what is on it (a
 * service, not a module-wide object: its watcher ends with the page, #1007).
 */
// board: the storyboard (#1194) in the place of the monitor - large cards of the clips under their beats
export type LaneKey = 'player' | 'board' | 'groups' | 'beats' | 'wave' | 'lines' | 'cast'
export type Lanes = Record<LaneKey, boolean>
const KEY = 'timeline.lanes'
const read = (): Partial<Lanes> => {
  try {
    const kept = JSON.parse(viewerStore.get(KEY) ?? '{}') as unknown
    return kept && typeof kept === 'object' ? (kept as Partial<Lanes>) : {}
  } catch {
    return {}
  }
}

/** The lanes as the viewer left them, written back when one is toggled; call it in a component's setup. */
export function makeLanes(): Lanes {
  const lanes = reactive<Lanes>({player: true, board: false, groups: true, beats: true, wave: true, lines: true, cast: true, ...read()})
  watch(lanes, now => viewerStore.set(KEY, JSON.stringify(now)))
  return lanes
}

export const lanesService = defineService<Lanes>('lanes')
