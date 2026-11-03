import {onScopeDispose, ref, shallowRef} from 'vue'
import {isAbort} from '../api/http'
import {errorText} from '../lib/format'

/**
 * One request lifecycle. A newer request cancels the older one, which can then not publish its result; what was loaded stays when a
 * later load fails - the page keeps what it has and says what went wrong.
 */
export function useResource<T>(load: (signal: AbortSignal) => Promise<T>, {immediate = true} = {}) {
  const data = shallowRef<T>()
  const error = ref('')
  const loading = ref(false)
  let current: AbortController | undefined
  async function reload() {
    current?.abort()
    const controller = current = new AbortController()
    loading.value = true
    try {
      const result = await load(controller.signal)
      if (controller.signal.aborted) return
      data.value = result
      error.value = ''
    } catch (cause) {
      if (!controller.signal.aborted && !isAbort(cause)) error.value = errorText(cause)
    } finally {
      if (current === controller) loading.value = false
    }
  }
  onScopeDispose(() => current?.abort())
  if (immediate) void reload()
  return {data, error, loading, reload}
}
