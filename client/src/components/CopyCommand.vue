<script setup lang="ts">
import {computed, onScopeDispose, ref} from 'vue'
import AppIcon from './AppIcon.vue'

/** A command for the terminal, to copy. It breaks between its words, not at the dashes of an option. */
const props = defineProps<{command: string}>()
const words = computed(() => props.command.split(' '))
const copied = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
const copy = async () => {
  await navigator.clipboard.writeText(props.command)
  copied.value = true
  clearTimeout(timer)
  timer = setTimeout(() => {
    copied.value = false
  }, 1200)
}
onScopeDispose(() => clearTimeout(timer))
</script>

<template>
  <div class="cmd">
    <code
      ><template v-for="(word, n) in words" :key="n"
        >{{ n ? ' ' : '' }}<span class="u-inline">{{ word }}</span></template
      ></code
    >
    <button title="Copy" aria-label="Copy" @click="copy"><template v-if="copied">✓</template><AppIcon v-else name="copy" /></button>
  </div>
</template>
