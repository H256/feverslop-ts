<script setup lang="ts">
import {computed, ref} from 'vue'
import type {DirectionChange, DirectionEdit, DirectionRule, DirectionShot, DirectionSize} from '../../../../shared/direction'
import ModalDialog from '../../components/ModalDialog.vue'
import ResourceState from '../../components/ResourceState.vue'
import {useResource} from '../../composables/useResource'
import {useRunDock} from '../../services/run'
import {useToasts} from '../../services/toasts'
import {useProject} from '../project/session'

/**
 * One shot, directed where it is seen (#735): who is in it and what each of them does, an instruction for the shot or for one person
 * (the language model turns it into the shot's fields - "Propose"), and the direct edits the code makes itself (a person out of the
 * shot, its size). What is proposed is shown field by field; taking it - and every direct edit - builds the clip prompts again.
 */
const props = defineProps<{shotId: string}>()
const emit = defineEmits<{close: []}>()
const {api, busy, start, project} = useProject()
const toasts = useToasts()
const {data: view, loading, error, reload} = useResource(signal => api.direction(signal))
useRunDock().onEnd(() => {
  void reload()
})
const modal = ref<InstanceType<typeof ModalDialog>>()
const saving = ref(false)
const blocked = computed(() => busy.value || saving.value)
const film = computed(() => project.value.kind === 'film')

const shot = computed<DirectionShot | undefined>(() => view.value?.shots.find(s => s.id === props.shotId))
const data = computed(() => (shot.value?.data ?? {}) as Record<string, unknown>)
const people = computed(() => (data.value.people ?? {}) as Record<string, Record<string, unknown>>)
const nameOf = (id: string) => view.value?.characters.find(c => c.id === id)?.name ?? id
// the plan writes people as {Name}: shown as their names
const plain = (text: unknown) => (typeof text === 'string' ? text.replace(/{([^{}]+)}/g, '$1') : text)
const speaks = computed(() => Array.isArray(data.value.lines) && data.value.lines.length > 0)
const flags = (id: string) =>
  [
    people.value[id]?.singing === true && 'sings',
    (people.value[id]?.playing === true || !!people.value[id]?.plays) && 'plays',
    speaks.value && 'speaks',
  ].filter((f): f is string => !!f)
const kept = (id: string) => flags(id).length > 0

const rules = computed(() => (view.value?.rules ?? []).filter(r => r.scope.kind === 'shot' && r.scope.id === props.shotId))
const edits = computed(() => (view.value?.edits ?? []).filter(e => e.scope.kind === 'shot' && e.scope.id === props.shotId))
const issues = computed(() => (view.value?.editIssues ?? []).filter(i => i.shotId === props.shotId))
const change = computed<DirectionChange | undefined>(() => view.value?.proposal?.changes.find(c => c.shotId === props.shotId))
const otherChanges = computed(() => (view.value?.proposal?.changes.length ?? 0) - (change.value ? 1 : 0))

// the instruction being written, for the shot or one person of it
const text = ref('')
const forWhom = ref('')
const SIZES: DirectionSize[] = ['wide', 'medium', 'close', 'extreme']

const work = (job: () => Promise<unknown>) =>
  toasts.guard(async () => {
    saving.value = true
    try {
      await job()
      await reload()
    } finally {
      saving.value = false
    }
  })()
/** Saved, then the language model asked - one step. */
const propose = () =>
  work(async () => {
    const rule: DirectionRule = {
      id: crypto.randomUUID(),
      text: text.value.trim(),
      scope: {kind: 'shot', id: props.shotId},
      ...(forWhom.value ? {characterId: forWhom.value} : {}),
    }
    await api.saveDirection([...(view.value?.rules ?? []), rule])
    text.value = ''
    await start({type: 'direction'})
  })
/** Asked again with what is saved - e.g. for words a direct edit left. */
const proposeAgain = () => work(() => start({type: 'direction'}))
/** Taken, and the clip prompts built again. */
const take = () =>
  work(async () => {
    await api.takeDirection()
    unbuilt.value = false
    await start({type: 'plan'})
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
    await api.saveDirectionEdits(next)
    await start({type: 'plan'})
  })
