<script setup lang="ts">
import {computed, ref} from 'vue'
import type {DirectionChange, DirectionEdit, DirectionRule, DirectionShot, DirectionSize} from '../../../../shared/direction'
import ModalDialog from '../../components/ModalDialog.vue'
import ResourceState from '../../components/ResourceState.vue'
import {usePending} from '../../composables/usePending'
import {withNames} from '../../lib/format'
import {useResource} from '../../composables/useResource'
import {useRunDock} from '../../services/run'
import {useToasts} from '../../services/toasts'
import {useProject} from '../project/session'
import ShotPeople from './ShotPeople.vue'
import ShotInstructions from './ShotInstructions.vue'
import ShotProposal from './ShotProposal.vue'

/**
 * One shot, directed where it is seen (#735): who is in it and what each of them does, an instruction for the shot or for one person
 * (the language model turns it into the shot's fields - "Propose"), and the direct edits the code makes itself (a person out of the
 * shot, its size). What is proposed is shown field by field; taking it - and every direct edit - builds the clip prompts again.
 */
const props = defineProps<{shotId: string}>()
const emit = defineEmits<{close: []}>()
const {api, busy, start, changing, project} = useProject()
const toasts = useToasts()
const {data: view, loading, error, reload} = useResource(signal => api.direction(signal))
useRunDock().onEnd(() => {
  void reload()
})
const modal = ref<InstanceType<typeof ModalDialog>>()
const {pending: saving, during} = usePending()
const blocked = computed(() => busy.value || saving.value)
const film = computed(() => project.value.kind === 'film')

const shot = computed<DirectionShot | undefined>(() => view.value?.shots.find(s => s.id === props.shotId))
const data = computed(() => (shot.value?.data ?? {}) as Record<string, unknown>)
const nameOf = (id: string) => view.value?.characters.find(c => c.id === id)?.name ?? id
// the plan writes people as {Name}: shown as their names
const plain = (text: unknown) => (typeof text === 'string' ? withNames(text) : text)

const rules = computed(() => (view.value?.rules ?? []).filter(r => r.scope.kind === 'shot' && r.scope.id === props.shotId))
const edits = computed(() => (view.value?.edits ?? []).filter(e => e.scope.kind === 'shot' && e.scope.id === props.shotId))
const issues = computed(() => (view.value?.editIssues ?? []).filter(i => i.shotId === props.shotId))
const change = computed<DirectionChange | undefined>(() => view.value?.proposal?.changes.find(c => c.shotId === props.shotId))
const otherChanges = computed(() => (view.value?.proposal?.changes.length ?? 0) - (change.value ? 1 : 0))

const SIZES: DirectionSize[] = ['wide', 'medium', 'close', 'extreme']

/** A change saved, then the dialog read again; true when it went through - a failure is said as a toast. */
const work = async (job: () => Promise<unknown>) => {
  let done = false
  await toasts.guard(() =>
    during(async () => {
      await job()
      await reload()
      done = true
    }),
  )()
  return done
}
// people brought in with nothing to do yet: a proposal writes them in, with or without an instruction
const writeIns = computed(() => issues.value.filter(i => i.mentions).length)
/** An instruction for the shot saved - and, to propose, the language model asked in the same step. */
const saveRule = (rule: DirectionRule, propose: boolean) =>
  work(async () => {
    await api.saveDirection([...(view.value?.rules ?? []), rule])
    if (propose) await start({type: 'direction'})
  })
const instructions = ref<InstanceType<typeof ShotInstructions>>()
/** Asked again with what is saved - e.g. for words a direct edit left. */
const proposeAgain = () => work(() => start({type: 'direction'}))
/** Taken, and the clip prompts built again. */
const take = () =>
  work(async () => {
    // the conflicts are shown right above: taking it with them is the director's choice (#795)
    await changing(rebuild => api.takeDirection(!!view.value?.proposal?.conflicts.length, rebuild))
    unbuilt.value = false
    toasts.show('Taken. The clip prompts are built again; render the clip when it is done.')
  })
const drop = () =>
  work(async () => {
    await api.dropDirection()
    // the people were taken out without building the prompts, for the proposal to do it: dropped, they are built now
    if (unbuilt.value) await start({type: 'plan'})
    unbuilt.value = false
  })
const saveEdits = (next: DirectionEdit[]) =>
  work(async () => {
    await changing(rebuild => api.saveDirectionEdits(next, rebuild))
  })
// several people out of the shot in one go (#790), or people of the cast brought in (#792): one save, then one run - the prompts built
// again, or, when the shot's words still name them or leave them nothing to do, one proposal that writes it (taking it builds them)
const unbuilt = ref(false)
const bringIn = (ids: string[], words: string) =>
  work(async () => {
    // taken out of this shot by an edit: that edit goes, and they are back where the plan has them - nothing to write
    const outHere = (e: DirectionEdit) => !!e.remove && ids.includes(e.remove) && e.scope.kind === 'shot' && e.scope.id === props.shotId
    const back = (view.value?.edits ?? []).filter(outHere).map(e => e.remove!)
    const added: DirectionEdit[] = ids.filter(id => !back.includes(id)).map(add => ({id: crypto.randomUUID(), scope: {kind: 'shot', id: props.shotId}, add}))
    const saved = await api.saveDirectionEdits([...(view.value?.edits ?? []).filter(e => !outHere(e)), ...added])
    // what they do there, in the director's words: an instruction on the shot, for the one person when it is one
    if (words)
      await api.saveDirection([
        ...saved.rules,
        {id: crypto.randomUUID(), text: words, scope: {kind: 'shot', id: props.shotId}, ...(ids.length === 1 ? {characterId: ids[0]} : {})},
      ])
    if (words || saved.editIssues.some(i => i.shotId === props.shotId && i.mentions)) {
      unbuilt.value = true
      await start({type: 'direction'})
    } else await start({type: 'plan'})
  })
