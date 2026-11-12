<script setup lang="ts">
import {onMounted, shallowRef, watch} from 'vue'
import type {DirectionView} from '../../../../shared/direction'
import type {DryRun, ProjectKind, ProjectStatus} from '../../../../shared/workspace'
import FormField from '../../components/FormField.vue'
import {errorText, plural} from '../../lib/format'
import {type PlanChoice, planAsked} from './planChoice'

/**
 * The question before a plan run (#836): what it would do - `--dry-run` of the command: which steps are made again and why, beats
 * planned again and the clips that turn stale by it - and a step to plan again from (`--redo`), read again when one is picked. A film
 * planning its shots again (coverage) can keep the shots of the scenes not picked (`--scenes`).
 */
// the question is shown outside the project's pages: what it asks is handed to it
const props = defineProps<{
  draft: PlanChoice
  until?: string
  kind: ProjectKind
  api: {
    dryRun: (plan: {redo?: string[]; until?: string; scenes?: string[]}) => Promise<{dryRun: DryRun}>
    status: () => Promise<ProjectStatus>
    direction: () => Promise<DirectionView>
  }
}>()
const api = props.api
const steps = shallowRef<string[]>([])
const scenes = shallowRef<string[]>([])
const said = shallowRef<DryRun | null>()
const failed = shallowRef('')
const loading = shallowRef(true)

// a choice changed while a dry run was asked: only the answer to the last one is shown
let asked = 0
const ask = async () => {
  const mine = ++asked
  loading.value = true
  failed.value = ''
  try {
    const answer = (await api.dryRun(planAsked(props.draft, props.until))).dryRun
    if (mine === asked) said.value = answer
  } catch (e) {
    if (mine === asked) failed.value = errorText(e)
  } finally {
    if (mine === asked) loading.value = false
  }
}
onMounted(async () => {
  // the steps there are to plan again from: the ones made
  steps.value = (await api.status().catch(() => undefined))?.steps.filter(s => s.state === 'done').map(s => s.step) ?? []
  // a film's scenes with shots planned - the ones that can keep them
  if (props.kind === 'film' && steps.value.includes('coverage'))
    scenes.value = [...new Set((await api.direction().catch(() => undefined))?.shots.map(s => s.groupId) ?? [])]
  await ask()
})
watch(
  () => [props.draft.redo, props.draft.scenes.join()],
  () => void ask(),
)
</script>

<template>
  <div class="pq">
    <FormField v-if="steps.length" label="Plan again from a step (--redo)">
      <select v-model="draft.redo" aria-label="Plan again from a step">
        <option value="">No step - only what changed</option>
        <option v-for="step in steps" :key="step" :value="step">{{ step }}</option>
      </select>
    </FormField>
    <fieldset v-if="draft.redo === 'coverage' && scenes.length > 1" class="pq-scenes">
      <legend>Only these scenes (--scenes) - none picked plans every scene again</legend>
      <label v-for="scene in scenes" :key="scene" class="pq-scene">
        <input v-model="draft.scenes" type="checkbox" :value="scene" />
        {{ scene }}
      </label>
    </fieldset>
    <p v-if="loading" class="muted">Asking what it would do…</p>
    <p v-else-if="failed" class="warn">The dry run failed: {{ failed }}</p>
    <template v-else-if="said">
      <p v-for="reason in said.reasons" :key="reason.why" class="pq-line">
        <b>{{ reason.why }}</b> <span class="muted">redoes {{ reason.steps.join(', ') }}</span>
      </p>
      <p class="pq-line" :title="said.redone.join(', ')">
        <b>Made again</b>
        {{ said.redone.length ? plural(said.redone.length, 'step') : 'nothing - every step is taken as it is' }}
      </p>
      <p v-if="said.generated.length" class="pq-line" :title="said.generated.join(', ')">
        <b>Made for the first time</b> {{ plural(said.generated.length, 'step') }}
      </p>
      <p v-if="said.plannedAgain.length" class="pq-line">
        <b>{{ kind === 'film' ? 'Scenes' : 'Beats' }} planned again</b> {{ said.plannedAgain.join(', ')
        }}<template v-if="said.staleAfter.length">; {{ plural(said.staleAfter.length, 'clip') }} turn stale</template>
      </p>
      <p v-for="warning in said.warnings" :key="warning" class="warn">{{ warning }}</p>
    </template>
  </div>
</template>

<style scoped>
.pq {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin-top: 8px;
}
.pq-line {
  margin: 0;
}
.pq-scenes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  border: 0;
  padding: 0;
  margin: 0;
}
.pq-scenes legend {
  padding: 0;
  margin-bottom: var(--space-1);
}
.pq-scene {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}
</style>