// several people out of the shot in one go (#790): marked, then taken out together - one save, and then one run: the prompts built
// again, or, when the shot's words still name one of them, one proposal that writes it without all of them (taking it builds them)
const outs = ref(new Set<string>())
const unbuilt = ref(false)
const markOut = (id: string) => {
  const next = new Set(outs.value)
  if (!next.delete(id)) next.add(id)
  outs.value = next
}
const outNames = computed(() => [...outs.value].map(nameOf))
// people of the cast brought into this shot (#792): put in by the code, their place in the shot written by one proposal
const ins = ref(new Set<string>())
const inText = ref('')
const markIn = (id: string) => {
  const next = new Set(ins.value)
  if (!next.delete(id)) next.add(id)
  ins.value = next
}
const others = computed(() => (view.value?.characters ?? []).filter(c => !shot.value?.characters.includes(c.id)))
const inNames = computed(() => [...ins.value].map(nameOf))
const bringIn = () =>
  work(async () => {
    const ids = [...ins.value]
    // taken out of this shot by an edit: that edit goes, and they are back where the plan has them - nothing to write
    const outHere = (e: DirectionEdit) => !!e.remove && ids.includes(e.remove) && e.scope.kind === 'shot' && e.scope.id === props.shotId
    const back = (view.value?.edits ?? []).filter(outHere).map(e => e.remove!)
    const added: DirectionEdit[] = ids.filter(id => !back.includes(id)).map(add => ({id: crypto.randomUUID(), scope: {kind: 'shot', id: props.shotId}, add}))
    const saved = await api.saveDirectionEdits([...(view.value?.edits ?? []).filter(e => !outHere(e)), ...added])
    // what they do there, in the director's words: an instruction on the shot, for the one person when it is one
    if (inText.value.trim())
      await api.saveDirection([
        ...saved.rules,
        {id: crypto.randomUUID(), text: inText.value.trim(), scope: {kind: 'shot', id: props.shotId}, ...(ids.length === 1 ? {characterId: ids[0]} : {})},
      ])
    const words = !!inText.value.trim()
    ins.value = new Set()
    inText.value = ''
    if (words || saved.editIssues.some(i => i.shotId === props.shotId && i.mentions)) {
      unbuilt.value = true
      await start({type: 'direction'})
    } else await start({type: 'plan'})
  })
