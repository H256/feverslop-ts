<script setup lang="ts">
import type {Viewed} from '../services/viewer'
import ModalDialog from './ModalDialog.vue'

defineProps<{shown: Viewed}>()
defineEmits<{close: []}>()
</script>

<template>
  <ModalDialog class="viewer" :label="shown.caption" backdrop-closes @close="$emit('close')">
    <form method="dialog"><button aria-label="Close">✕</button></form>
    <img :src="shown.src" :alt="shown.alt" />
    <div class="caption">
      <b>{{ shown.caption }}</b>
      <p v-if="shown.text">{{ shown.text }}</p>
    </div>
  </ModalDialog>
</template>
