<script setup lang="ts">
import {computed} from 'vue'
import type {LibraryProp} from '../../../../shared/workspace'
import FormField from '../../components/FormField.vue'

/** Which prop of the library a character's prop becomes (#944) - filled into the caller's draft; the question around it starts the command. */
const props = defineProps<{draft: {choice: string}; options: LibraryProp[]; characterName: string}>()
const chosen = computed(() => props.options.find(p => p.id === props.draft.choice))
</script>

<template>
  <div class="tp-form">
    <FormField label="The prop of the library">
      <select v-model="draft.choice" :aria-label="`The prop ${characterName} gets`">
        <option value="" disabled>Choose one</option>
        <option v-for="prop in options" :key="prop.id" :value="prop.id">{{ prop.name }} · {{ prop.id }}</option>
      </select>
    </FormField>
    <p v-if="chosen" class="muted">{{ chosen.description }}</p>
  </div>
</template>

<style scoped>
.tp-form {
  display: grid;
  gap: var(--space-3);
  margin-top: var(--space-2);
}
</style>
