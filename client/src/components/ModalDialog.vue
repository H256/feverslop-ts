<script setup lang="ts">
import {onMounted, ref} from 'vue'

/**
 * A native modal <dialog>, open for as long as it is mounted: focus is trapped and Escape cancels, as the browser does it. A media
 * element in it is paused when it closes. While it is locked (its work under way) Escape does nothing.
 */
const props = defineProps<{label?: string; backdropCloses?: boolean; locked?: boolean}>()
const emit = defineEmits<{close: []}>()
const dialog = ref<HTMLDialogElement>()
onMounted(() => dialog.value?.showModal())
const closed = () => {
  for (const media of dialog.value?.querySelectorAll('video, audio') ?? []) (media as HTMLMediaElement).pause()
  emit('close')
}
const clicked = (event: MouseEvent) => {
  if (props.backdropCloses && event.target === dialog.value) dialog.value?.close()
}
defineExpose({close: () => dialog.value?.close()})
</script>

<template>
  <dialog
    ref="dialog"
    :aria-label="label"
    @close="closed"
    @cancel="
      event => {
        if (locked) event.preventDefault()
      }
    "
    @click="clicked"
  >
    <slot />
  </dialog>
</template>
