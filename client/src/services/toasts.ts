import {shallowRef} from 'vue'
import {isAbort} from '../api/http'
import {errorText} from '../lib/format'
import {defineService} from './service'

export type Toast = {text: string; bad: boolean; id: number}

/** How many failures are kept at once: the oldest goes when another comes (#940). */
export const MOST_ERRORS = 4
const NOTICE_MS = 3000

/**
 * Short messages at the foot of the page (#940). A notice (it worked) is one at a time and goes after a few seconds. A failure stays
 * until it is closed - a notice that comes after it does not take it away - and goes by itself once what failed worked: `from` names
 * what it came of (a guarded action, a page's data), and `clear(from)` or the next success of that action takes its failure away.
 */
export function createToasts() {
  const notice = shallowRef<Toast>()
  const errors = shallowRef<Toast[]>([])
  const sources = new Map<number, unknown>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let next = 0
  const dismiss = (id: number) => {
    sources.delete(id)
    errors.value = errors.value.filter(e => e.id !== id)
  }
  const clear = (from: unknown) => {
    for (const [id, source] of sources) if (source === from) dismiss(id)
  }
  const show = (text: string, bad = false, from?: unknown) => {
    const toast = {text, bad, id: next++}
    if (!bad) {
      clearTimeout(timer)
      notice.value = toast
      timer = setTimeout(() => {
        if (notice.value === toast) notice.value = undefined
      }, NOTICE_MS)
      return
    }
    // the same failure again is said once, as the newest; from the same source, the newer failure replaces the older
    const kept = errors.value.filter(e => e.text !== text && (from === undefined || sources.get(e.id) !== from))
    for (const e of errors.value) if (!kept.includes(e)) sources.delete(e.id)
    const all = [...kept, toast]
    for (const e of all.slice(0, -MOST_ERRORS)) sources.delete(e.id)
    errors.value = all.slice(-MOST_ERRORS)
    if (from !== undefined) sources.set(toast.id, from)
  }
  /** What went wrong, said - a request that was not wanted any more is not. */
  const fail = (cause: unknown, from?: unknown) => {
    if (!isAbort(cause)) show(errorText(cause), true, from)
  }
  /**
   * For a click handler: its failure is said, never thrown into the void - and taken away when the same action works the next time.
   * The promise is kept, so a caller can wait for the end.
   */
  const guard =
    <A extends unknown[]>(action: (...args: A) => Promise<unknown>) =>
    (...args: A): Promise<void> =>
      // the action is what its failure came of: guarded again for the next click, it is still the same action
      action(...args).then(
        () => clear(action),
        (cause: unknown) => fail(cause, action),
      )
  const dispose = () => clearTimeout(timer)
  return {notice, errors, show, fail, guard, dismiss, clear, dispose}
}
export type Toasts = ReturnType<typeof createToasts>
export const ToastsService = defineService<Toasts>('toasts')
export const useToasts = ToastsService.use
