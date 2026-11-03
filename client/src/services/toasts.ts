import {shallowRef} from 'vue'
import {isAbort} from '../api/http'
import {errorText} from '../lib/format'
import {defineService} from './service'

export type Toast = {text: string, bad: boolean, id: number}

/** One short message at a time, at the foot of the page. */
export function createToasts() {
  const current = shallowRef<Toast>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let next = 0
  const show = (text: string, bad = false) => {
    clearTimeout(timer)
    const toast = {text, bad, id: next++}
    current.value = toast
    timer = setTimeout(() => { if (current.value === toast) current.value = undefined }, bad ? 7000 : 3000)
  }
  /** What went wrong, said - a request that was not wanted any more is not. */
  const fail = (cause: unknown) => { if (!isAbort(cause)) show(errorText(cause), true) }
  /** For a click handler: its failure is said, never thrown into the void. */
  const guard = <A extends unknown[]>(action: (...args: A) => Promise<unknown>) => (...args: A) => { action(...args).catch(fail) }
  const dispose = () => clearTimeout(timer)
  return {current, show, fail, guard, dispose}
}
export type Toasts = ReturnType<typeof createToasts>
export const ToastsService = defineService<Toasts>('toasts')
export const useToasts = ToastsService.use
