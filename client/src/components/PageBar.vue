<script setup lang="ts">
/** The head of a page or a section: its title, and what belongs next to it. */
defineProps<{title: string}>()
</script>

<template>
  <div class="pagebar">
    <h2>{{ title }}</h2>
    <slot />
  </div>
</template>
