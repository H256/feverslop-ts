<script setup lang="ts">
import type {SettingView} from '../../../../shared/workspace'
import FormField from '../../components/FormField.vue'
import {labelOf, textOfValue, valueOfText} from './settings'
import type {SettingsDraft} from './useSettingsDraft'

/** One setting: its control, what it says, what the default is - and how to go back to it. */
const props = defineProps<{setting: SettingView, form: SettingsDraft}>()
const text = (event: Event) => (event.target as HTMLInputElement).value
</script>

<template>
  <div :class="['setting', {changed: form.isChanged(setting.key)}]">
    <FormField :label="setting.label">
      <select v-if="setting.control === 'select'" v-model="form.draft[setting.key]" :aria-label="setting.label">
        <option v-for="choice in setting.choices" :key="textOfValue(choice.value)" :value="choice.value">{{ choice.label }}</option>
      </select>
      <input v-else-if="setting.control === 'number'" v-model.number="form.draft[setting.key]" type="number" step="1" :aria-label="setting.label">
      <input v-else type="text" :value="textOfValue(form.draft[setting.key])" :aria-label="setting.label" @input="form.draft[setting.key] = valueOfText(text($event))">
    </FormField>
    <div class="muted setting-note">
      {{ setting.note }}
      <span class="setting-default">
        Default: <code>{{ labelOf(setting, setting.default) }}</code>
        <button v-if="!form.isDefault(setting)" class="btn link" @click="form.toDefault(props.setting)">Use the default</button>
        <button v-if="form.isChanged(setting.key)" class="btn link" @click="form.undo(props.setting)">Undo</button>
      </span>
    </div>
  </div>
</template>
