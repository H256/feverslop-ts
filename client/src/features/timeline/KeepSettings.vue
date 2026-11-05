<script setup lang="ts">
/** Whether the options of a post-work step are kept as well: for this project (config.json), for every project (the settings file). */
defineProps<{draft: {save: boolean, saveDefault: boolean}}>()
</script>

<template>
  <div>
    <label class="field" style="display: flex; gap: 8px"><input v-model="draft.save" type="checkbox"><span style="margin: 0">Keep these settings for this project (config.json)</span></label>
    <label class="field" style="display: flex; gap: 8px"><input v-model="draft.saveDefault" type="checkbox"><span style="margin: 0">Keep them for every project (the settings file)</span></label>
  </div>
</template>
