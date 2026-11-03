<script setup lang="ts">
import FormField from '../../components/FormField.vue'

/** How a project is made over from the clips it has: a preset, or each step said by hand. */
export type Refinish = {preset: 'grade' | 'smooth' | 'fullhd' | 'custom', upscale: string, size: string, denoise: number, fps: string, finish: boolean}
const form = defineModel<Refinish>({required: true})
const UPSCALE = [['none', 'Not larger'], ['refine', 'Refine: second pass, denoise as below'], ['latent', 'Latent upscaler alone: fast, but artefacts'], ['model', 'Upscale model: RealESRGAN_x2plus']] as const
const SIZE = [['fullhd', 'Full HD (1920×1088)'], ['2x', 'Twice the size']] as const
const FPS = [['24', 'Stay at 24 fps'], ['48', '48 fps'], ['60', '60 fps']] as const
</script>

<template>
  <div>
    <FormField label="What">
      <select v-model="form.preset">
        <option value="grade">Grade and sharpen only: no GPU</option>
        <option value="smooth">48 fps, grade and sharpen</option>
        <option value="fullhd">Full HD by a refine pass, 48 fps, grade and sharpen</option>
        <option value="custom">Say it one by one</option>
      </select>
    </FormField>
    <div v-if="form.preset === 'custom'">
      <FormField label="Larger"><select v-model="form.upscale"><option v-for="[value, label] in UPSCALE" :key="value" :value="value">{{ label }}</option></select></FormField>
      <FormField label="Size"><select v-model="form.size"><option v-for="[value, label] in SIZE" :key="value" :value="value">{{ label }}</option></select></FormField>
      <FormField label="Denoise (refine)"><input v-model.number="form.denoise" type="number" min="0.05" max="1" step="0.05"></FormField>
      <FormField label="Frame rate"><select v-model="form.fps"><option v-for="[value, label] in FPS" :key="value" :value="value">{{ label }}</option></select></FormField>
      <label class="field" style="display: flex; gap: 8px"><input v-model="form.finish" type="checkbox"><span style="margin: 0">Grade and sharpen</span></label>
    </div>
  </div>
</template>
