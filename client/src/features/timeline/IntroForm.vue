<script setup lang="ts">
import FormField from '../../components/FormField.vue'
import type {IntroDraft} from './forms'
import KeepSettings from './KeepSettings.vue'

/** The fields of an intro, filled into the caller's reactive draft - the question reads it when it is answered. */
defineProps<{draft: IntroDraft, finals: {file: string, label: string}[], found?: string}>()
</script>

<template>
  <div>
    <FormField label="From">
      <select v-model="draft.from"><option v-for="final in finals" :key="final.file" :value="final.file">{{ final.label }} ({{ final.file }})</option></select>
    </FormField>
    <FormField label="Intro (path, absolute or relative to the project)">
      <input v-model="draft.file" type="text" :placeholder="found ? `${found} of this project` : 'D:/videos/channel-intro.mp4'">
    </FormField>
    <FormField label="Fade into the video (seconds, 0 = a hard cut)">
      <input v-model.number="draft.fade" type="number" min="0" max="10" step="0.25" required>
    </FormField>
    <KeepSettings :draft="draft" />
  </div>
</template>
