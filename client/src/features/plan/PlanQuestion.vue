<script setup lang="ts">
import {onMounted, shallowRef, watch} from 'vue'
import type {DryRun, ProjectStatus} from '../../../../shared/workspace'
import FormField from '../../components/FormField.vue'
import {errorText, plural} from '../../lib/format'

/**
 * The question before a plan run (#836): what it would do - `--dry-run` of the command: which steps are made again and why, beats
 * planned again and the clips that turn stale by it - and a step to plan again from (`--redo`), read again when one is picked.
 */
// the question is shown outside the project's pages: what it asks is handed to it
const props = defineProps<{
  draft: {redo: string}
  until?: string
  api: {dryRun: (plan: {redo?: string[]; until?: string}) => Promise<{dryRun: DryRun | null}>; status: () => Promise<ProjectStatus>}
}>()
const api = props.api
const steps = shallowRef<string[]>([])
const said = shallowRef<DryRun | null>()
const failed = shallowRef('')
const loading = shallowRef(true)

const ask = async () => {
  loading.value = true
  failed.value = ''
  try {
    said.value = (await api.dryRun({...(props.draft.redo ? {redo: [props.draft.redo]} : {}), ...(props.until ? {until: props.until} : {})})).dryRun
  } catch (e) {
    failed.value = errorText(e)
  } finally {
    loading.value = false
  }
}
onMounted(async () => {
  // the steps there are to plan again from: the ones made
  steps.value = (await api.status().catch(() => undefined))?.steps.filter(s => s.state === 'done').map(s => s.step) ?? []
  await ask()
})
watch(
  () => props.draft.redo,
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
        <b>Shots planned again</b> {{ said.plannedAgain.join(', ')
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
</style>
