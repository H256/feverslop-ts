import {onScopeDispose, ref, shallowRef} from 'vue'
import {isAbort} from '../api/http'
import {errorText} from '../lib/format'

/**
 * One request lifecycle. A newer request cancels the older one, which can then not publish its result; what was loaded stays when a
 * later load fails - the page keeps what it has and says what went wrong. reload() tells whether this load is what the page shows now.
 */
export function useResource<T>(load: (signal: AbortSignal) => Promise<T>, {immediate = true} = {}) {
  const data = shallowRef<T>()
  const error = ref('')
  const loading = ref(false)
  let current: AbortController | undefined
  async function reload(): Promise<boolean> {
    current?.abort()
    const controller = (current = new AbortController())
    loading.value = true
    try {
      const result = await load(controller.signal)
      if (controller.signal.aborted) return false
      data.value = result
      error.value = ''
      return true
    } catch (cause) {
      if (!controller.signal.aborted && !isAbort(cause)) error.value = errorText(cause)
      return false
    } finally {
      if (current === controller) loading.value = false
    }
  }
  onScopeDispose(() => current?.abort())
  if (immediate) void reload()
  return {data, error, loading, reload}
}
