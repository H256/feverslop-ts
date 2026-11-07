<script setup lang="ts">
import {computed, ref, watch} from 'vue'
import {useRoute} from 'vue-router'
import type {DirectionRule, DirectionScope} from '../../../../shared/direction'
import PageBar from '../../components/PageBar.vue'
import ResourceState from '../../components/ResourceState.vue'
import {useUnsavedChanges} from '../../composables/useUnsavedChanges'
import {useAsk} from '../../services/ask'
import {useToasts} from '../../services/toasts'
import {useProject} from '../project/session'
import {usePageData} from '../project/usePageData'

const {api, project, busy, start} = useProject()
const {data: view, loading, error, reload, refresh} = usePageData(signal => api.direction(signal))
const route = useRoute()
const toasts = useToasts()
const ask = useAsk()
const saving = ref(false)
const blocked = computed(() => busy.value || saving.value)
const text = ref('')
const scopeKind = ref<DirectionScope['kind']>('global')
const scopeId = ref('')
const characterId = ref('')
const from = ref(0), to = ref(10)
const editing = ref<DirectionRule>()
const film = computed(() => project.value.kind === 'film')
const command = computed(() => `bun run direction ${project.value.id}${film.value ? ' --film' : ''}`)
const scope = computed<DirectionScope>(() => scopeKind.value === 'global' ? {kind: 'global'} : scopeKind.value === 'time' ? {kind: 'time', start: Number(from.value), end: Number(to.value)} : {kind: scopeKind.value, id: scopeId.value})
const dirty = computed(() => editing.value ? text.value !== editing.value.text || JSON.stringify(scope.value) !== JSON.stringify(editing.value.scope) || characterId.value !== (editing.value.characterId ?? '') : !!text.value)
useUnsavedChanges(() => dirty.value, 'direction instruction')
const invalid = computed(() => !text.value.trim() || (scopeKind.value !== 'global' && scopeKind.value !== 'time' && !scopeId.value) || (scopeKind.value === 'time' && (!Number.isFinite(Number(from.value)) || Number(from.value) < 0 || Number(to.value) <= Number(from.value))))

watch(() => route.query.shot, id => { if (typeof id === 'string' && !dirty.value) { scopeKind.value = 'shot'; scopeId.value = id } }, {immediate: true})
const clear = () => { text.value = ''; editing.value = undefined; characterId.value = '' }
const edit = (rule: DirectionRule) => {
  editing.value = rule; text.value = rule.text; scopeKind.value = rule.scope.kind; characterId.value = rule.characterId ?? ''
  if ('id' in rule.scope) scopeId.value = rule.scope.id
  if (rule.scope.kind === 'time') { from.value = rule.scope.start; to.value = rule.scope.end }
}
const change = (work: () => Promise<unknown>) => toasts.guard(async () => {
  saving.value = true
  try { await work(); await refresh() } finally { saving.value = false }
})()
const save = () => change(async () => {
  const old = editing.value
  const sameScope = old && JSON.stringify(old.scope) === JSON.stringify(scope.value) && old.characterId === (characterId.value || undefined)
  const rule: DirectionRule = {id: old?.id ?? crypto.randomUUID(), text: text.value, scope: scope.value, ...(characterId.value ? {characterId: characterId.value} : {}), ...(sameScope && old.binding ? {binding: old.binding} : {})}
  await api.saveDirection([...(view.value?.rules ?? []).filter(r => r.id !== rule.id), rule]); clear()
  toasts.show('Instruction saved. Preview its effect on the shots.')
})
const remove = (rule: DirectionRule) => change(async () => {
  const yes = await ask({title: 'Remove this instruction?', lines: ['The instruction is removed. Accepted shot changes stay; use a plan version to undo them.'], confirm: 'Remove instruction'})
  if (!yes) return
  await api.saveDirection((view.value?.rules ?? []).filter(r => r.id !== rule.id))
  if (editing.value?.id === rule.id) clear()
})
const rebind = (rule: DirectionRule) => change(async () => {
  const yes = await ask({title: 'Use the current scene or shot?', lines: ['The source changed. Bind this instruction to the current selection only after checking it is still the intended scene or shot. A fresh preview is required.'], confirm: 'Bind to current selection'})
  if (!yes) return
  await api.saveDirection((view.value?.rules ?? []).map(r => { if (r.id !== rule.id) return r; const {binding, ...next} = r; return next }))
})
const preview = toasts.guard(() => start({type: 'direction'}))
const take = () => change(async () => { await api.takeDirection(); toasts.show('Changes taken. Update clip prompts before rendering.') })
const drop = () => change(() => api.dropDirection())
const restore = (id: string) => change(async () => {
  if (await ask({title: 'Restore this plan version?', lines: ['Accepted shot edits are replaced by this version. Instructions remain saved; rendered videos remain available. Update clip prompts afterwards.'], confirm: 'Restore plan'})) await api.restoreDirection(id)
})
const plan = toasts.guard(() => start({type: 'plan'}))
const scopeText = (s: DirectionScope) => s.kind === 'global' ? 'Whole project' : s.kind === 'time' ? `${s.start}–${s.end} s` : `${s.kind}: ${s.id}`
const name = (id: string) => view.value?.characters.find(c => c.id === id)?.name ?? id
const ruleIssue = (id: string) => view.value?.unresolved.find(r => r.ruleId === id)?.message
// Readable before/after, including pose and motion instead of hiding those edits behind the action sentence.
function describe(data: Record<string, unknown>): string {
  const labels: Record<string, string> = {action: 'Action', framing: 'Framing', camera: 'Camera', view: 'Camera position', hold: 'Hold still', size: 'Shot size', rest: 'Others', hands: 'Instrument hands', characters: 'Visible characters', state: 'Start pose', frame: 'In frame', motion: 'Movement', facing: 'Facing', plays: 'Instrument action', singing: 'Singing', playing: 'Playing'}
  const fields = (obj: Record<string, unknown>) => Object.entries(obj).filter(([key]) => key in labels).map(([key, value]) => `${labels[key]}: ${Array.isArray(value) ? value.map(String).map(name).join(', ') : String(value)}`)
  const lines = fields(data)
  if (data.people && typeof data.people === 'object') for (const [id, person] of Object.entries(data.people)) lines.push(`${name(id)}\n${fields(person as Record<string, unknown>).map(s => `  ${s}`).join('\n')}`)
  return lines.join('\n')
}
</script>

