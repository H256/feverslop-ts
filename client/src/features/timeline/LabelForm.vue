<script setup lang="ts">
import {computed} from 'vue'
import FormField from '../../components/FormField.vue'
import {CORNERS, LABEL_MODES, type LabelDraft} from './forms'

/** The fields of the AI marker, filled into the caller's reactive draft - the question reads it when it is answered. */
const props = defineProps<{draft: LabelDraft, finals: {file: string, label: string}[], markers: string[]}>()

// a preset is chosen from the list; anything else is the path of a PNG of one's own
const OWN = '__own__'
const choice = computed({
  get: () => props.markers.includes(props.draft.marker) ? props.draft.marker : OWN,
  set: value => { props.draft.marker = value === OWN ? '' : value },
})
const presetLabel = (marker: string) => {
  const [icon, variant] = marker.split('-')
  const what = icon === 'generated' ? 'AI GENERATED' : icon === 'modified' ? 'AI MODIFIED' : 'AI'
  return `${what} · ${variant?.replace('50', ', 50 % transparent')}`
}
</script>

<template>
  <div>
    <FormField label="From">
      <select v-model="draft.from"><option v-for="final in finals" :key="final.file" :value="final.file">{{ final.label }} ({{ final.file }})</option></select>
    </FormField>
    <FormField label="Marker">
      <select v-model="choice">
        <option v-for="marker in markers" :key="marker" :value="marker">EU icon: {{ presetLabel(marker) }}</option>
        <option :value="OWN">A PNG of my own…</option>
      </select>
    </FormField>
    <FormField v-if="choice === OWN" label="PNG (path, absolute or relative to the project)">
      <input v-model="draft.marker" type="text" placeholder="input/my-label.png" required>
    </FormField>
    <FormField label="When">
      <select v-model="draft.mode"><option v-for="[value, label] in LABEL_MODES" :key="value" :value="value">{{ label }}</option></select>
    </FormField>
    <div style="display: flex; gap: 12px">
      <FormField v-if="draft.mode !== 'always'" label="Seconds shown"><input v-model.number="draft.seconds" type="number" min="0.5" max="600" step="0.5" required></FormField>
      <FormField v-if="draft.mode === 'interval'" label="Every (seconds)"><input v-model.number="draft.interval" type="number" min="5" max="3600" step="1" required></FormField>
    </div>
    <FormField label="Corner">
      <select v-model="draft.corner"><option v-for="[value, label] in CORNERS" :key="value" :value="value">{{ label }}</option></select>
    </FormField>
    <div style="display: flex; gap: 12px">
      <FormField label="Height (% of the video)"><input v-model.number="draft.size" type="number" min="1" max="50" step="0.5" required></FormField>
      <FormField label="Margin (% of the height)"><input v-model.number="draft.margin" type="number" min="0" max="30" step="0.5" required></FormField>
    </div>
    <label class="field" style="display: flex; gap: 8px"><input v-model="draft.save" type="checkbox"><span style="margin: 0">Keep these settings for this project (config.json)</span></label>
  </div>
</template>
