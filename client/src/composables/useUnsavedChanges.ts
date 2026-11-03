import {onScopeDispose} from 'vue'
import {onBeforeRouteLeave, onBeforeRouteUpdate, type RouteLocationNormalized} from 'vue-router'
import {useAsk} from '../services/ask'

/**
 * Changes not saved yet are not lost by a click: closing the tab asks the browser's question, leaving the page within the workspace
 * asks ours. A change of the hash alone (another line picked) stays on the page and is not asked about - unless the draft belongs to
 * what the hash picks (hash: true): then another pick loses it too.
 */
export function useUnsavedChanges(dirty: () => boolean, what = 'changes', {hash = false} = {}) {
  const ask = useAsk()
  const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty()) event.preventDefault() }
  addEventListener('beforeunload', beforeUnload)
  onScopeDispose(() => removeEventListener('beforeunload', beforeUnload))
  const guard = async (to: RouteLocationNormalized, from: RouteLocationNormalized) => {
    if ((to.path === from.path && (!hash || to.hash === from.hash)) || !dirty()) return true
    return ask({title: 'Leave without saving?', lines: [`The ${what} on this page are not saved and go.`], confirm: 'Leave', danger: true})
  }
  onBeforeRouteLeave(guard)
  onBeforeRouteUpdate(guard)
}
