<script setup lang="ts">
import {computed, ref, watch} from 'vue'
import {useRoute} from 'vue-router'
import {RouterLink} from 'vue-router'
import type {DirectionEdit, DirectionRule, DirectionScope, DirectionSize} from '../../../../shared/direction'
import PageBar from '../../components/PageBar.vue'
import ResourceState from '../../components/ResourceState.vue'
import {useUnsavedChanges} from '../../composables/useUnsavedChanges'
import {useAsk} from '../../services/ask'
import {useToasts} from '../../services/toasts'
import {useProject} from '../project/session'
import {usePageData} from '../project/usePageData'

const {api, project, busy, start, root} = useProject()
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
const from = ref(0),
  to = ref(10)
const editing = ref<DirectionRule>()
const film = computed(() => project.value.kind === 'film')
const command = computed(() => `bun run direction ${project.value.id}${film.value ? ' --film' : ''}`)
const scope = computed<DirectionScope>(() =>
  scopeKind.value === 'global'
    ? {kind: 'global'}
    : scopeKind.value === 'time'
      ? {kind: 'time', start: Number(from.value), end: Number(to.value)}
      : {kind: scopeKind.value, id: scopeId.value},
)
const dirty = computed(() =>
  editing.value
    ? text.value !== editing.value.text ||
      JSON.stringify(scope.value) !== JSON.stringify(editing.value.scope) ||
      characterId.value !== (editing.value.characterId ?? '')
    : !!text.value,
)
useUnsavedChanges(() => dirty.value, 'direction instruction')
const invalid = computed(
  () =>
    !text.value.trim() ||
    (scopeKind.value !== 'global' && scopeKind.value !== 'time' && !scopeId.value) ||
    (scopeKind.value === 'time' && (!Number.isFinite(Number(from.value)) || Number(from.value) < 0 || Number(to.value) <= Number(from.value))),
)

watch(
  () => route.query.shot,
  id => {
    if (typeof id === 'string' && !dirty.value) {
      scopeKind.value = 'shot'
      scopeId.value = id
    }
  },
  {immediate: true},
)
const clear = () => {
  text.value = ''
  editing.value = undefined
  characterId.value = ''
}
const edit = (rule: DirectionRule) => {
  editing.value = rule
  text.value = rule.text
  scopeKind.value = rule.scope.kind
  characterId.value = rule.characterId ?? ''
  if ('id' in rule.scope) scopeId.value = rule.scope.id
  if (rule.scope.kind === 'time') {
    from.value = rule.scope.start
    to.value = rule.scope.end
  }
}
const change = (work: () => Promise<unknown>) =>
  toasts.guard(async () => {
    saving.value = true
    try {
      await work()
      await refresh()
    } finally {
      saving.value = false
    }
  })()
const save = () =>
  change(async () => {
    const old = editing.value
    const sameScope = old && JSON.stringify(old.scope) === JSON.stringify(scope.value) && old.characterId === (characterId.value || undefined)
    const rule: DirectionRule = {
      id: old?.id ?? crypto.randomUUID(),
      text: text.value,
      scope: scope.value,
      ...(characterId.value ? {characterId: characterId.value} : {}),
      ...(sameScope && old.binding ? {binding: old.binding} : {}),
    }
    await api.saveDirection([...(view.value?.rules ?? []).filter(r => r.id !== rule.id), rule])
    clear()
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
    await api.saveDirection((view.value?.rules ?? []).filter(r => r.id !== rule.id))
    if (editing.value?.id === rule.id) clear()
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
      (view.value?.rules ?? []).map(r => {
        if (r.id !== rule.id) return r
        const {binding, ...next} = r
        return next
      }),
    )
  })
const preview = toasts.guard(() => start({type: 'direction'}))
// taken or restored: the clip prompts are built again at once - the planning run, nothing is rendered
const take = () =>
  change(async () => {
    await api.takeDirection(!!view.value?.proposal?.conflicts.length)
    await start({type: 'plan'})
    toasts.show('Changes taken. The clip prompts are built again; render the affected clips on the timeline.')
  })
const drop = () => change(() => api.dropDirection())
const restore = (id: string) =>
  change(async () => {
    if (
      await ask({
        title: 'Restore this plan version?',
        lines: [
          'Accepted shot edits are replaced by this version. Instructions remain saved; rendered videos remain available. The clip prompts are built again.',
        ],
        confirm: 'Restore plan',
      })
    ) {
      await api.restoreDirection(id)
      await start({type: 'plan'})
    }
  })
