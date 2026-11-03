import {computed, ref, watch} from 'vue'

/** The same text but for the spaces around it: what counts as a change. */
export const sameText = (a: string | undefined, b: string | undefined) => (a ?? '').trim() === (b ?? '').trim()

/**
 * A text being changed on the page, next to the saved one it started from. A new saved text is taken over only while nothing is
 * changed: polling and a finished run never overwrite what someone is typing.
 */
export function useDraft(saved: () => string | undefined) {
  const text = ref(saved() ?? '')
  const dirty = computed(() => !sameText(text.value, saved()))
  watch(saved, (now, before) => { if (sameText(text.value, before)) text.value = now ?? '' })
  const reset = () => { text.value = saved() ?? '' }
  return {text, dirty, reset}
}
