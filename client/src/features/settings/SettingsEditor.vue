<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, toRef, watch} from 'vue'
import AppIcon from '../../components/AppIcon.vue'
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

// #1145: a setting is found by its name, its key or its note; the sections that hold none of them go
const query = ref('')
const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  const all = groups.value.map((group, index) => ({...group, index}))
  if (!q) return all
  return all
    .map(group => ({...group, settings: group.settings.filter(s => `${s.label} ${s.key} ${s.note}`.toLowerCase().includes(q))}))
    .filter(group => group.settings.length)
})
const changedCount = computed(() => Object.keys(form.changes.value).length)
const changedIn = (settings: SettingView[]) => settings.filter(s => form.isChanged(s.key)).length
// the section in view marks itself in the list
const page = ref<HTMLElement>()
const active = ref('')
let observer: IntersectionObserver | undefined
const observeSections = () => {
  observer?.disconnect()
  if (!page.value || typeof IntersectionObserver === 'undefined') return
  observer = new IntersectionObserver(
    entries => {
      for (const entry of entries) if (entry.isIntersecting) active.value = entry.target.id
    },
    {root: page.value, rootMargin: '-10% 0px -75% 0px'},
  )
  for (const section of page.value.querySelectorAll('.se-group')) observer.observe(section)
}
onMounted(() => watch(shown, observeSections, {flush: 'post', immediate: true}))
onBeforeUnmount(() => observer?.disconnect())

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
  <div ref="page" class="scrollpage view" :inert="saving.pending.value" :aria-busy="saving.pending.value">
    <PageBar title="Settings" class="se-header">
      <span class="muted se-hint">Review the effects before saving.</span>
      <div class="spacer" />
      <input v-model="query" type="search" class="se-search" placeholder="Find a setting" aria-label="Find a setting" />
      <span v-if="form.dirty.value" class="chip stale" role="status">{{ plural(changedCount, 'setting') }} changed</span>
      <button class="btn primary" :disabled="!form.dirty.value" @click="save"><AppIcon name="save" />Save</button>
    </PageBar>
    <div class="se-layout">
      <nav class="se-nav" aria-label="Settings sections">
        <a
          v-for="group in shown"
          :key="group.name"
          :href="`#settings-group-${group.index}`"
          :aria-current="active === `settings-group-${group.index}` ? 'location' : undefined"
          >{{ group.name }}<span v-if="changedIn(group.settings)" class="se-dot" role="img" :aria-label="`${changedIn(group.settings)} changed`"
        /></a>
      </nav>
      <div class="se-grid">
        <p v-if="!shown.length" class="muted">No setting matches "{{ query.trim() }}".</p>
        <section
          v-for="group in shown"
          :id="`settings-group-${group.index}`"
          :key="group.name"
          class="se-group"
          :aria-labelledby="`settings-title-${group.index}`"
        >
          <h2 :id="`settings-title-${group.index}`">{{ group.name }}</h2>
          <SettingField v-for="setting in group.settings" :key="setting.key" :setting="setting" :form="form" />
        </section>
      </div>
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
.se-search {
  width: 200px;
}
/* the list of sections stays beside the settings while they scroll (#1145) */
.se-layout {
  display: grid;
  grid-template-columns: 12rem minmax(0, 1fr);
  gap: var(--space-6);
  max-width: 76rem;
  align-items: start;
  margin-top: var(--space-4);
}
.se-nav {
  position: sticky;
  top: 5rem;
  display: grid;
  gap: var(--space-half);
}
.se-nav a {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-3);
  border-left: 2px solid transparent;
  color: var(--muted);
  text-decoration: none;
}
.se-nav a:hover {
  color: var(--text);
  background: var(--raised);
}
.se-nav a[aria-current='location'] {
  color: var(--text);
  font-weight: 600;
  border-left-color: var(--accent);
}
.se-dot {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: var(--radius-round);
  background: var(--stale);
}
.se-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-5);
  min-width: 0;
}
@media (max-width: 900px) {
  .se-layout {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-3);
  }
  .se-nav {
    position: static;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
  .se-hint {
    display: none;
  }
}
.se-group {
  border: 1px solid var(--line);
  border-radius: var(--radius-m);
  background: var(--surface);
  box-shadow: var(--shadow-card);
  min-width: 0;
  scroll-margin-top: 8rem;
}
.se-group h2 {
  font-size: var(--text-m);
  font-weight: 600;
  padding: var(--space-3) var(--space-4);
  margin: 0;
  background: var(--head);
  border-bottom: 1px solid var(--line);
  border-radius: calc(var(--radius-m) - 1px) calc(var(--radius-m) - 1px) 0 0;
}
.se-foot {
  margin-top: 14px;
  max-width: 72rem;
  overflow-wrap: anywhere;
}
</style>