const plan = toasts.guard(() => start({type: 'plan'}))

// direct edits over several shots (#735): a person out of the picture, or the shot size - no language model, the prompts built again
const editScopeKind = ref<'global' | 'character' | 'beat' | 'scene' | 'time'>('character')
const editScopeId = ref('')
const editFrom = ref(0),
  editTo = ref(10)
const editKind = ref<'remove' | 'size'>('remove')
const editWho = ref('')
const editSize = ref<DirectionSize>('medium')
const editScope = computed<DirectionScope>(() =>
  editScopeKind.value === 'global'
    ? {kind: 'global'}
    : editScopeKind.value === 'time'
      ? {kind: 'time', start: Number(editFrom.value), end: Number(editTo.value)}
      : {kind: editScopeKind.value, id: editScopeId.value},
)
const editInvalid = computed(
  () =>
    (editKind.value === 'remove' && !editWho.value) ||
    (['character', 'beat', 'scene'].includes(editScopeKind.value) && !editScopeId.value) ||
    (editScopeKind.value === 'time' && !(Number(editTo.value) > Number(editFrom.value))),
)
const saveEdits = (edits: DirectionEdit[]) =>
  change(async () => {
    await api.saveDirectionEdits(edits)
    await start({type: 'plan'})
  })
const addEdit = () =>
  saveEdits([
    ...(view.value?.edits ?? []),
    {id: crypto.randomUUID(), scope: editScope.value, ...(editKind.value === 'remove' ? {remove: editWho.value} : {size: editSize.value})},
  ])
const unedit = (e: DirectionEdit) => saveEdits((view.value?.edits ?? []).filter(x => x.id !== e.id))
const describeEdit = (e: DirectionEdit) =>
  e.remove ? `${name(e.remove)} is not in the picture` : e.add ? `${name(e.add)} is in the picture` : `the shot is ${e.size}`
/** A shot's place on the timeline, its dialog opened there. */
const inTimeline = (shotId: string) => ({path: `${root}/`, query: {direct: shotId}})
const scopeText = (s: DirectionScope) => (s.kind === 'global' ? 'Whole project' : s.kind === 'time' ? `${s.start}–${s.end} s` : `${s.kind}: ${s.id}`)
const name = (id: string) => view.value?.characters.find(c => c.id === id)?.name ?? id
const ruleIssue = (id: string) => view.value?.unresolved.find(r => r.ruleId === id)?.message
// Readable before/after, including pose and motion instead of hiding those edits behind the action sentence.
function describe(data: Record<string, unknown>): string {
  const labels: Record<string, string> = {
    action: 'Action',
    framing: 'Framing',
    camera: 'Camera',
    view: 'Camera position',
    hold: 'Hold still',
    size: 'Shot size',
    rest: 'Others',
    hands: 'Instrument hands',
    characters: 'Visible characters',
    state: 'Start pose',
    frame: 'In frame',
    motion: 'Movement',
    facing: 'Facing',
    plays: 'Instrument action',
    singing: 'Singing',
    playing: 'Playing',
  }
  const fields = (obj: Record<string, unknown>) =>
    Object.entries(obj)
      .filter(([key]) => key in labels)
      .map(([key, value]) => `${labels[key]}: ${Array.isArray(value) ? value.map(String).map(name).join(', ') : String(value)}`)
  const lines = fields(data)
  if (data.people && typeof data.people === 'object')
    for (const [id, person] of Object.entries(data.people))
      lines.push(
        `${name(id)}\n${fields(person as Record<string, unknown>)
          .map(s => `  ${s}`)
          .join('\n')}`,
      )
  return lines.join('\n')
}

