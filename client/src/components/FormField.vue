<script setup lang="ts">
/** A labelled field: the label above, the input in the slot. */
defineProps<{label: string}>()
</script>

<template>
  <label class="field"><span>{{ label }}</span><slot /></label>
</template>
