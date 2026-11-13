<script setup lang="ts">
import FormField from '../../components/FormField.vue'
import type {DescriptionDraft} from './forms'
import KeepSettings from './KeepSettings.vue'

/** The fields of the YouTube text, filled into the caller's reactive draft - the question reads it when it is answered. */
defineProps<{draft: DescriptionDraft; finals: {file: string; label: string}[]}>()
</script>

<template>
  <div>
    <FormField label="The video you publish">
      <select v-model="draft.from" required>
        <option value="" disabled>Choose one</option>
        <option v-for="final in finals" :key="final.file" :value="final.file">{{ final.label }} ({{ final.file }})</option>
      </select>
    </FormField>
    <FormField label="A teaser of the story, written by the language model" check><input v-model="draft.story" type="checkbox" /></FormField>
    <FormField v-if="draft.story" label="Write the teaser again (else the one written before for this video stays)" check
      ><input v-model="draft.newStory" type="checkbox"
    /></FormField>
    <FormField label="How it was made: hardware, models, measured time per phase" check><input v-model="draft.facts" type="checkbox" /></FormField>
    <FormField label="Your words on the hardware (after the graphics cards)">
      <input v-model="draft.hardware" type="text" placeholder="LLM: Strix Halo, 128 GB" />
    </FormField>
    <FormField label="Lines of your own at the end (one per line)">
      <textarea v-model="draft.extra" rows="3" placeholder="youtube.com/@me" />
    </FormField>
    <FormField label="Hashtags (without #, separated by spaces)">
      <input v-model="draft.tags" type="text" />
    </FormField>
    <KeepSettings :draft="draft" />
  </div>
</template>
