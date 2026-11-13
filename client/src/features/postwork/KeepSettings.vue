<script setup lang="ts">
import FormField from '../../components/FormField.vue'
/** Whether the options of a post-work step are kept as well: for this project (config.json), for every project (the settings file). */
defineProps<{draft: {save: boolean; saveDefault: boolean}}>()
</script>

<template>
  <div>
    <FormField label="Keep these settings for this project (config.json)" check><input v-model="draft.save" type="checkbox" /></FormField>
    <FormField label="Keep them for every project (the settings file)" check><input v-model="draft.saveDefault" type="checkbox" /></FormField>
  </div>
</template>
