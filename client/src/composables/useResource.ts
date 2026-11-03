import {onScopeDispose, ref, shallowRef} from 'vue'

/** Own one request lifecycle. Replacing a request cannot publish an older result. */
export function useResource<T>(load: (signal: AbortSignal) => Promise<T>) {
  const data = shallowRef<T>()
  const error = ref('')
  const loading = ref(false)
  let current: AbortController | undefined
  async function reload() {
    current?.abort()
    const controller = current = new AbortController()
    loading.value = true
    error.value = ''
    try {
      const result = await load(controller.signal)
      if (!controller.signal.aborted) data.value = result
    } catch (cause) {
      if (!controller.signal.aborted) error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      if (current === controller) loading.value = false
    }
  }
  onScopeDispose(() => current?.abort())
  void reload()
  return {data, error, loading, reload}
}
