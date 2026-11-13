<script setup lang="ts">
import FormField from '../../components/FormField.vue'
import {AskService} from '../../services/ask'
import {FPS, REFINISH_PRESETS, SIZE, UPSCALE, type Refinish} from './forms'

/**
 * The fields of a refinish, filled into the caller's reactive draft - the question reads it when it is answered. `finish`: what
 * the finish does, as the project's settings have it; `settings`: the page they are changed on.
 */
defineProps<{draft: Refinish; finish?: string; settings: string}>()
const {current} = AskService.use()
// to Settings: the question is let go, nothing is started
const leave = () => current.value?.answer(false)
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
      <FormField label="Grade and sharpen" check><input v-model="draft.finish" type="checkbox" /></FormField>
    </div>
    <p v-if="draft.preset !== 'custom' || draft.finish" class="muted rf-finish">
      The finish: {{ finish ?? 'as the settings have it' }}. <RouterLink :to="settings" @click="leave">Change it on Settings</RouterLink> - grain and colour
      match are set there.
    </p>
  </div>
</template>

<style scoped>
.rf-finish {
  margin-top: 8px;
  font-size: var(--text-s);
}
</style>
