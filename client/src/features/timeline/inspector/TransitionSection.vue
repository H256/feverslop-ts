<script setup lang="ts">
import {computed, ref, watch} from 'vue'
import type {EditorClip} from '../../../../../shared/workspace'
import CopyCommand from '../../../components/CopyCommand.vue'
import {useTimeline} from '../context'

/**
 * How the clip comes in at the export (#1195, bun run transition): a cut, or a crossfade or a fade through black or white from the
 * clip before. It plays over the frames that clip was rendered past its end, so this clip stays on its song frame; only the next
 * final video changes.
 */
const props = defineProps<{clip: EditorClip}>()
const {project, actions} = useTimeline()
type Kind = 'cut' | NonNullable<EditorClip['transition']>['type']
const KINDS: {value: Kind; label: string}[] = [
  {value: 'cut', label: 'Cut'},
  {value: 'crossfade', label: 'Crossfade'},
  {value: 'fade-black', label: 'Through black'},
  {value: 'fade-white', label: 'Through white'},
]
const kind = computed<Kind>(() => props.clip.transition?.type ?? 'cut')
const seconds = ref(props.clip.transition?.seconds ?? 0.5)
watch(
  () => props.clip.transition?.seconds,
  now => (seconds.value = now ?? 0.5),
)
// what the clip before has past its end: the longest a transition into this clip can be
const before = computed(() => {
  const at = project.value.clips.findIndex(c => c.id === props.clip.id)
  return at > 0 ? project.value.clips[at - 1] : undefined
})
const room = computed(() => {
  const video = before.value?.video
  return video?.renderedFrames && before.value ? Math.max(0, video.renderedFrames - before.value.frames) / 24 : undefined
})
const pick = (value: Kind) => actions.saveTransition(props.clip, value === 'cut' ? null : {type: value, seconds: seconds.value})
const setSeconds = () => {
  if (props.clip.transition) void actions.saveTransition(props.clip, {type: props.clip.transition.type, seconds: seconds.value})
}
const command = computed(
  () =>
    `bun run transition ${project.value.id} ${props.clip.id} ${props.clip.transition ? `--type=${props.clip.transition.type} --seconds=${props.clip.transition.seconds}` : '--cut'}`,
)
</script>

<template>
  <div v-if="before" class="section">
    <h3>Transition into this clip</h3>
    <div class="seg" role="group" aria-label="Transition into this clip">
      <button v-for="k in KINDS" :key="k.value" :aria-pressed="kind === k.value" @click="pick(k.value)">{{ k.label }}</button>
    </div>
    <label v-if="clip.transition" class="btn-row u-mt-1">
      <span class="muted">Seconds</span>
      <input v-model.number="seconds" class="input transition-seconds" type="number" min="0.1" max="3" step="0.1" @change="setSeconds" />
    </label>
    <p class="muted">
      Over the frames {{ before.id }} was rendered past its end<template v-if="room !== undefined">: {{ room.toFixed(2) }} s</template>. Longer is shortened,
      none stays a cut. Only the next final video changes.
    </p>
    <CopyCommand :command="command" />
  </div>
</template>
