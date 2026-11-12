<script setup lang="ts">
import {computed, ref} from 'vue'
import type {EditorClip} from '../../../../../shared/workspace'
import {useToasts} from '../../../services/toasts'
import {useTimeline} from '../context'

/** A part of the clip rendered again: one of its shots, or seconds from - to. */
const props = defineProps<{clip: EditorClip}>()
const {actions} = useTimeline()
const {fail} = useToasts()
const seconds = computed(() => props.clip.end - props.clip.start)
const from = ref(0)
const to = ref(Number(Math.min(2, seconds.value).toFixed(1)))
const shots = computed(() => props.clip.shots.map((shot, n) => ({n, from: shot.at, to: props.clip.shots[n + 1]?.at ?? seconds.value})))
const custom = () => {
  if (!(to.value > from.value)) return fail(new Error('the end of the part has to be after its start'))
  void actions.retake(props.clip, `${from.value}-${to.value}`, from.value, to.value)
}
</script>

<template>
  <div class="section">
    <h3>Render a part again</h3>
    <div v-if="clip.shots.length > 1" class="btn-row u-mb-1">
      <button
        v-for="shot in shots"
        :key="shot.n"
        class="btn"
        :title="`${shot.from}s - ${shot.to.toFixed(1)}s`"
        @click="actions.retake(clip, `shot${shot.n + 1}`, shot.from, shot.to)"
      >
        Shot {{ shot.n + 1 }}
      </button>
    </div>
    <div class="btn-row">
      <input v-model.number="from" type="number" min="0" :max="seconds" step="0.1" aria-label="From second" class="u-num" />
      <span class="muted">to</span>
      <input v-model.number="to" type="number" min="0" :max="seconds" step="0.1" aria-label="To second" class="u-num" />
      <span class="muted">s</span>
      <button class="btn" @click="custom">Render this part</button>
    </div>
  </div>
</template>