// The list (#783): what needs a review first, then everything by what it is about - the whole video, a character, a stretch of the
// song, then beat by beat (scene by scene) and in it shot by shot. Instructions only for the planner are folded away.
type Item = {key: string; rule?: DirectionRule; edit?: DirectionEdit; scope: DirectionScope; text: string; issues: string[]; planned: boolean}
const tab = ref<'instruction' | 'edit'>('instruction')
const filterText = ref('')
const filterWho = ref('')
const items = computed<Item[]>(() => {
  const v = view.value
  if (!v) return []
  return [
    ...v.rules.map(rule => ({
      key: `r:${rule.id}`,
      rule,
      scope: rule.scope,
      text: rule.text,
      issues: [ruleIssue(rule.id)].filter((m): m is string => !!m),
      planned: !!rule.planned,
    })),
    ...v.edits.map(edit => ({
      key: `e:${edit.id}`,
      edit,
      scope: edit.scope,
      text: describeEdit(edit),
      issues: v.editIssues.filter(i => i.editId === edit.id).map(i => i.message),
      planned: false,
    })),
  ]
})
const about = (item: Item) => [item.rule?.characterId, item.edit?.remove, item.edit?.add, item.scope.kind === 'character' ? item.scope.id : undefined]
const shown = computed(() => {
  const words = filterText.value.trim().toLowerCase()
  return items.value.filter(
    item =>
      (!words || `${item.text} ${scopeText(item.scope)}`.toLowerCase().includes(words)) &&
      (!filterWho.value || about(item).includes(filterWho.value) || item.text.includes(name(filterWho.value))),
  )
})
const review = computed(() => shown.value.filter(item => item.issues.length))
const shotGroup = (id: string) => (id.lastIndexOf(':shot') > 0 ? id.slice(0, id.lastIndexOf(':shot')) : id)
const shotNumber = (id: string) => Number(id.slice(id.lastIndexOf(':shot') + 5)) || 0
type Group = {key: string; title: string; label?: string; order: number; general: Item[]; shots: {id: string; items: Item[]}[]}
const grouped = computed<Group[]>(() => {
  const groups = new Map<string, Group>()
  const order = new Map((view.value?.groups ?? []).map((g, n) => [g.id, n]))
  const groupFor = (scope: DirectionScope): Group => {
    const [key, title, label, rank] =
      scope.kind === 'global'
        ? ['~global', 'Whole video', undefined, -3]
        : scope.kind === 'character'
          ? [`~character:${scope.id}`, `${name(scope.id)}, throughout`, undefined, -2]
          : scope.kind === 'time'
            ? [`~time:${scope.start}-${scope.end}`, `${scope.start}–${scope.end} s of the song`, undefined, -1]
            : (() => {
                const id = scope.kind === 'shot' ? shotGroup(scope.id) : scope.id
                return [id, id, view.value?.groups.find(g => g.id === id)?.label, order.get(id) ?? 9999] as const
              })()
    if (!groups.has(key)) groups.set(key, {key, title, label, order: rank, general: [], shots: []})
    return groups.get(key)!
  }
  for (const item of shown.value.filter(item => !item.issues.length)) {
    const group = groupFor(item.scope)
    if (item.scope.kind !== 'shot') group.general.push(item)
    else {
      const shotId = item.scope.id
      let shot = group.shots.find(s => s.id === shotId)
      if (!shot) group.shots.push((shot = {id: shotId, items: []}))
      shot.items.push(item)
    }
  }
  for (const group of groups.values()) group.shots.sort((a, b) => shotNumber(a.id) - shotNumber(b.id))
  return [...groups.values()].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key))
})
const plannedOf = (list: Item[]) => list.filter(item => item.planned)
const activeOf = (list: Item[]) => list.filter(item => !item.planned)
const editItem = (rule: DirectionRule) => {
  edit(rule)
  tab.value = 'instruction'
}
</script>

