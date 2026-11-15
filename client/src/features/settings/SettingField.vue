<script setup lang="ts">
import {computed} from 'vue'
import type {SettingView} from '../../../../shared/workspace'
import {fieldTextOf, labelOf, textOfValue, valueOfField} from './settings'
import type {SettingsDraft} from './useSettingsDraft'

/** One setting in one row: its name and control side by side, what it does and its default small below - and the way back. */
const props = defineProps<{setting: SettingView; form: SettingsDraft}>()
const text = (event: Event) => (event.target as HTMLInputElement).value
const inputId = `setting-${props.setting.key.replace(/\W/g, '-')}`
// a setting that only does something while another is on (a field of the finish): shown, not to be changed while it is off
const off = computed(() => !!props.setting.needs && !props.form.draft[props.setting.needs])
</script>

<template>
  <div :class="['sf-row', {changed: form.isChanged(setting.key), off}]">
    <label class="sf-label" :for="inputId">{{ setting.label }}</label>
    <div class="sf-control">
      <select v-if="setting.control === 'select'" :id="inputId" v-model="form.draft[setting.key]" :disabled="off" :aria-label="setting.label">
        <option v-for="choice in setting.choices" :key="textOfValue(choice.value)" :value="choice.value">{{ choice.label }}</option>
      </select>
      <input
        v-else-if="setting.control === 'number'"
        :id="inputId"
        :value="fieldTextOf(setting, form.draft[setting.key])"
        type="number"
        :step="setting.step ?? 1"
        :placeholder="setting.auto?.label"
        :disabled="off"
        :aria-label="setting.label"
        @input="form.draft[setting.key] = valueOfField(setting, text($event))"
      />
      <textarea
        v-else-if="setting.multiline"
        :id="inputId"
        :disabled="off"
        :value="fieldTextOf(setting, form.draft[setting.key])"
        :placeholder="setting.auto?.label"
        :aria-label="setting.label"
        rows="3"
        @input="form.draft[setting.key] = valueOfField(setting, text($event))"
      />
      <input
        v-else
        :id="inputId"
        type="text"
        :disabled="off"
        :value="fieldTextOf(setting, form.draft[setting.key])"
        :placeholder="setting.auto?.label"
        :aria-label="setting.label"
        @input="form.draft[setting.key] = valueOfField(setting, text($event))"
      />
    </div>
    <p class="sf-note">{{ setting.note }}</p>
    <div class="sf-default">
      <span class="sf-default-label">Default</span>
      <span class="sf-default-value">{{ labelOf(setting, setting.default) }}</span>
      <span v-if="(!off && !form.isDefault(setting)) || form.isChanged(setting.key)" class="sf-actions">
        <button v-if="!off && !form.isDefault(setting)" class="btn mini" @click="form.toDefault(props.setting)">Use the default</button>
        <button v-if="form.isChanged(setting.key)" class="btn mini" @click="form.undo(props.setting)">Undo</button>
      </span>
    </div>
  </div>
</template>

<style scoped>
/* names of their own: .setting and .field are styled for other pages in workspace.css */
.sf-row {
  display: grid;
  grid-template-columns: minmax(140px, 22%) minmax(0, 1fr);
  gap: var(--space-1) var(--space-3);
  align-items: start;
  padding: 18px 20px;
  min-width: 0;
  border-left: 3px solid transparent;
  border-radius: var(--radius-s);
}
.sf-row + .sf-row {
  border-top: 1px solid var(--line);
}
.sf-row.changed {
  border-left-color: var(--accent);
  background: var(--raised);
}
.sf-row.off .sf-label,
.sf-row.off .sf-note {
  opacity: 0.6;
}
.sf-label {
  font-weight: 600;
  padding-top: 6px;
  overflow-wrap: anywhere;
}
.sf-control {
  min-width: 0;
}
.sf-control select,
.sf-control input,
.sf-control textarea {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
}
.sf-control textarea {
  resize: vertical;
  font: inherit;
  line-height: 1.5;
  padding: 10px 12px;
}
.sf-control input[type='number'] {
  max-width: 12rem;
}
.sf-note {
  grid-column: 2;
  font-size: var(--text-s);
  line-height: 1.55;
  color: var(--muted);
  overflow-wrap: anywhere;
  margin: 0;
}
.sf-default {
  grid-column: 2;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  font-size: var(--text-s);
  color: var(--muted);
  min-width: 0;
  margin-top: 4px;
}
.sf-default-label {
  font-weight: 600;
}
.sf-default-value {
  overflow-wrap: anywhere;
  min-width: 0;
}
.sf-actions {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 6px;
}
@media (max-width: 640px) {
  .sf-row {
    grid-template-columns: 1fr;
  }
  .sf-note,
  .sf-default {
    grid-column: 1;
  }
}
</style>
