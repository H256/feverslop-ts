<script setup lang="ts">
/** A singer as a toggle, in the singer's colour, with the number key that toggles them. `mixed`: some of the lines. */
defineProps<{name: string, number: number, hue: number, pressed: boolean | 'mixed', title: string}>()
defineEmits<{toggle: []}>()
</script>

<template>
  <button class="sing" :style="{'--h': hue}" :aria-pressed="pressed" :title="title" tabindex="-1" @click="$emit('toggle')"><i>{{ number }}</i>{{ name.split(/\s+/)[0] }}</button>
</template>