<template>
  <div class="scrollpage view direction-page">
    <PageBar title="Direction" />
    <p class="muted intro">
      Movement, performance and framing of a planned video - story, cast, sound and cuts stay. One shot is directed best on the timeline (<b>Direct this shot</b
      >, or a click on a cast lane); here are the instructions and edits of all shots.
    </p>
    <ResourceState :loading="loading" :error="error" :loaded="!!view" @retry="reload" />
    <div v-if="view" class="direction-layout">
      <main class="direction-main">
        <p v-if="!view.shots.length" class="note">Plan the shots first. You can save instructions now and preview them once shots exist.</p>
        <p v-if="view.restored" class="note">A saved plan version is restored. The instructions remain saved; preview again to apply them to this version.</p>

        <!-- what to do next: the proposal to take, or the preview to ask for -->
        <section v-if="view.proposal" class="dp-card proposal">
          <header class="dp-card-head">
            <h2>Proposed changes</h2>
            <span class="muted">{{ view.proposal.changes.length }} shot(s)</span>
          </header>
          <p v-if="view.proposalStale" class="warn">This proposal belongs to an older plan or set of instructions. Preview again before taking it.</p>
          <p v-if="!view.proposal.changes.length" class="muted">No shot changes proposed.</p>
          <p v-for="conflict in view.proposal.conflicts" :key="conflict" class="warn">{{ conflict }}</p>
          <p v-if="view.proposal.conflicts.length" class="muted small">
            A rule that contradicts another: edit the instructions or widen their scope, then preview again. A note on continuity only: read it, and take the
            proposal anyway.
          </p>
          <article v-for="change in view.proposal.changes" :key="change.shotId" class="change">
            <h3>{{ change.shotId }} <RouterLink class="go" :to="inTimeline(change.shotId)">open in the timeline</RouterLink></h3>
            <div class="comparison">
              <div>
                <b>Before</b>
                <pre>{{ describe(change.before) }}</pre>
              </div>
              <div>
                <b>After</b>
                <pre>{{ describe(change.after) }}</pre>
              </div>
            </div>
          </article>
          <div class="btn-row">
            <button class="btn primary" :disabled="blocked || dirty || view.proposalStale || !!view.unresolved.length" @click="take">
              {{ view.proposal.conflicts.length ? 'Take anyway' : 'Take changes' }}</button
            ><button class="btn" :disabled="blocked" @click="drop">Drop proposal</button>
          </div>
        </section>
        <div v-else class="actionbar">
          <span v-if="view.pending" class="warn inline">Instructions or the plan changed: preview, then take the proposal.</span>
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

        <section v-if="review.length" class="dp-card needs">
          <header class="dp-card-head">
            <h2>To review first</h2>
            <span class="muted small">Instructions here: rebind or remove them. Edits here: <b>Preview changes</b> writes what they leave open.</span>
          </header>
          <div v-for="item in review" :key="item.key" class="item">
            <div class="what">
              <span class="where">{{ scopeText(item.scope) }}</span>
              <RouterLink v-if="item.scope.kind === 'shot'" class="go" :to="inTimeline(item.scope.id)">open in the timeline</RouterLink>
              <p>{{ item.rule?.characterId ? `${name(item.rule.characterId)}: ` : '' }}{{ item.text }}</p>
              <p v-for="issue in item.issues" :key="issue" class="issue">{{ issue }}</p>
            </div>
            <div class="acts">
              <template v-if="item.rule">
                <button v-if="item.rule.binding && ruleIssue(item.rule.id)" class="btn mini" :disabled="blocked" @click="rebind(item.rule)">
                  Review current binding
                </button>
                <button class="btn mini" :disabled="blocked || dirty" aria-label="Edit instruction" @click="editItem(item.rule)">Edit</button>
                <button class="btn mini" :disabled="blocked" aria-label="Remove instruction" @click="remove(item.rule)">Remove</button>
              </template>
              <button v-else-if="item.edit" class="btn mini" :disabled="blocked" aria-label="Undo edit" @click="unedit(item.edit)">Undo</button>
            </div>
          </div>
        </section>

        <p v-if="!items.length" class="muted dp-empty">No instructions or edits yet. Write one on the right, or direct a shot on the timeline.</p>
        <p v-else-if="!shown.length" class="muted dp-empty">Nothing matches the filter.</p>

        <section v-for="group in grouped" :key="group.key" class="dp-card dp-group">
          <header class="dp-card-head">
            <h2>{{ group.title }}</h2>
            <span v-if="group.label" class="muted" :title="group.label">{{ group.label }}</span>
          </header>
          <div v-for="item in activeOf(group.general)" :key="item.key" class="item">
            <div class="what">
              <span v-if="item.edit" class="dp-tag">edit</span>
              <span v-if="item.rule?.characterId" class="dp-tag dp-who">{{ name(item.rule.characterId) }}</span>
              <p>{{ item.text }}</p>
            </div>
            <div class="acts">
              <template v-if="item.rule">
                <button class="btn mini" :disabled="blocked || dirty" aria-label="Edit instruction" @click="editItem(item.rule)">Edit</button>
                <button class="btn mini" :disabled="blocked" aria-label="Remove instruction" @click="remove(item.rule)">Remove</button>
              </template>
              <button v-else-if="item.edit" class="btn mini" :disabled="blocked" aria-label="Undo edit" @click="unedit(item.edit)">Undo</button>
            </div>
          </div>
          <details v-if="plannedOf(group.general).length" class="planned">
            <summary>{{ plannedOf(group.general).length }} for the planner - who is in it, kept when it is planned again</summary>
            <div v-for="item in plannedOf(group.general)" :key="item.key" class="item muted-item">
              <div class="what">
                <span class="dp-tag">in the plan</span>
                <p>{{ item.text }}</p>
              </div>
              <div class="acts">
                <button v-if="item.rule" class="btn mini" :disabled="blocked" aria-label="Remove instruction" @click="remove(item.rule)">Remove</button>
              </div>
            </div>
          </details>
          <div v-for="shot in group.shots" :key="shot.id" class="shot-block">
            <h3>Shot {{ shotNumber(shot.id) }} <RouterLink class="go" :to="inTimeline(shot.id)">open in the timeline</RouterLink></h3>
            <div v-for="item in activeOf(shot.items)" :key="item.key" class="item">
              <div class="what">
                <span v-if="item.edit" class="dp-tag">edit</span>
                <span v-if="item.rule?.characterId" class="dp-tag dp-who">{{ name(item.rule.characterId) }}</span>
                <p>{{ item.text }}</p>
              </div>
              <div class="acts">
                <template v-if="item.rule">
                  <button class="btn mini" :disabled="blocked || dirty" aria-label="Edit instruction" @click="editItem(item.rule)">Edit</button>
                  <button class="btn mini" :disabled="blocked" aria-label="Remove instruction" @click="remove(item.rule)">Remove</button>
                </template>
                <button v-else-if="item.edit" class="btn mini" :disabled="blocked" aria-label="Undo edit" @click="unedit(item.edit)">Undo</button>
              </div>
            </div>
            <details v-if="plannedOf(shot.items).length" class="planned">
              <summary>{{ plannedOf(shot.items).length }} for the planner</summary>
              <div v-for="item in plannedOf(shot.items)" :key="item.key" class="item muted-item">
                <div class="what">
                  <span class="dp-tag">in the plan</span>
                  <p>{{ item.text }}</p>
                </div>
                <div class="acts">
                  <button v-if="item.rule" class="btn mini" :disabled="blocked" aria-label="Remove instruction" @click="remove(item.rule)">Remove</button>
                </div>
              </div>
            </details>
          </div>
        </section>
      </main>

      <aside class="direction-side">
        <div class="dp-tabs" role="tablist">
          <button role="tab" :aria-selected="tab === 'instruction'" :class="{on: tab === 'instruction'}" @click="tab = 'instruction'">
            {{ editing ? 'Edit instruction' : 'New instruction' }}
          </button>
          <button role="tab" :aria-selected="tab === 'edit'" :class="{on: tab === 'edit'}" @click="tab = 'edit'">Direct edit</button>
        </div>
        <fieldset v-if="tab === 'instruction'" :disabled="blocked" class="direction-form">
          <label
            >Scope<select v-model="scopeKind" @change="scopeId = ''">
              <option value="global">Whole project</option>
              <option value="character">Character throughout</option>
              <option :value="film ? 'scene' : 'beat'">{{ film ? 'Scene' : 'Beat' }}</option>
              <option v-if="!film" value="time">Song time range</option>
              <option value="shot">One shot</option>
            </select></label
          >
          <label v-if="scopeKind === 'character'"
            >Character<select v-model="scopeId">
              <option value="" disabled>Choose character</option>
              <option v-for="c in view.characters" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select></label
          >
          <label v-if="scopeKind === 'beat' || scopeKind === 'scene'"
            >{{ film ? 'Scene' : 'Beat'
            }}<select v-model="scopeId">
              <option value="" disabled>Choose {{ film ? 'scene' : 'beat' }}</option>
              <option v-for="g in view.groups" :key="g.id" :value="g.id">{{ g.id }} · {{ g.label }}</option>
            </select></label
          >
          <label v-if="scopeKind === 'shot'"
            >Shot<select v-model="scopeId">
              <option value="" disabled>Choose shot</option>
              <option v-for="shot in view.shots" :key="shot.id" :value="shot.id">{{ shot.id }} · {{ shot.data.action }}</option>
            </select></label
          >
          <div v-if="scopeKind === 'time'" class="dp-pair">
            <label>From (s)<input v-model.number="from" type="number" min="0" step="0.1" /></label>
            <label>To (s)<input v-model.number="to" type="number" min="0" step="0.1" /></label>
          </div>
          <label v-if="scopeKind !== 'character'"
            >Only for character<select v-model="characterId">
              <option value="">Everyone in scope</option>
              <option v-for="c in view.characters" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select></label
          >
          <label>Instruction<textarea v-model="text" rows="5" placeholder="Kael turns toward his own left, ending with his back to the camera." /></label>
          <div class="btn-row">
            <button class="btn primary" :disabled="invalid || !dirty" @click="save">Save instruction</button
            ><button v-if="editing || text" class="btn" @click="clear">Cancel edit</button>
          </div>
          <p class="muted small">Saved, nothing changes yet: <b>Preview changes</b> asks the language model.</p>
        </fieldset>
        <fieldset v-else :disabled="blocked" class="direction-form">
          <p class="muted small">By the code, without the language model; kept when the shots are planned again. Whoever sings, plays or speaks stays.</p>
          <label
            >Applies to<select v-model="editScopeKind" @change="editScopeId = ''">
              <option value="global">Whole project</option>
              <option value="character">Every shot with a character</option>
              <option :value="film ? 'scene' : 'beat'">{{ film ? 'Scene' : 'Beat' }}</option>
              <option v-if="!film" value="time">Song time range</option>
            </select></label
          >
          <label v-if="editScopeKind === 'character'"
            >With<select v-model="editScopeId">
              <option value="" disabled>Choose character</option>
              <option v-for="c in view.characters" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select></label
          >
          <label v-if="editScopeKind === 'beat' || editScopeKind === 'scene'"
            >{{ film ? 'Scene' : 'Beat'
            }}<select v-model="editScopeId">
              <option value="" disabled>Choose {{ film ? 'scene' : 'beat' }}</option>
              <option v-for="g in view.groups" :key="g.id" :value="g.id">{{ g.id }} · {{ g.label }}</option>
            </select></label
          >
          <div v-if="editScopeKind === 'time'" class="dp-pair">
            <label>From (s)<input v-model.number="editFrom" type="number" min="0" step="0.1" /></label>
            <label>To (s)<input v-model.number="editTo" type="number" min="0" step="0.1" /></label>
          </div>
          <label
            >Edit<select v-model="editKind">
              <option value="remove">Take a person out of the picture</option>
              <option value="size">Set the shot size</option>
            </select></label
          >
          <label v-if="editKind === 'remove'"
            >Person<select v-model="editWho">
              <option value="" disabled>Choose character</option>
              <option v-for="c in view.characters" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select></label
          >
          <label v-else
            >Size<select v-model="editSize">
              <option v-for="s in ['wide', 'medium', 'close', 'extreme']" :key="s" :value="s">{{ s }}</option>
            </select></label
          >
          <div class="btn-row"><button class="btn primary" :disabled="editInvalid" @click="addEdit">Add edit and build the prompts</button></div>
          <p class="muted small">Someone into one shot: <b>Direct this shot</b> on the timeline, <b>Bring in</b>.</p>
        </fieldset>

        <div v-if="view.activeVersion" class="side-block">
          <h3>Accepted plan</h3>
          <p class="muted small">Taking or restoring builds the clip prompts again; render the affected clips on the timeline.</p>
          <button class="btn" :disabled="blocked || view.pending" @click="plan">Build the clip prompts again</button>
        </div>
        <details v-if="view.versions.length" class="side-block">
          <summary>Plan versions ({{ view.versions.length }})</summary>
          <div v-for="version in [...view.versions].reverse()" :key="version.id" class="version-row">
            <span class="small"
              >{{ version.id.startsWith('baseline-') ? 'Original plan' : new Date(version.createdAt).toLocaleString() }} · {{ version.changes.length }} shot
              edits{{ version.id === view.activeVersion ? ' · current' : '' }}</span
            ><button class="btn mini" :disabled="blocked || version.id === view.activeVersion" @click="restore(version.id)">Restore plan</button>
          </div>
        </details>
        <details class="side-block">
          <summary>CLI</summary>
          <pre class="cli"
            >{{ command }} --json
{{ command }} --show=SHOT
{{ command }} --add="..." --scope=shot:SHOT --preview --take
{{ command }} --with=CHARACTER --scope=shot:SHOT --preview --take
{{ command }} --without=CHARACTER --scope=beat:BEAT
{{ command }} --size=close --scope=shot:SHOT
{{ command }} --take --despite-conflicts
{{ command }} --drop</pre>
        </details>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.intro {
  max-width: 110ch;
  margin-bottom: 14px;
}
.direction-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 20px;
  align-items: start;
}
.direction-side {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px 14px 14px;
  background: var(--surface);
  max-height: calc(100vh - 140px);
  overflow: auto;
}
.dp-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--line);
}
.dp-tabs button {
  background: none;
  border: 0;
  border-bottom: 2px solid transparent;
  padding: 6px 10px;
  color: var(--muted);
  cursor: pointer;
}
.dp-tabs button.on {
  color: var(--text);
  border-bottom-color: var(--accent);
}
.direction-form {
  border: 0;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.direction-form label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.direction-form select,
.direction-form textarea,
.direction-form input {
  width: 100%;
}
.dp-pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.side-block h3 {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
  margin-bottom: 6px;
}
.side-block summary {
  cursor: pointer;
  color: var(--muted);
}
.side-block p {
  margin-bottom: 8px;
}
.version-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 0;
  border-top: 1px solid var(--line);
}
.cli {
  font: 11px/1.6 var(--mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 8px 0 0;
}
.small {
  font-size: 12px;
}

.direction-main {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.actionbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border: 1px solid var(--line);
  border-radius: 10px;
}
.actionbar .warn.inline {
  margin: 0;
}
.spacer {
  flex: 1;
}
.filters {
  display: flex;
  align-items: center;
  gap: 8px;
}
.filters input {
  flex: 1;
  max-width: 420px;
}
.dp-card {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 14px 6px;
}
.dp-card.needs {
  border-color: var(--stale);
}
.dp-card.proposal {
  border-color: var(--accent);
  padding-bottom: 12px;
}
.dp-card-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 4px;
}
.dp-card-head h2 {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
}
/* the beat's story: two lines, the whole of it on hover */
.dp-card-head > .muted {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 12px;
}
.shot-block {
  border-top: 1px solid var(--line);
  padding-top: 6px;
  margin-top: 4px;
}
.shot-block h3,
.change h3 {
  display: flex;
  align-items: baseline;
  gap: 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  margin: 2px 0;
}
.go {
  font-size: 12px;
  font-weight: normal;
  color: var(--accent);
  text-decoration: none;
}
.go:hover {
  text-decoration: underline;
}
.item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 6px 0;
}
.item + .item {
  border-top: 1px dashed var(--line);
}
.what {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
}
.what p {
  flex: 1 1 100%;
  max-width: 110ch;
  line-height: 1.45;
  overflow-wrap: anywhere;
}
.what .dp-tag + p,
.what .dp-tag.dp-who + p {
  flex: 1 1 0;
}
.where {
  font-weight: 600;
}
.issue {
  color: var(--stale);
  font-size: 12px;
}
.dp-tag {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 99px;
  border: 1px solid var(--line);
  color: var(--muted);
  white-space: nowrap;
}
.dp-tag.dp-who {
  color: var(--text);
}
.acts {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.btn.mini {
  padding: 2px 8px;
  font-size: 12px;
}
.planned {
  margin: 4px 0;
}
.planned summary {
  cursor: pointer;
  font-size: 12px;
  color: var(--muted);
  padding: 4px 0;
}
.muted-item {
  opacity: 0.7;
}
.dp-empty {
  padding: 8px 2px;
}
.change {
  border-top: 1px solid var(--line);
  padding: 8px 0;
}
.comparison {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.comparison pre {
  font: inherit;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 4px 0 0;
}
@media (max-width: 1000px) {
  .direction-layout {
    grid-template-columns: 1fr;
  }
  .direction-side {
    position: static;
    max-height: none;
    order: -1;
  }
}
@media (max-width: 700px) {
  .comparison {
    grid-template-columns: 1fr;
  }
}
</style>
