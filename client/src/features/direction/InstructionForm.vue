<script setup lang="ts">
import {computed, ref, watch} from 'vue'
import {useRoute} from 'vue-router'
import type {DirectionRule, DirectionScope, DirectionView} from '../../../../shared/direction'
import {useUnsavedChanges} from '../../composables/useUnsavedChanges'
import {sameScope} from './directionItems'
import ScopePicker from './ScopePicker.vue'

/**
 * A new instruction, or one edited (#839): what it applies to, for whom, and its words. Saved by the page; the form says whether it
 * holds something unsaved (`dirty`), and is filled by `edit(rule)`.
 */
const props = defineProps<{view: DirectionView; film: boolean; blocked: boolean}>()
const emit = defineEmits<{save: [DirectionRule]}>()
const dirty = defineModel<boolean>('dirty', {required: true})
const route = useRoute()

const text = ref('')
const kind = ref<DirectionScope['kind']>('global')
const id = ref('')
const characterId = ref('')
const from = ref(0)
const to = ref(10)
const editing = ref<DirectionRule>()
const scope = computed<DirectionScope>(() =>
  kind.value === 'global'
    ? {kind: 'global'}
    : kind.value === 'time'
      ? {kind: 'time', start: Number(from.value), end: Number(to.value)}
      : {kind: kind.value, id: id.value},
)
const changed = computed(() =>
  editing.value
    ? text.value !== editing.value.text || !sameScope(scope.value, editing.value.scope) || characterId.value !== (editing.value.characterId ?? '')
    : !!text.value,
)
watch(changed, value => (dirty.value = value), {immediate: true})
useUnsavedChanges(() => changed.value, 'direction instruction')
const invalid = computed(
  () =>
    !text.value.trim() ||
    (kind.value !== 'global' && kind.value !== 'time' && !id.value) ||
    (kind.value === 'time' && (!Number.isFinite(Number(from.value)) || Number(from.value) < 0 || Number(to.value) <= Number(from.value))),
)
const options = computed(() => [
  {value: 'global' as const, label: 'Whole project'},
  {value: 'character' as const, label: 'Character throughout'},
  {value: props.film ? ('scene' as const) : ('beat' as const), label: props.film ? 'Scene' : 'Beat'},
  ...(props.film ? [] : [{value: 'time' as const, label: 'Song time range'}]),
  {value: 'shot' as const, label: 'One shot'},
])

// a shot asked for from the timeline (?shot=…): the form is about it, unless it holds something unsaved
watch(
  () => route.query.shot,
  shot => {
    if (typeof shot === 'string' && !changed.value) {
      kind.value = 'shot'
      id.value = shot
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
  kind.value = rule.scope.kind
  characterId.value = rule.characterId ?? ''
  if ('id' in rule.scope) id.value = rule.scope.id
  if (rule.scope.kind === 'time') {
    from.value = rule.scope.start
    to.value = rule.scope.end
  }
}
const save = () => {
  const old = editing.value
  // the binding to the shot it was made for stays while the instruction is about the same shot and person
  const same = old && sameScope(old.scope, scope.value) && old.characterId === (characterId.value || undefined)
  emit('save', {
    id: old?.id ?? crypto.randomUUID(),
    text: text.value,
    scope: scope.value,
    ...(characterId.value ? {characterId: characterId.value} : {}),
    ...(same && old.binding ? {binding: old.binding} : {}),
  })
}
defineExpose({edit, clear, editing})
</script>

<template>
  <fieldset :disabled="blocked" class="direction-form">
    <ScopePicker
      v-model:kind="kind"
      v-model:id="id"
      v-model:from="from"
      v-model:to="to"
      label="Scope"
      :options="options"
      character-label="Character"
      :view="view"
      :film="film"
    />
    <label v-if="kind !== 'character'"
      >Only for character<select v-model="characterId">
        <option value="">Everyone in scope</option>
        <option v-for="c in view.characters" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select></label
    >
    <label>Instruction<textarea v-model="text" rows="5" placeholder="Kael turns toward his own left, ending with his back to the camera." /></label>
    <div class="btn-row">
      <button class="btn primary" :disabled="invalid || !changed" @click="save">Save instruction</button
      ><button v-if="editing || text" class="btn" @click="clear">Cancel edit</button>
    </div>
    <p class="muted small">Saved, nothing changes yet: <b>Preview changes</b> asks the language model.</p>
  </fieldset>
</template>