const takeOut = (ids: string[]) =>
  work(async () => {
    const added: DirectionEdit[] = ids.map(remove => ({id: crypto.randomUUID(), scope: {kind: 'shot', id: props.shotId}, remove}))
    const saved = await api.saveDirectionEdits([...(view.value?.edits ?? []), ...added])
    if (saved.editIssues.some(i => i.shotId === props.shotId && i.mentions)) {
      unbuilt.value = true
      await start({type: 'direction'})
    } else await start({type: 'plan'})
  })
const sized = (size: DirectionSize) =>
  saveEdits([
    ...(view.value?.edits ?? []).filter(e => !(e.size && e.scope.kind === 'shot' && e.scope.id === props.shotId)),
    {id: crypto.randomUUID(), scope: {kind: 'shot', id: props.shotId}, size},
  ])
const unedit = (edit: DirectionEdit) => saveEdits((view.value?.edits ?? []).filter(e => e.id !== edit.id))
const removeRule = (rule: DirectionRule) => work(() => api.saveDirection((view.value?.rules ?? []).filter(r => r.id !== rule.id)))
const describeEdit = (e: DirectionEdit) => (e.remove ? `${nameOf(e.remove)} out of the shot` : e.add ? `${nameOf(e.add)} into the shot` : `size: ${e.size}`)
</script>

<template>
  <ModalDialog ref="modal" class="shot-director" label="Direct this shot" :locked="saving" backdrop-closes @close="emit('close')">
    <ResourceState :loading="loading" :error="error" :loaded="!!view" @retry="reload" />
    <template v-if="view">
      <template v-if="shot">
        <header class="head">
          <h2>{{ shotId }}</h2>
          <span v-if="shot.start !== undefined && shot.end !== undefined" class="num muted">{{ shot.start.toFixed(1) }}–{{ shot.end.toFixed(1) }} s</span>
          <div class="spacer" />
          <button class="btn" @click="modal?.close()">Close</button>
        </header>
        <div class="about">
          <p class="muted">{{ [data.framing, data.camera].filter(Boolean).map(plain).join(' · ') }}</p>
          <p v-if="data.view" class="muted">{{ plain(data.view) }}</p>
          <p class="action">{{ plain(data.action) }}</p>
        </div>

        <div class="btn-row size">
          <span class="muted">Shot size</span>
          <button v-for="size in SIZES" :key="size" :class="['btn', {primary: !film && data.size === size}]" :disabled="blocked" @click="sized(size)">
            {{ size }}
          </button>
        </div>

        <h3>In the picture</h3>
        <ShotPeople
          :shot="shot"
          :view="view"
          :blocked="blocked"
          :name="nameOf"
          :take-out="takeOut"
          :bring-in="bringIn"
          @instruct="instructions?.focusFor($event)"
        />
        <p v-if="data.rest && plain(data.rest) !== 'none'" class="muted rest">Others: {{ plain(data.rest) }}</p>

        <section v-if="edits.length || issues.length" class="list">
          <h3>Direct edits</h3>
          <div v-for="e in edits" :key="e.id" class="row">
            <span>{{ describeEdit(e) }}</span
            ><button class="btn" :disabled="blocked" @click="unedit(e)">Undo</button>
          </div>
          <div v-for="(issue, n) in issues" :key="n" class="row sd-issue">
            <span>{{ issue.message }}</span>
            <button v-if="issue.mentions" class="btn" :disabled="blocked" @click="proposeAgain">
              {{ issue.message.includes('nothing to do') ? 'Write them in' : 'Rewrite the words' }}
            </button>
          </div>
        </section>

        <ShotInstructions
          ref="instructions"
          :shot-id="shotId"
          :shot="shot"
          :rules="rules"
          :blocked="blocked"
          :busy="busy"
          :write-ins="writeIns"
          :name="nameOf"
          :save="saveRule"
          @remove="removeRule"
          @propose="proposeAgain"
        />

        <ShotProposal v-if="change" :change="change" :view="view" :other-changes="otherChanges" :blocked="blocked" :name="nameOf" @take="take" @drop="drop" />
      </template>
      <p v-else class="muted">This shot is not in the plan any more. Open Direction to see the shots there are.</p>
    </template>
  </ModalDialog>
</template>

<style scoped>
/* class names of their own: .person and .notice are taken by the timeline's styles (workspace.css) */
.shot-director {
  width: min(780px, calc(100vw - 32px));
  max-height: calc(100vh - 48px);
  overflow: auto;
  padding: 18px 22px 20px;
}
.head {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
}
.head h2 {
  margin: 0;
  font-size: var(--text-l);
}
.head .btn {
  align-self: center;
}
.spacer {
  flex: 1;
}
.about {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin-top: 10px;
  line-height: 1.45;
}
.about .action {
  margin-top: 4px;
}
h3 {
  margin: 22px 0 8px;
  font-size: var(--text-s);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
}
.size {
  margin-top: 14px;
  align-items: center;
}
.size > .muted {
  margin-right: 4px;
}
.rest {
  margin-top: 4px;
}
.list .row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 7px 0;
  border-top: 1px solid var(--line);
  line-height: 1.4;
}
.list .row:first-of-type {
  border-top: 0;
}
.list .row > span {
  flex: 1;
}
.sd-issue {
  color: var(--text);
  border-left: 3px solid var(--stale);
  padding-left: 10px;
  margin: 6px 0;
}
.list .row.sd-issue {
  border-top: 0;
  padding: 6px 0 6px 10px;
}
</style>