<template>
  <div class="scrollpage view">
    <PageBar title="Direction" />
    <p class="muted">Tune movement, performance and framing in an existing plan. Preview first; story, cast, sound and cut timing stay.</p>
    <ResourceState :loading="loading" :error="error" :loaded="!!view" @retry="reload" />
    <template v-if="view">
      <p v-if="!view.shots.length" class="note">Plan the shots first. You can save instructions now and preview them once shots exist.</p>
      <p v-if="view.pending" class="warn">Instructions or the source plan changed. Review a fresh proposal before continuing.</p>
      <p v-if="view.restored" class="note">A saved plan version is restored. The instructions remain saved; preview again to apply them to this version.</p>
      <section class="section">
        <h2>{{ editing ? 'Edit instruction' : 'New instruction' }}</h2>
        <fieldset :disabled="blocked" class="direction-form">
          <label>Scope<select v-model="scopeKind" @change="scopeId = ''"><option value="global">Whole project</option><option value="character">Character throughout</option><option :value="film ? 'scene' : 'beat'">{{ film ? 'Scene' : 'Beat' }}</option><option v-if="!film" value="time">Song time range</option><option value="shot">One shot</option></select></label>
          <label v-if="scopeKind === 'character'">Character<select v-model="scopeId"><option value="" disabled>Choose character</option><option v-for="c in view.characters" :key="c.id" :value="c.id">{{ c.name }}</option></select></label>
          <label v-if="scopeKind === 'beat' || scopeKind === 'scene'">{{ film ? 'Scene' : 'Beat' }}<select v-model="scopeId"><option value="" disabled>Choose {{ film ? 'scene' : 'beat' }}</option><option v-for="g in view.groups" :key="g.id" :value="g.id">{{ g.id }} · {{ g.label }}</option></select></label>
          <label v-if="scopeKind === 'shot'">Shot<select v-model="scopeId"><option value="" disabled>Choose shot</option><option v-for="shot in view.shots" :key="shot.id" :value="shot.id">{{ shot.id }} · {{ shot.data.action }}</option></select></label>
          <template v-if="scopeKind === 'time'"><label>From (seconds)<input v-model.number="from" type="number" min="0" step="0.1"></label><label>To (seconds)<input v-model.number="to" type="number" min="0" step="0.1"></label></template>
          <label v-if="scopeKind !== 'character'">Only for character<select v-model="characterId"><option value="">Everyone in scope</option><option v-for="c in view.characters" :key="c.id" :value="c.id">{{ c.name }}</option></select></label>
          <label class="instruction">Instruction<textarea v-model="text" rows="4" placeholder="Kael turns toward his own left, ending with his back to the camera." /></label>
          <div class="btn-row"><button class="btn primary" :disabled="invalid || !dirty" @click="save">Save instruction</button><button v-if="editing || text" class="btn" @click="clear">Cancel edit</button></div>
        </fieldset>
      </section>
      <section class="section"><h2>Saved instructions</h2>
        <p v-if="!view.rules.length" class="muted">No instructions yet.</p>
        <article v-for="rule in view.rules" :key="rule.id" class="direction-rule">
          <b>{{ scopeText(rule.scope) }}{{ rule.characterId ? ` · ${name(rule.characterId)}` : '' }}</b><p class="prose">{{ rule.text }}</p>
          <p v-if="ruleIssue(rule.id)" class="warn">{{ ruleIssue(rule.id) }}</p>
          <div class="btn-row"><button class="btn" :disabled="blocked || dirty" @click="edit(rule)">Edit instruction</button><button class="btn" :disabled="blocked" @click="remove(rule)">Remove instruction</button><button v-if="rule.binding && ruleIssue(rule.id)" class="btn" :disabled="blocked" @click="rebind(rule)">Review current binding</button></div>
        </article>
        <div class="btn-row"><button class="btn primary" :disabled="blocked || dirty || !view.rules.length || !view.shots.length || !!view.unresolved.length" @click="preview">Preview changes</button><span class="muted">The language model only. Nothing is rendered.</span></div>
      </section>
      <section v-if="view.proposal" class="section"><h2>Proposed changes</h2>
        <p v-if="view.proposalStale" class="warn">This proposal belongs to an older plan or set of instructions. Preview again before taking it.</p>
        <p v-if="!view.proposal.changes.length" class="muted">No shot changes proposed.</p>
        <p v-for="conflict in view.proposal.conflicts" :key="conflict" class="warn">{{ conflict }}</p>
        <p v-if="view.proposal.conflicts.length" class="muted">Edit the instructions or expand their scope to resolve these conflicts, then preview again.</p>
        <article v-for="change in view.proposal.changes" :key="change.shotId" class="direction-change"><h3>{{ change.shotId }}</h3><div class="comparison"><div><b>Before</b><pre>{{ describe(change.before) }}</pre></div><div><b>After</b><pre>{{ describe(change.after) }}</pre></div></div></article>
        <div class="btn-row"><button class="btn primary" :disabled="blocked || dirty || view.proposalStale || !!view.proposal.conflicts.length || !!view.unresolved.length" @click="take">Take changes</button><button class="btn" :disabled="blocked" @click="drop">Drop proposal</button></div>
      </section>
      <section v-if="view.activeVersion" class="section"><h2>Accepted plan</h2><p>Update clip prompts after taking or restoring changes. Then render affected clips on the timeline; previous videos remain available.</p><button class="btn" :disabled="blocked || view.pending" @click="plan">Update clip prompts</button></section>
      <details v-if="view.versions.length" class="section"><summary>Plan versions ({{ view.versions.length }})</summary><div v-for="version in [...view.versions].reverse()" :key="version.id" class="direction-rule"><span>{{ version.id.startsWith('baseline-') ? 'Original plan' : new Date(version.createdAt).toLocaleString() }} · {{ version.changes.length }} shot edits{{ version.id === view.activeVersion ? ' · current' : '' }}</span><button class="btn" :disabled="blocked || version.id === view.activeVersion" @click="restore(version.id)">Restore plan</button></div></details>
      <details class="section"><summary>CLI</summary><pre>{{ command }} --json
{{ command }} --preview
{{ command }} --take
{{ command }} --drop</pre></details>
    </template>
  </div>
</template>

<style scoped>
.direction-form {border: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 12px}
.direction-form label {display: flex; flex-direction: column; gap: 5px; flex: 1 1 220px; min-width: 0}
.direction-form .instruction, .direction-form .btn-row {flex-basis: 100%}
.direction-form select {max-width: 100%}
.direction-rule, .direction-change {padding: 12px 0; border-bottom: 1px solid var(--line, #444); margin-bottom: 12px}
.comparison {display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px}
pre, .prose {white-space: pre-wrap; overflow-wrap: anywhere}
pre {font: inherit; line-height: 1.6}
@media (max-width: 700px) {.comparison {grid-template-columns: 1fr}}
</style>