const takeOut = () =>
  work(async () => {
    const added: DirectionEdit[] = [...outs.value].map(remove => ({id: crypto.randomUUID(), scope: {kind: 'shot', id: props.shotId}, remove}))
    const saved = await api.saveDirectionEdits([...(view.value?.edits ?? []), ...added])
    outs.value = new Set()
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

// before and after, field by field - only what changed
const LABELS: Record<string, string> = {
  action: 'Action',
  framing: 'Framing',
  camera: 'Camera',
  view: 'Camera position',
  hold: 'Hold still',
  size: 'Size',
  rest: 'Others',
  hands: 'Instrument hands',
  characters: 'In the picture',
  state: 'Start',
  frame: 'In frame',
  motion: 'Movement',
  facing: 'Facing',
  plays: 'Instrument',
}
const show = (value: unknown) => (Array.isArray(value) ? value.map(v => nameOf(String(v))).join(', ') : value === undefined ? '—' : String(plain(value)))
const diff = computed(() => {
  const c = change.value
  if (!c) return []
  const rows: {label: string; before: string; after: string}[] = []
  const compare = (prefix: string, a: Record<string, unknown>, b: Record<string, unknown>) => {
    for (const key of Object.keys(LABELS))
      if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) rows.push({label: `${prefix}${LABELS[key]}`, before: show(a[key]), after: show(b[key])})
  }
  compare('', c.before, c.after)
  const bp = (c.before.people ?? {}) as Record<string, Record<string, unknown>>,
    ap = (c.after.people ?? {}) as Record<string, Record<string, unknown>>
  for (const id of new Set([...Object.keys(bp), ...Object.keys(ap)])) compare(`${nameOf(id)} · `, bp[id] ?? {}, ap[id] ?? {})
  return rows
})
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
        <article v-for="id in shot.characters" :key="id" class="sd-person">
          <header>
            <b class="who">{{ nameOf(id) }}</b>
            <span v-for="flag in flags(id)" :key="flag" class="chip">{{ flag }}</span>
            <div class="spacer" />
            <button class="btn" :disabled="blocked" @click="forWhom = id">Instruction for {{ nameOf(id) }}</button>
            <label
              :class="['btn', 'out-mark', {on: outs.has(id), disabled: blocked || kept(id)}]"
              :title="kept(id) ? `${nameOf(id)} ${flags(id).join(' and ')} in this shot and stays in it` : 'Mark to take out of the shot - several at once'"
            >
              <input type="checkbox" :checked="outs.has(id)" :disabled="blocked || kept(id)" @change="markOut(id)" />
              Take out
            </label>
          </header>
          <dl>
            <template v-for="key in ['state', 'frame', 'motion', 'facing']" :key="key">
              <template v-if="people[id]?.[key]"
                ><dt>{{ LABELS[key] }}</dt>
                <dd>{{ plain(people[id]![key]) }}</dd></template
              >
            </template>
          </dl>
        </article>
        <div v-if="outs.size" class="btn-row out-bar">
          <button class="btn primary" :disabled="blocked" @click="takeOut">Take {{ outNames.join(', ') }} out of the shot</button>
          <button class="btn" :disabled="blocked" @click="outs = new Set()">Clear</button>
          <span class="muted">By code. If the shot's words still name them, one proposal writes it without all of them.</span>
        </div>
        <p v-if="!shot.characters.length" class="muted">Nobody - the shot shows the place.</p>
        <section v-if="others.length" class="bring">
          <div class="btn-row">
            <span class="muted">Bring in</span>
            <button
              v-for="c in others"
              :key="c.id"
              :class="['btn', 'in-mark', {on: ins.has(c.id)}]"
              :aria-pressed="ins.has(c.id)"
              :disabled="blocked"
              :title="`Put ${c.name} into this shot - several at once`"
              @click="markIn(c.id)"
            >
              + {{ c.name }}
            </button>
          </div>
          <template v-if="ins.size">
            <textarea
              v-model="inText"
              rows="2"
              :placeholder="`What ${inNames.join(' and ')} ${ins.size > 1 ? 'do' : 'does'} here (optional) - e.g. walks in from the left and stops behind Elias`"
            />
            <div class="btn-row out-bar">
              <button class="btn primary" :disabled="blocked" @click="bringIn">Bring {{ inNames.join(', ') }} into the shot</button>
              <button class="btn" :disabled="blocked" @click="ins = new Set()">Clear</button>
              <span class="muted">By code; one proposal writes where they are and what they do. Nothing is rendered.</span>
            </div>
          </template>
        </section>
        <p v-if="data.rest && plain(data.rest) !== 'none'" class="muted rest">Others: {{ plain(data.rest) }}</p>

        <section v-if="edits.length || issues.length" class="list">
          <h3>Direct edits</h3>
          <div v-for="e in edits" :key="e.id" class="row">
            <span>{{ describeEdit(e) }}</span
            ><button class="btn" :disabled="blocked" @click="unedit(e)">Undo</button>
          </div>
          <div v-for="(issue, n) in issues" :key="n" class="row sd-issue">
            <span>{{ issue.message }}</span>
            <button v-if="issue.mentions" class="btn" :disabled="blocked" @click="proposeAgain">Rewrite the words</button>
          </div>
        </section>

        <section class="list">
          <h3>Instructions</h3>
          <div v-for="r in rules" :key="r.id" class="row">
            <span>{{ r.characterId ? `${nameOf(r.characterId)}: ` : '' }}{{ r.text }}</span
            ><button class="btn" :disabled="blocked" @click="removeRule(r)">Remove</button>
          </div>
          <label class="instruction">
            <span
              >{{ forWhom ? `For ${nameOf(forWhom)} in this shot` : 'For this shot'
              }}<button v-if="forWhom" class="link" @click="forWhom = ''">for the whole shot</button></span
            >
            <textarea
              v-model="text"
              rows="3"
              :placeholder="
                forWhom
                  ? `${nameOf(forWhom)} turns toward his own left, ending with his back to the camera.`
                  : 'The camera stays low; everyone keeps still while the light changes.'
              "
            />
          </label>
          <div class="btn-row propose">
            <button class="btn primary" :disabled="blocked || !text.trim()" @click="propose">Propose</button>
            <span class="muted">{{ busy ? 'A run is going on…' : 'The language model writes the shot anew; nothing is rendered.' }}</span>
          </div>
        </section>

        <section v-if="change" class="list">
          <h3>Proposed</h3>
          <table class="diff">
            <tr v-for="row in diff" :key="row.label">
              <th>{{ row.label }}</th>
              <td class="before">{{ row.before }}</td>
              <td class="after">{{ row.after }}</td>
            </tr>
          </table>
          <p v-if="!diff.length" class="muted">The shot already does what was asked - nothing changes.</p>
          <p v-for="c in view?.proposal?.conflicts ?? []" :key="c" class="sd-issue">{{ c }}</p>
          <p v-if="otherChanges" class="muted">The proposal changes {{ otherChanges }} more shot(s) - see Direction.</p>
          <div class="btn-row">
            <button
              class="btn primary"
              :disabled="blocked || !!view?.proposalStale || !!view?.proposal?.conflicts.length || !!view?.unresolved.length"
              @click="take"
            >
              Take and build the prompts
            </button>
            <button class="btn" :disabled="blocked" @click="drop">Drop</button>
          </div>
        </section>
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
  gap: 10px;
}
.head h2 {
  margin: 0;
  font-size: 16px;
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
  gap: 4px;
  margin-top: 10px;
  line-height: 1.45;
}
.about .action {
  margin-top: 4px;
}
h3 {
  margin: 22px 0 8px;
  font-size: 12px;
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
.sd-person {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 8px;
}
.sd-person header {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.sd-person .who {
  font-size: 14px;
  font-weight: 600;
  margin-right: 2px;
}
.sd-person dl {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 14px;
  margin: 10px 0 0;
  line-height: 1.4;
}
.sd-person dt {
  color: var(--muted);
}
.sd-person dd {
  margin: 0;
}
.out-mark {
  cursor: pointer;
}
.out-mark input {
  margin: 0;
}
.out-mark.on {
  border-color: var(--danger);
  color: var(--danger);
}
.out-mark.disabled {
  opacity: 0.5;
  cursor: default;
}
.bring {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 10px 0 4px;
}
.bring > .btn-row {
  align-items: center;
}
.bring textarea {
  width: 100%;
}
.in-mark.on {
  border-color: var(--accent);
  color: var(--accent);
}
.out-bar {
  align-items: center;
  margin: 4px 0 8px;
}
.rest {
  margin-top: 4px;
}
.list .row {
  display: flex;
  align-items: center;
  gap: 12px;
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
.instruction {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 12px;
}
.instruction span {
  display: flex;
  gap: 8px;
  align-items: baseline;
}
.instruction textarea {
  width: 100%;
}
.propose {
  align-items: center;
  margin-top: 8px;
}
.diff {
  width: 100%;
  border-collapse: collapse;
}
.diff th {
  text-align: left;
  vertical-align: top;
  padding: 6px 10px 6px 0;
  color: var(--muted);
  font-weight: normal;
  white-space: nowrap;
}
.diff td {
  vertical-align: top;
  padding: 6px 8px;
  width: 50%;
}
.diff .before {
  text-decoration: line-through;
  color: var(--muted);
}
.diff .after {
  background: var(--raised);
}
@media (max-width: 600px) {
  .diff th,
  .diff td {
    display: block;
    width: auto;
  }
}
</style>
