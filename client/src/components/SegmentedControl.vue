<script setup lang="ts" generic="T extends string">
/** A choice of one among few, as pressed buttons. */
defineProps<{options: readonly {value: T, label: string}[], label: string}>()
const model = defineModel<T>({required: true})
</script>

<template>
  <div class="seg" role="group" :aria-label="label">
    <button v-for="option in options" :key="option.value" :aria-pressed="model === option.value" @click="model = option.value">{{ option.label }}</button>
  </div>
</template>
