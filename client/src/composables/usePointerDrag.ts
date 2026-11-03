import {onScopeDispose} from 'vue'

/**
 * A drag followed on the window, so that it goes on outside the element. It ends with the button let go, with a cancelled pointer (a
 * touch taken over by the browser) and with the component that started it: no listener outlives the page it changes.
 */
export function usePointerDrag() {
  let stop: (() => void) | undefined
  /** `done` is told whether the drag ended by letting go. */
  const start = (move: (event: PointerEvent) => void, done?: (released: boolean) => void) => {
    stop?.()
    const end = (released: boolean) => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
      removeEventListener('pointercancel', cancel)
      stop = undefined
      done?.(released)
    }
    const up = () => end(true)
    const cancel = () => end(false)
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
    addEventListener('pointercancel', cancel)
    stop = cancel
  }
  onScopeDispose(() => stop?.())
  return start
}
