<script setup lang="ts">
import PageBar from '../../components/PageBar.vue'
import ResourceState from '../../components/ResourceState.vue'
import {useDraft} from '../../composables/useDraft'
import {usePending} from '../../composables/usePending'
import {useUnsavedChanges} from '../../composables/useUnsavedChanges'
import {listSteps} from '../../lib/format'
import {useAsk} from '../../services/ask'
import {useToasts} from '../../services/toasts'
import StageBar from '../plan/StageBar.vue'
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
    <StageBar />
    <ResourceState :loading="loading" :error="error" :loaded="!!look" @retry="reload" />
    <template v-if="look">
      <div v-if="look.lookBrief === undefined" class="empty">No look yet - plan it with the button above.</div>
      <template v-else>
        <div class="section">
          <PageBar title="The look of the whole" />
          <p class="muted">Format, style, palette and camera language - every look below is written from it.</p>
          <textarea v-model="brief.text.value" class="prose" rows="6" aria-label="The look of the whole" />
          <div class="btn-row" style="margin-top: 6px">
            <button class="btn" :disabled="!brief.dirty.value" @click="saveBrief">Save the look of the whole</button>
          </div>
        </div>
        <div class="section btn-row">
          <button class="btn primary" :disabled="!edits.dirty.value" @click="saveLooks">Save</button>
          <span class="muted">{{ edits.pending.value }}</span>
          <span class="muted">Change a text by hand, or tick "Write anew" for the language model to write it again.</span>
        </div>
        <div v-if="look.characters.length" class="section">
          <PageBar title="Characters" /><LookElementCard v-for="element in look.characters" :key="element.id" :element="element" :edits="edits" />
        </div>
        <div v-if="look.locations.length" class="section">
          <PageBar title="Places" /><LookElementCard v-for="element in look.locations" :key="element.id" :element="element" :edits="edits" />
        </div>
      </template>
    </template>
  </div>
</template>
