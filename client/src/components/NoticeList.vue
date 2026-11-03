<script setup lang="ts">
/** What is wrong (errors) and what to look at (warnings), one box each. */
withDefaults(defineProps<{errors?: string[], warnings?: string[]}>(), {errors: () => [], warnings: () => []})
</script>

<template>
  <div v-for="line in errors" :key="`e:${line}`" class="warn bad">{{ line }}</div>
  <div v-for="line in warnings" :key="`w:${line}`" class="warn">{{ line }}</div>
</template>
