<script setup lang="ts">
import {computed, ref} from 'vue'
import type {DirectionEdit, DirectionScope, DirectionSize, DirectionView} from '../../../../shared/direction'
import ScopePicker from './ScopePicker.vue'

/**
 * A direct edit over several shots (#735, #839): a person out of the picture, or the shot size - by the code, no language model; the
 * page saves it and the clip prompts are built again.
 */
const props = defineProps<{view: DirectionView; film: boolean; blocked: boolean}>()
const emit = defineEmits<{add: [DirectionEdit]}>()
const kind = ref<DirectionScope['kind']>('character')
const id = ref('')
const from = ref(0)
const to = ref(10)
const what = ref<'remove' | 'size'>('remove')
const who = ref('')
const size = ref<DirectionSize>('medium')
const scope = computed<DirectionScope>(() =>
  kind.value === 'global'
    ? {kind: 'global'}
    : kind.value === 'time'
      ? {kind: 'time', start: Number(from.value), end: Number(to.value)}
      : {kind: kind.value, id: id.value},
)
const invalid = computed(
  () =>
    (what.value === 'remove' && !who.value) ||
    (['character', 'beat', 'scene'].includes(kind.value) && !id.value) ||
    (kind.value === 'time' && !(Number(to.value) > Number(from.value))),
)
const options = computed(() => [
  {value: 'global' as const, label: 'Whole project'},
  {value: 'character' as const, label: 'Every shot with a character'},
  {value: props.film ? ('scene' as const) : ('beat' as const), label: props.film ? 'Scene' : 'Beat'},
  ...(props.film ? [] : [{value: 'time' as const, label: 'Song time range'}]),
])
const add = () => emit('add', {id: crypto.randomUUID(), scope: scope.value, ...(what.value === 'remove' ? {remove: who.value} : {size: size.value})})
</script>

<template>
  <fieldset :disabled="blocked" class="direction-form">
    <p class="muted small">By the code, without the language model; kept when the shots are planned again. Whoever sings, plays or speaks stays.</p>
    <ScopePicker
      v-model:kind="kind"
      v-model:id="id"
      v-model:from="from"
      v-model:to="to"
      label="Applies to"
      :options="options"
      character-label="With"
      :view="view"
      :film="film"
    />
    <label
      >Edit<select v-model="what">
        <option value="remove">Take a person out of the picture</option>
        <option value="size">Set the shot size</option>
      </select></label
    >
    <label v-if="what === 'remove'"
      >Person<select v-model="who">
        <option value="" disabled>Choose character</option>
        <option v-for="c in view.characters" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select></label
    >
    <label v-else
      >Size<select v-model="size">
        <option v-for="s in ['wide', 'medium', 'close', 'extreme']" :key="s" :value="s">{{ s }}</option>
      </select></label
    >
    <div class="btn-row"><button class="btn primary" :disabled="invalid" @click="add">Add edit and build the prompts</button></div>
    <p class="muted small">Someone into one shot: <b>Direct this shot</b> on the timeline, <b>Bring in</b>.</p>
  </fieldset>
</template>
