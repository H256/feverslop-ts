<script setup lang="ts">
import {computed} from 'vue'
import FormField from '../../components/FormField.vue'
import type {CreditsDraft} from './forms'
import KeepSettings from './KeepSettings.vue'

/** The fields of the title card and the credits, filled into the caller's reactive draft - the question reads it when it is answered. */
const props = defineProps<{draft: CreditsDraft; finals: {file: string; label: string}[]; markers: string[]; kind: 'music' | 'film'}>()

// the marker on the title card: none, a preset, or the path of a PNG of one's own
const NONE = ''
const OWN = '__own__'
const choice = computed({
  get: () => (props.draft.marker === NONE ? NONE : props.markers.includes(props.draft.marker) ? props.draft.marker : OWN),
  set: value => {
    props.draft.marker = value === OWN ? 'input/' : value
  },
})
</script>

<template>
  <div>
    <FormField label="From">
      <select v-model="draft.from">
        <option v-for="final in finals" :key="final.file" :value="final.file">{{ final.label }} ({{ final.file }})</option>
      </select>
    </FormField>
    <div style="display: flex; gap: 16px">
      <label class="field" style="display: flex; gap: 8px"
        ><input v-model="draft.opening" type="checkbox" /><span style="margin: 0">Title card before it</span></label
      >
      <label class="field" style="display: flex; gap: 8px"><input v-model="draft.end" type="checkbox" /><span style="margin: 0">Credits after it</span></label>
    </div>
    <p v-if="!draft.opening && !draft.end" class="warn">Neither the title card nor the credits: there is nothing to add.</p>
    <FormField label="Title (empty: the project's)"><input v-model="draft.title" type="text" maxlength="200" /></FormField>
    <FormField :label="kind === 'film' ? 'Directed by' : 'Artist (by …)'"><input v-model="draft.who" type="text" maxlength="200" /></FormField>
    <FormField label="Disclosure (on the card and at the end; empty: none)"><input v-model="draft.disclosure" type="text" maxlength="200" /></FormField>
    <FormField v-if="draft.opening" label="Marker on the title card">
      <select v-model="choice">
        <option :value="NONE">None</option>
        <option v-for="marker in markers" :key="marker" :value="marker">EU icon: {{ marker }}</option>
        <option :value="OWN">A PNG of my own…</option>
      </select>
    </FormField>
    <FormField v-if="draft.opening && choice === OWN" label="PNG (path, absolute or relative to the project)"
      ><input v-model="draft.marker" type="text" required
    /></FormField>
    <FormField v-if="draft.end" label="Lines of your own in the credits, one per line: thanks, links, a channel">
      <textarea v-model="draft.extra" rows="3" />
    </FormField>
    <label v-if="draft.end" class="field" style="display: flex; gap: 8px"
      ><input v-model="draft.facts" type="checkbox" /><span style="margin: 0">What it was made with: language model, models, graphics cards</span></label
    >
    <FormField v-if="draft.end" label="Hardware, in your own words (after the cards the project rendered on)"
      ><input v-model="draft.hardware" type="text" placeholder="LLM: Strix Halo, 128 GB" maxlength="200"
    /></FormField>
    <FormField v-if="draft.end" label="Sound under the credits (path; empty: silence)"
      ><input v-model="draft.sound" type="text" placeholder="input/outro.mp3"
    /></FormField>
    <div style="display: flex; gap: 12px">
      <FormField v-if="draft.opening" label="Title card (seconds)"
        ><input v-model.number="draft.openingSeconds" type="number" min="1" max="30" step="0.5" required
      /></FormField>
      <FormField v-if="draft.end" label="Credits (seconds, 0 = as the lines need)"
        ><input v-model.number="draft.endSeconds" type="number" min="0" max="600" step="1" required
      /></FormField>
    </div>
    <KeepSettings :draft="draft" />
  </div>
</template>
