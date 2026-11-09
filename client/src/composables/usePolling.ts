import {onScopeDispose} from 'vue'

/**
 * Asks again every `ms` while the page is visible, and when the window comes back. One at a time: a slow answer is not overtaken by
 * the next question.
 */
export function usePolling(work: () => Promise<unknown>, ms: number, {onFocus = true} = {}) {
  let busy = false
  const tick = async () => {
    if (busy || document.hidden) return
    busy = true
    try {
      await work()
    } catch {
    } finally {
      busy = false
    }
  }
  const timer = setInterval(tick, ms)
  const focus = () => {
    void tick()
  }
  if (onFocus) addEventListener('focus', focus)
  onScopeDispose(() => {
    clearInterval(timer)
    removeEventListener('focus', focus)
  })
  return {tick}
}
