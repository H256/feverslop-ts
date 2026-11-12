<script setup lang="ts">
import CalloutBox from '../../../components/CalloutBox.vue'
import {computed} from 'vue'
import type {EditorClip, EditorOverride} from '../../../../../shared/workspace'
import MediaThumb from '../../../components/MediaThumb.vue'
import {clamp} from '../../../lib/format'
import {useTimeline} from '../context'

/** A film clip's own choice of its place's view and its references: kept in a small file, the plan is not touched. */
const props = defineProps<{clip: EditorClip}>()
const {actions, session} = useTimeline()
const override = computed((): Required<EditorOverride> => ({
  placeView: props.clip.override?.placeView ?? 0,
  without: [...(props.clip.override?.without ?? [])],
  order: [...(props.clip.override?.order ?? [])],
}))
const save = (next: Partial<EditorOverride> | null) => {
  if (next === null) return actions.saveOverride(props.clip, null)
  const {placeView, ...rest} = {...override.value, ...next}
  void actions.saveOverride(props.clip, {...rest, ...(placeView ? {placeView} : {})})
}
const chosen = computed(() => override.value.placeView || props.clip.views?.chosen)
const people = computed(() => props.clip.pictures.filter(p => p.kind !== 'frame'))
const move = (id: string, direction: number) => {
  const order = people.value.map(p => p.id)
  const at = order.indexOf(id)
  order.splice(at, 1)
  order.splice(clamp(at + direction, 0, order.length), 0, id)
  void save({order})
}
</script>

<template>
  <div v-if="clip.views?.options.length" class="section">
    <h3>View of the place</h3>
    <div class="refs">
      <button
        v-for="option in clip.views.options"
        :key="option.n"
        :class="['ref', {chosen: option.n === chosen}]"
        :title="option.shows"
        @click="save({placeView: option.n})"
      >
        <MediaThumb :media="option.v ? option : undefined" :roots="session.roots" cls="" missing="Not rendered" />
        <div>
          <b>{{ option.name }}</b
          ><small>View {{ option.n }}{{ option.n === clip.views.chosen ? ' · in the plan' : '' }}</small>
        </div>
      </button>
    </div>
  </div>
  <div v-if="clip.views" class="section"><button class="btn" @click="actions.addView(clip)">Add a view of this place</button></div>
  <div v-if="people.length > 1" class="section">
    <h3>References and their order</h3>
    <div v-for="(picture, n) in people" :key="picture.id" class="btn-row u-mb-1">
      <span class="u-grow">{{ n + 1 }}. {{ picture.name }}</span>
      <button class="btn" :disabled="n === 0" :aria-label="`${picture.name} up`" @click="move(picture.id, -1)">↑</button>
      <button class="btn" :disabled="n === people.length - 1" :aria-label="`${picture.name} down`" @click="move(picture.id, 1)">↓</button>
      <button class="btn" @click="save({without: [...override.without, picture.id]})">Leave out</button>
    </div>
  </div>
  <CalloutBox v-if="override.without.length" as="div" class="btn-row">
    <span class="u-grow">Left out: {{ override.without.join(', ') }}</span
    ><button class="btn" @click="save({without: []})">Put back</button>
  </CalloutBox>
  <CalloutBox v-if="clip.override" as="div">
    <p class="u-mb-1">This clip has a choice of its own. It takes effect with the next plan run, and the clip then goes stale.</p>
    <div class="btn-row"><button class="btn" @click="actions.plan()">Plan now</button><button class="btn" @click="save(null)">Back to the plan</button></div>
  </CalloutBox>
</template>
