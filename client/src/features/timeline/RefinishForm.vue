<script setup lang="ts">
import FormField from '../../components/FormField.vue'
import {FPS, REFINISH_PRESETS, SIZE, UPSCALE, type Refinish} from './forms'

/** The fields of a refinish, filled into the caller's reactive draft - the question reads it when it is answered. */
defineProps<{draft: Refinish}>()
</script>

<template>
  <div>
    <FormField label="What">
      <select v-model="draft.preset">
        <option v-for="[value, label] in REFINISH_PRESETS" :key="value" :value="value">{{ label }}</option>
      </select>
    </FormField>
    <div v-if="draft.preset === 'custom'">
      <FormField label="Larger"
        ><select v-model="draft.upscale">
          <option v-for="[value, label] in UPSCALE" :key="value" :value="value">{{ label }}</option>
        </select></FormField
      >
      <FormField label="Size"
        ><select v-model="draft.size">
          <option v-for="[value, label] in SIZE" :key="value" :value="value">{{ label }}</option>
        </select></FormField
      >
      <FormField label="Denoise (refine)"><input v-model.number="draft.denoise" type="number" min="0.05" max="1" step="0.05" required /></FormField>
      <FormField label="Frame rate"
        ><select v-model="draft.fps">
          <option v-for="[value, label] in FPS" :key="value" :value="value">{{ label }}</option>
        </select></FormField
      >
      <label class="field" style="display: flex; gap: 8px"
        ><input v-model="draft.finish" type="checkbox" /><span style="margin: 0">Grade and sharpen</span></label
      >
    </div>
  </div>
</template>
