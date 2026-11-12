<script setup lang="ts">
import ResourceState from '../../components/ResourceState.vue'
import {useDraft} from '../../composables/useDraft'
import {usePending} from '../../composables/usePending'
import {useUnsavedChanges} from '../../composables/useUnsavedChanges'
import {listSteps} from '../../lib/format'
import {useAsk} from '../../services/ask'
import {useToasts} from '../../services/toasts'
import {useProject} from '../project/session'
import {usePageData} from '../project/usePageData'
import LookElementCard from './LookElementCard.vue'
import {useLookEdits} from './lookEdits'

/** The look of the whole, and how every character and place looks: read, changed by hand, written anew one by one. */
const {project, api, start} = useProject()
const ask = useAsk()
const toasts = useToasts()
const {data: look, loading, error, reload, refresh} = usePageData(signal => api.look(signal), {live: true})
const brief = useDraft(() => look.value?.lookBrief)
const edits = useLookEdits()
useUnsavedChanges(() => brief.dirty.value || edits.dirty.value, 'looks')
// while saving the page is not to be changed: the edits sent are let go after it, and with them whatever was typed meanwhile
const saving = usePending()

const saveBrief = toasts.guard(async () => {
  const goes = look.value?.briefBuiltOn ?? []
  const yes = await ask({
    title: 'Save the look of the whole?',
    lines: ['Every look is written from it: the next plan run writes them all again, and what is built on them. The language model only, nothing is rendered.'],
    warnings: goes.length ? [`What goes: ${listSteps(goes)}.`, 'Texts changed by hand on this page go too.'] : [],
    confirm: 'Save it',
  })
  if (!yes) return
  const result = await saving.during(async () => {
    const result = await api.saveLook({lookBrief: brief.text.value})
    // a new look of the whole has every look written again: the texts changed here go with it
    edits.clear()
    await refresh()
    return result
  })
  toasts.show(result.changed ? 'The look is saved' : 'Nothing changed')
})
const saveLooks = toasts.guard(async () => {
  const goes = look.value?.builtOn ?? []
  const yes = await ask({
    title: 'Save the looks?',
    lines: [
      `${edits.pending.value}.`,
      "What is written from a changed text is written again for that character or place only - a changed look: its description; a place's look: its description, background and floor plan. Everyone else keeps their texts. The next plan run does it: the language model only.",
    ],
    warnings: [
      goes.length && `What is planned from the looks goes: ${listSteps(goes)}.`,
      project.value.pictures.some(p => p.exists) && 'A picture made from an old look stays, and is stale: render it again on References.',
    ],
    confirm: 'Save it',
  })
  if (!yes) return
  const result = await saving.during(async () => {
    const result = await api.saveLook(edits.change())
    if (await refresh()) edits.clear()
    return result
  })
  if (!result.changed) return toasts.show('Nothing changed')
  // the texts to write are written by the next plan run - right away, if wanted, stopping after the look
  const now =
    result.remade.length > 0 &&
    (await ask({
      title: 'Write them now?',
      lines: [...result.remade, 'A plan run writes these and stops after the look. The language model only.'],
      confirm: 'Write them now',
    }))
  if (now) await start({type: 'plan', until: 'look'})
})
</script>

<template>
  <div class="scrollpage view" :inert="saving.pending.value" :aria-busy="saving.pending.value">
    <ResourceState :loading="loading" :error="error" :loaded="!!look" @retry="reload" />
    <template v-if="look">
      <div v-if="look.lookBrief === undefined" class="empty">No look yet - plan it with the button above.</div>
      <template v-else>
        <section :class="['lk-whole', {changed: brief.dirty.value}]">
          <header class="lk-whole-head">
            <h2>The look of the whole</h2>
            <span class="muted">Format, style, palette and camera language - every look below is written from it.</span>
          </header>
          <textarea v-model="brief.text.value" rows="5" aria-label="The look of the whole" />
          <div class="btn-row">
            <button class="btn" :disabled="!brief.dirty.value" @click="saveBrief">Save the look of the whole</button>
            <span v-if="brief.dirty.value" class="muted">Saving it writes every look below again.</span>
          </div>
        </section>

        <!-- one save for every look changed below, always in reach -->
        <div class="lk-bar">
          <button class="btn primary" :disabled="!edits.dirty.value" @click="saveLooks">Save the looks</button>
          <span class="muted">{{
            edits.dirty.value ? edits.pending.value : 'Change a text by hand, or tick "Write anew" for the language model to write it again.'
          }}</span>
        </div>

        <section v-if="look.characters.length">
          <h2 class="lk-title">
            Characters <span class="muted">{{ look.characters.length }}</span>
          </h2>
          <div class="lk-grid">
            <LookElementCard v-for="element in look.characters" :key="element.id" :element="element" :edits="edits" />
          </div>
        </section>
        <section v-if="look.locations.length">
          <h2 class="lk-title">
            Places <span class="muted">{{ look.locations.length }}</span>
          </h2>
          <div class="lk-grid">
            <LookElementCard v-for="element in look.locations" :key="element.id" :element="element" :edits="edits" />
          </div>
        </section>
      </template>
    </template>
  </div>
</template>

<style scoped>
.lk-whole {
  border: 1px solid var(--line);
  border-left: 3px solid var(--line);
  border-radius: var(--radius-m);
  padding: 12px 14px;
  margin: 12px 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.lk-whole.changed {
  border-left-color: var(--accent);
}
.lk-whole-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.lk-whole-head h2,
.lk-title {
  font-size: var(--text-l);
  font-weight: 600;
}
.lk-whole textarea {
  width: 100%;
  font: var(--text-m)/1.5 var(--sans);
  resize: vertical;
}
.lk-bar {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 8px 12px;
  margin-bottom: 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-m);
  background: var(--bg);
}
.lk-title {
  margin: 16px 0 8px;
}
.lk-title .muted {
  font-weight: normal;
  margin-left: 4px;
}
.lk-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(560px, 100%), 1fr));
  gap: var(--space-3);
}
</style>
