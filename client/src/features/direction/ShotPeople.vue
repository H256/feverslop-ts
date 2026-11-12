<script setup lang="ts">
import {computed, ref} from 'vue'
import type {DirectionShot, DirectionView} from '../../../../shared/direction'
import {withNames} from '../../lib/format'
import {shotLabel} from './directionItems'

/**
 * Who is in one shot and what each of them does (#735, #839): an instruction for one of them, several marked and taken out together
 * (#790), and people of the cast brought in, with what they do there (#792). The dialog saves; marks are cleared once it did.
 */
const props = defineProps<{
  shot: DirectionShot
  view: DirectionView
  blocked: boolean
  name: (id: string) => string
  takeOut: (ids: string[]) => Promise<unknown>
  bringIn: (ids: string[], words: string) => Promise<unknown>
}>()
defineEmits<{instruct: [string]}>()

const data = computed(() => (props.shot.data ?? {}) as Record<string, unknown>)
const people = computed(() => (data.value.people ?? {}) as Record<string, Record<string, unknown>>)
const speaks = computed(() => Array.isArray(data.value.lines) && data.value.lines.length > 0)
// whoever sings, plays or speaks in the shot stays in it
const flags = (id: string) =>
  [
    people.value[id]?.singing === true && 'sings',
    (people.value[id]?.playing === true || !!people.value[id]?.plays) && 'plays',
    speaks.value && 'speaks',
  ].filter((f): f is string => !!f)
const kept = (id: string) => flags(id).length > 0
const shown = (value: unknown) => (typeof value === 'string' ? withNames(value) : value)

const toggled = (set: Set<string>, id: string) => {
  const next = new Set(set)
  if (!next.delete(id)) next.add(id)
  return next
}
const outs = ref(new Set<string>())
const outNames = computed(() => [...outs.value].map(props.name))
const ins = ref(new Set<string>())
const inText = ref('')
const inNames = computed(() => [...ins.value].map(props.name))
const others = computed(() => props.view.characters.filter(c => !props.shot.characters.includes(c.id)))
const out = async () => {
  await props.takeOut([...outs.value])
  outs.value = new Set()
}
const into = async () => {
  await props.bringIn([...ins.value], inText.value.trim())
  ins.value = new Set()
  inText.value = ''
}
</script>

<template>
  <article v-for="id in shot.characters" :key="id" class="sd-person">
    <header>
      <b class="who">{{ name(id) }}</b>
      <span v-for="flag in flags(id)" :key="flag" class="chip">{{ flag }}</span>
      <div class="spacer" />
      <button class="btn" :disabled="blocked" @click="$emit('instruct', id)">Instruction for {{ name(id) }}</button>
      <label
        :class="['btn', 'out-mark', {on: outs.has(id), disabled: blocked || kept(id)}]"
        :title="kept(id) ? `${name(id)} ${flags(id).join(' and ')} in this shot and stays in it` : 'Mark to take out of the shot - several at once'"
      >
        <input type="checkbox" :checked="outs.has(id)" :disabled="blocked || kept(id)" @change="outs = toggled(outs, id)" />
        Take out
      </label>
    </header>
    <dl>
      <template v-for="key in ['state', 'frame', 'motion', 'facing']" :key="key">
        <template v-if="people[id]?.[key]"
          ><dt>{{ shotLabel(key) }}</dt>
          <dd>{{ shown(people[id]![key]) }}</dd></template
        >
      </template>
    </dl>
    <p v-if="!['state', 'frame', 'motion'].some(k => people[id]?.[k])" class="muted idle">Nothing to do in this shot yet.</p>
  </article>
  <div v-if="outs.size" class="btn-row out-bar">
    <button class="btn primary" :disabled="blocked" @click="out">Take {{ outNames.join(', ') }} out of the shot</button>
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
        @click="ins = toggled(ins, c.id)"
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
        <button class="btn primary" :disabled="blocked" @click="into">Bring {{ inNames.join(', ') }} into the shot</button>
        <button class="btn" :disabled="blocked" @click="ins = new Set()">Clear</button>
        <span class="muted">By code; one proposal writes where they are and what they do. Nothing is rendered.</span>
      </div>
    </template>
  </section>
</template>

<style scoped>
/* class names of their own: .person is taken by the timeline's styles (workspace.css) */
.sd-person {
  border: 1px solid var(--line);
  border-radius: var(--radius-m);
  padding: 10px 12px;
  margin-bottom: 8px;
}
.sd-person header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.sd-person .who {
  font-size: var(--text-l);
  font-weight: 600;
  margin-right: 2px;
}
.sd-person dl {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--space-1) var(--space-4);
  margin: 10px 0 0;
  line-height: 1.4;
}
.sd-person dt {
  color: var(--muted);
}
.sd-person dd {
  margin: 0;
}
.spacer {
  flex: 1;
}
.idle {
  margin-top: 6px;
  font-size: var(--text-s);
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
  gap: var(--space-2);
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
</style>
