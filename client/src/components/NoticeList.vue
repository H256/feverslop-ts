<script setup lang="ts">
import CalloutBox from './CalloutBox.vue'
/** What is wrong (errors) and what to look at (warnings), one box each. */
withDefaults(defineProps<{errors?: string[]; warnings?: string[]}>(), {errors: () => [], warnings: () => []})
</script>

<template>
  <CalloutBox v-for="line in errors" :key="`e:${line}`" kind="error" as="div">{{ line }}</CalloutBox>
  <CalloutBox v-for="line in warnings" :key="`w:${line}`" kind="warn" as="div">{{ line }}</CalloutBox>
</template>
