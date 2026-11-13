<script setup lang="ts">
import CalloutBox from '../../components/CalloutBox.vue'
import {computed, ref} from 'vue'
import type {DirectionEdit, DirectionRule} from '../../../../shared/direction'
import PageBar from '../../components/PageBar.vue'
import SplitLayout from '../../components/SplitLayout.vue'
import TabBar from '../../components/TabBar.vue'
import ResourceState from '../../components/ResourceState.vue'
import {usePending} from '../../composables/usePending'
import {useAsk} from '../../services/ask'
import {useToasts} from '../../services/toasts'
import {useProject} from '../project/session'
import {usePageData} from '../project/usePageData'
import DirectionList from './DirectionList.vue'
import {filterItems, itemsOf, type Item} from './directionItems'
import EditForm from './EditForm.vue'
import InstructionForm from './InstructionForm.vue'
import ProposalCard from './ProposalCard.vue'
import PlanVersions from './PlanVersions.vue'
import './direction.css'

/** The direction of a planned video (#839): its instructions and edits, the proposal of the language model, and the plan versions. */
const {api, project, busy, start, changing, root} = useProject()
const {data: view, loading, error, reload, refresh} = usePageData(signal => api.direction(signal))
const toasts = useToasts()
const ask = useAsk()
const {pending: saving, during} = usePending()
const blocked = computed(() => busy.value || saving.value)
const film = computed(() => project.value.kind === 'film')
const command = computed(() => `bun run direction ${project.value.id}${film.value ? ' --film' : ''}`)
const form = ref<InstanceType<typeof InstructionForm>>()
const dirty = ref(false)
const tab = ref<'instruction' | 'edit'>('instruction')

const name = (id: string) => view.value?.characters.find(c => c.id === id)?.name ?? id
/** A shot's place on the timeline, its dialog opened there. */
const inTimeline = (shotId: string) => ({path: `${root}/`, query: {direct: shotId}})
const rules = () => view.value?.rules ?? []
const edits = () => view.value?.edits ?? []

/** A change saved, then the page read again - one at a time, a failure said as a toast. */
// one guarded action for every change: a failure goes when the next change works (#940)
const changeGuarded = toasts.guard((work: () => Promise<unknown>) =>
  during(async () => {
    await work()
    await refresh()
  }),
)
const change = (work: () => Promise<unknown>) => changeGuarded(work)

const save = (rule: DirectionRule) =>
  change(async () => {
    await api.saveDirection([...rules().filter(r => r.id !== rule.id), rule])
    form.value?.clear()
    toasts.show('Instruction saved. Preview its effect on the shots.')
  })
const remove = (rule: DirectionRule) =>
  change(async () => {
    const yes = await ask({
      title: 'Remove this instruction?',
      lines: ['The instruction is removed. Accepted shot changes stay; use a plan version to undo them.'],
      confirm: 'Remove instruction',
    })
    if (!yes) return
    await api.saveDirection(rules().filter(r => r.id !== rule.id))
    if (form.value?.editing?.id === rule.id) form.value.clear()
  })
const rebind = (rule: DirectionRule) =>
  change(async () => {
    const yes = await ask({
      title: 'Use the current scene or shot?',
      lines: [
        'The source changed. Bind this instruction to the current selection only after checking it is still the intended scene or shot. A fresh preview is required.',
      ],
      confirm: 'Bind to current selection',
    })
    if (!yes) return
    await api.saveDirection(
      rules().map(r => {
        if (r.id !== rule.id) return r
        const {binding: _binding, ...next} = r
        return next
      }),
    )
  })
const preview = toasts.guard(() => start({type: 'direction'}))
// taken or restored: the clip prompts are built again at once - the planning run, nothing is rendered
const take = () =>
  change(async () => {
    await changing(rebuild => api.takeDirection(!!view.value?.proposal?.conflicts.length, rebuild))
    toasts.show('Changes taken. The clip prompts are built again; render the affected clips on the timeline.')
  })
const drop = () => change(() => api.dropDirection())
const restore = (id: string) =>
  change(async () => {
    const yes = await ask({
      title: 'Restore this plan version?',
      lines: [
        'Accepted shot edits are replaced by this version. Instructions remain saved; rendered videos remain available. The clip prompts are built again.',
      ],
      confirm: 'Restore plan',
    })
    if (yes) await changing(rebuild => api.restoreDirection(id, rebuild))
  })
const plan = toasts.guard(() => start({type: 'plan'}))
const saveEdits = (next: DirectionEdit[]) => change(() => changing(rebuild => api.saveDirectionEdits(next, rebuild)))
const addEdit = (edit: DirectionEdit) => saveEdits([...edits(), edit])
const unedit = (edit: DirectionEdit) => saveEdits(edits().filter(e => e.id !== edit.id))
const editRule = (rule: DirectionRule) => {
  form.value?.edit(rule)
  tab.value = 'instruction'
}

