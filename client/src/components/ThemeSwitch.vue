<script setup lang="ts">
import {ref, watch} from 'vue'
import AppIcon, {type IconName} from './AppIcon.vue'

/** The system's theme, or a choice kept in this browser. index.html sets it before the first paint. */
type Theme = 'system' | 'light' | 'dark'
const THEMES: {value: Theme, label: string, title: string}[] = [
  {value: 'system', label: 'System', title: 'Follow the system setting'},
  {value: 'light', label: 'Light', title: 'Light'},
  {value: 'dark', label: 'Dark', title: 'Dark'},
]
const emit = defineEmits<{changed: []}>()
const theme = ref<Theme>((document.documentElement.dataset.theme as Theme | undefined) ?? 'system')
watch(theme, value => {
  document.documentElement.dataset.theme = value
  if (value === 'system') localStorage.removeItem('theme')
  else localStorage.setItem('theme', value)
  emit('changed')
})
</script>

<template>
  <fieldset class="theme">
    <legend>Theme</legend>
    <template v-for="option in THEMES" :key="option.value">
      <input :id="`theme-${option.value}`" v-model="theme" type="radio" name="theme" :value="option.value">
      <label :for="`theme-${option.value}`" :title="option.title"><AppIcon :name="option.value as IconName" /><span hidden>{{ option.label }}</span></label>
    </template>
  </fieldset>
</template>
