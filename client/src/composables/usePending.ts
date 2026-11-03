import {ref} from 'vue'

/**
 * A change being saved. The page is not to be changed meanwhile (bind `inert` to `pending`): what the save sent is what is reset after
 * it, and a change made during it would be reset with it, never saved.
 */
export function usePending() {
  const pending = ref(false)
  const during = async <T>(work: () => Promise<T>): Promise<T> => {
    pending.value = true
    try {
      return await work()
    } finally {
      pending.value = false
    }
  }
  return {pending, during}
}
