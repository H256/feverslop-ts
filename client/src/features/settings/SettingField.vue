<script setup lang="ts">
import type {SettingView} from '../../../../shared/workspace'
import {labelOf, textOfValue, valueOfText} from './settings'
import type {SettingsDraft} from './useSettingsDraft'

/** One setting in one row: its name and control side by side, what it does and its default small below - and the way back. */
const props = defineProps<{setting: SettingView; form: SettingsDraft}>()
const text = (event: Event) => (event.target as HTMLInputElement).value
const inputId = `setting-${props.setting.key}`
</script>

<template>
  <div :class="['sf-row', {changed: form.isChanged(setting.key)}]">
    <label class="sf-label" :for="inputId">{{ setting.label }}</label>
    <div class="sf-control">
      <select v-if="setting.control === 'select'" :id="inputId" v-model="form.draft[setting.key]" :aria-label="setting.label">
        <option v-for="choice in setting.choices" :key="textOfValue(choice.value)" :value="choice.value">{{ choice.label }}</option>
      </select>
      <input
        v-else-if="setting.control === 'number'"
        :id="inputId"
        v-model.number="form.draft[setting.key]"
        type="number"
        step="1"
        :aria-label="setting.label"
      />
      <input
        v-else
        :id="inputId"
        type="text"
        :value="textOfValue(form.draft[setting.key])"
        :aria-label="setting.label"
        @input="form.draft[setting.key] = valueOfText(text($event))"
      />
    </div>
    <p class="sf-note">
      {{ setting.note }}
      <span class="sf-default"
        >Default <code>{{ labelOf(setting, setting.default) }}</code
        ><button v-if="!form.isDefault(setting)" class="btn link" @click="form.toDefault(props.setting)">Use the default</button
        ><button v-if="form.isChanged(setting.key)" class="btn link" @click="form.undo(props.setting)">Undo</button></span
      >
    </p>
  </div>
</template>

<style scoped>
/* names of their own: .setting and .field are styled for other pages in workspace.css */
.sf-row {
  display: grid;
  grid-template-columns: minmax(120px, 26%) minmax(0, 1fr);
  gap: 4px 12px;
  align-items: center;
  padding: 8px 10px;
  border-left: 3px solid transparent;
  border-radius: 4px;
}
.sf-row + .sf-row {
  border-top: 1px solid var(--line);
}
.sf-row.changed {
  border-left-color: var(--accent);
  background: var(--raised);
}
.sf-label {
  font-weight: 500;
}
.sf-control select,
.sf-control input {
  width: 100%;
}
.sf-note {
  grid-column: 2;
  font-size: 12px;
  line-height: 1.4;
  color: var(--muted);
}
.sf-default {
  white-space: nowrap;
  margin-left: 4px;
}
.sf-default code {
  margin-left: 3px;
}
@media (max-width: 640px) {
  .sf-row {
    grid-template-columns: 1fr;
  }
  .sf-note {
    grid-column: 1;
  }
}
</style>
