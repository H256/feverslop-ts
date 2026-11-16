<script setup lang="ts">
import {computed, toRef, watch} from 'vue'
import type {ConfigImpact, SettingView} from '../../../../shared/workspace'
import PageBar from '../../components/PageBar.vue'
import {usePending} from '../../composables/usePending'
import {useUnsavedChanges} from '../../composables/useUnsavedChanges'
import {plural} from '../../lib/format'
import {useAsk} from '../../services/ask'
import {useToasts} from '../../services/toasts'
import {useProject} from '../project/session'
import SettingField from './SettingField.vue'
import {costOf, groupsOf, labelOf} from './settings'
import {useSettingsDraft} from './useSettingsDraft'

/** The settings as a form: changed here, checked and costed before they are saved. */
const props = defineProps<{settings: SettingView[]; refresh: () => Promise<boolean>}>()
const {api, id} = useProject()
const ask = useAsk()
const toasts = useToasts()
const form = useSettingsDraft(toRef(props, 'settings'))
useUnsavedChanges(() => form.dirty.value, 'changes to the settings')
// a new reading (a run ended, another tab saved) is taken over while nothing is changed here
watch(
  () => props.settings,
  () => {
    if (!form.dirty.value) form.reset()
  },
)
const saving = usePending()
const groups = computed(() => groupsOf(form.base.value))

const problemsOf = (impact: ConfigImpact) => toasts.show(impact.problems.join(' · '), true)
const baseOf = (key: string) => form.base.value.find(s => s.key === key)
const save = toasts.guard(async () => {
  const change = form.changes.value
  const impact = await api.previewConfig(change)
  if (impact.problems.length) return problemsOf(impact)
  const yes = await ask({
    title: 'Save the settings?',
    lines: [
      `config.json of this project: ${plural(impact.changed.length, 'setting')} changed.`,
      ...impact.changed.map(key => {
        const setting = baseOf(key)!
        return `${setting.label}: ${labelOf(setting, setting.value)} → ${change[key] === null ? `${labelOf(setting, setting.default)} (the default)` : labelOf(setting, change[key])}`
      }),
    ],
    warnings: [...costOf(impact), ...impact.notes],
    confirm: 'Save it',
  })
  if (!yes) return
  // while saving the form is not to be changed: it is let go after, and with it whatever was typed meanwhile
  const result = await saving.during(async () => {
    const result = await api.saveConfig(change)
    if (!result.problems.length && (await props.refresh())) form.reset()
    return result
  })
  if (result.problems.length) return problemsOf(result)
  toasts.show(result.written ? 'The settings are saved' : 'Nothing changed')
})
</script>

<template>
  <div class="scrollpage view" :inert="saving.pending.value" :aria-busy="saving.pending.value">
    <PageBar title="Settings" class="se-header">
      <span class="muted">Rendering and preview settings. Review the effects before saving.</span>
      <div class="spacer" />
      <button class="btn primary" :disabled="!form.dirty.value" @click="save">Save</button>
    </PageBar>
    <nav class="se-nav" aria-label="Settings sections">
      <a v-for="(group, index) in groups" :key="group.name" :href="`#settings-group-${index}`" class="btn">{{ group.name }}</a>
    </nav>
    <div class="se-grid">
      <section v-for="(group, index) in groups" :id="`settings-group-${index}`" :key="group.name" class="se-group" :aria-labelledby="`settings-title-${index}`">
        <h2 :id="`settings-title-${index}`">{{ group.name }}</h2>
        <SettingField v-for="setting in group.settings" :key="setting.key" :setting="setting" :form="form" />
      </section>
    </div>
    <p class="muted se-foot">
      The same from the terminal: <code>bun run config {{ id }}</code
      >. A change makes what was rendered from another setting stale - the timeline marks it, and nothing is rendered until you ask.
    </p>
  </div>
</template>

<style scoped>
.se-header {
  position: sticky;
  top: -16px;
  z-index: 2;
  background: var(--bg);
  padding: 14px 0;
  border-bottom: 1px solid var(--line);
}
.se-nav {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: 24px;
}
.se-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  max-width: 72rem;
  gap: var(--space-6);
}
.se-group {
  border: 1px solid var(--line);
  border-radius: var(--radius-m);
  min-width: 0;
  scroll-margin-top: 8rem;
}
.se-group h2 {
  font-size: var(--text-m);
  font-weight: 600;
  padding: 16px 23px;
  margin: 0;
  border-bottom: 1px solid var(--line);
}
.se-foot {
  margin-top: 14px;
  max-width: 72rem;
  overflow-wrap: anywhere;
}
</style>