const filterText = ref('')
const filterWho = ref('')
const items = computed(() => (view.value ? itemsOf(view.value, name) : []))
const shown = computed(() => filterItems(items.value, filterText.value, filterWho.value, name))
// left open for the preview to write (#802): said at its button
const writes = computed(() => items.value.filter(item => item.writes && !item.leftover))
/** The leftovers gone, one save each; the clip prompts built again unless instructions still wait for a preview. */
const clearLeftovers = (only?: Item) =>
  change(async () => {
    const gone = only ? [only] : items.value.filter(item => item.leftover)
    const editIds = new Set(gone.flatMap(i => (i.edit ? [i.edit.id] : [])))
    const ruleIds = new Set(gone.flatMap(i => (i.rule ? [i.rule.id] : [])))
    if (ruleIds.size) await api.saveDirection(rules().filter(r => !ruleIds.has(r.id)))
    if (editIds.size)
      await changing(rebuild =>
        api.saveDirectionEdits(
          edits().filter(e => !editIds.has(e.id)),
          rebuild,
        ),
      )
    toasts.show(only ? 'Cleared.' : `Cleared ${gone.length} leftover${gone.length > 1 ? 's' : ''} of the old plan.`)
  })
</script>

<template>
  <div class="scrollpage view direction-page">
    <PageBar title="Direction" />
    <p class="muted intro">
      Movement, performance and framing of a planned video - story, cast, sound and cuts stay. One shot is directed best on the timeline (<b>Direct this shot</b
      >, or a click on a cast lane); here are the instructions and edits of all shots.
    </p>
    <ResourceState :loading="loading" :error="error" :loaded="!!view" @retry="reload" />
    <SplitLayout v-if="view" side="360px" sticky side-first label="Instructions and edits">
      <main class="direction-main">
        <CalloutBox v-if="!view.shots.length">Plan the shots first. You can save instructions now and preview them once shots exist.</CalloutBox>
        <CalloutBox v-if="view.restored"
          >A saved plan version is restored. The instructions remain saved; preview again to apply them to this version.</CalloutBox
        >

        <!-- what to do next: the proposal to take, or the preview to ask for -->
        <ProposalCard
          v-if="view.proposal"
          :view="{...view, proposal: view.proposal}"
          :blocked="blocked"
          :dirty="dirty"
          :name="name"
          :timeline="inTimeline"
          @take="take"
          @drop="drop"
        />
        <div v-else class="actionbar">
          <CalloutBox v-if="writes.length" kind="warn" as="span" class="inline"
            >{{ writes.length }} edit{{ writes.length > 1 ? 's' : '' }} wait{{ writes.length > 1 ? '' : 's' }} for the words: <b>Preview changes</b> writes
            them.</CalloutBox
          >
          <CalloutBox v-else-if="view.pending" kind="warn" as="span" class="inline">Instructions changed: preview, then take the proposal.</CalloutBox>
          <span v-else class="muted">The language model writes the shots the instructions are about. Nothing is rendered.</span>
          <div class="spacer" />
          <button class="btn primary" :disabled="blocked || dirty || !view.rules.length || !view.shots.length || !!view.unresolved.length" @click="preview">
            Preview changes
          </button>
        </div>

        <div class="filters">
          <input v-model="filterText" type="search" placeholder="Filter by words, beat or shot" aria-label="Filter" />
          <select v-model="filterWho" aria-label="Character">
            <option value="">Everyone</option>
            <option v-for="c in view.characters" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
          <span class="muted small">{{ shown.length }} of {{ items.length }}</span>
        </div>

        <DirectionList
          :view="view"
          :items="items"
          :shown="shown"
          :name="name"
          :blocked="blocked"
          :dirty="dirty"
          :timeline="inTimeline"
          @edit="editRule"
          @remove="remove"
          @undo="unedit"
          @rebind="rebind"
          @clear="clearLeftovers"
        />
      </main>

      <template #side>
        <div class="direction-side">
          <TabBar
            v-model="tab"
            :tabs="[
              {id: 'instruction', label: form?.editing ? 'Edit instruction' : 'New instruction'},
              {id: 'edit', label: 'Direct edit'},
            ]"
          />
          <InstructionForm v-show="tab === 'instruction'" ref="form" v-model:dirty="dirty" :view="view" :film="film" :blocked="blocked" @save="save" />
          <EditForm v-show="tab === 'edit'" :view="view" :film="film" :blocked="blocked" @add="addEdit" />

          <PlanVersions :view="view" :blocked="blocked" :command="command" @plan="plan" @restore="restore" />
        </div>
      </template>
    </SplitLayout>
  </div>
</template>

<style scoped>
.intro {
  max-width: 110ch;
  margin-bottom: 14px;
}
.direction-main {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}
.direction-side {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  border: 1px solid var(--line);
  border-radius: var(--radius-m);
  padding: 12px 14px 14px;
  background: var(--surface);
  max-height: calc(100vh - 140px);
  overflow: auto;
}
.small {
  font-size: var(--text-s);
}
.actionbar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 10px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius-m);
}
.actionbar .ui-callout.inline {
  margin: 0;
}
.spacer {
  flex: 1;
}
.filters {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.filters input {
  flex: 1;
  max-width: 420px;
}
@media (max-width: 960px) {
  .direction-side {
    max-height: none;
  }
}
</style>
