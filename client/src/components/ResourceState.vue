<script setup lang="ts">
defineProps<{loading: boolean, error: string}>()
defineEmits<{retry: []}>()
</script>

<template>
  <p v-if="loading" role="status">Loading…</p>
  <div v-else-if="error" role="alert" class="error"><p>{{ error }}</p><button @click="$emit('retry')">Retry</button></div>
</template>
