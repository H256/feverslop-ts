<script setup lang="ts">
import CalloutBox from './CalloutBox.vue'
/** The loading and the failure of a page's data: loading only until there is something, a failure with a way to ask again. */
defineProps<{loading: boolean; error: string; loaded: boolean}>()
defineEmits<{retry: []}>()
</script>

<template>
  <div v-if="loading && !loaded" class="boot" role="status">Loading…</div>
  <CalloutBox v-else-if="error" role="alert" kind="error" as="div" class="btn-row">
    <span>{{ loaded ? `Could not refresh: ${error}` : error }}</span>
    <button class="btn" @click="$emit('retry')">Retry</button>
  </CalloutBox>
</template>
