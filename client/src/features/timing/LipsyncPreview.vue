<script setup lang="ts">
import {computed, nextTick, ref, watch} from 'vue'
import type {TimingView} from '../../../../shared/workspace'
import {mediaUrl} from '../../api/urls'
import CalloutBox from '../../components/CalloutBox.vue'
import {clock, plural} from '../../lib/format'
import {useToasts} from '../../services/toasts'
import {usePageData} from '../project/usePageData'
import {useProject} from '../project/session'

/**
 * The lip-sync preview (#1016): the whole song as a close-up of a dummy singer, rendered small from the vocals stem and the full song as a
 * real clip gets them - to see, before the real renders, whether the mouth follows the saved timing and whether the model makes up singing.
 * The clips carry the song as their sound; they are played one after the other, from the start of the song or from where the slider is put.
 */
const props = defineProps<{view: TimingView; dirty: boolean}>()
const {api, roots, start, busy} = useProject()
const toasts = useToasts()
const {data, loading, error} = usePageData(async signal => (await api.lipsync(signal)).lipsync, {live: true})

const clips = computed(() => data.value?.clips ?? [])
const made = computed(() => clips.value.filter(c => c.video))
const todo = computed(() => clips.value.filter(c => c.state !== 'current'))
const outdated = computed(() => clips.value.filter(c => c.state === 'outdated'))

const render = toasts.guard(async (again: boolean, only?: string[]) => {
  await start({type: 'lipsync', ...(only ? {only} : {}), ...(again ? {again: true} : {})})
})

////////// THE PLAYER
const video = ref<HTMLVideoElement>()
const current = ref(0) // the index of the clip in the cut
const playing = ref(false)
const songTime = ref(0)
let seekTo: number | undefined
let resume = false
const clip = computed(() => clips.value[current.value])
const src = computed(() => (clip.value?.video ? mediaUrl(clip.value.video, roots) : undefined))
const duration = computed(() => props.view.duration)
// the line sung now, by the saved timing
const lineNow = computed(() =>
  props.view.lines.find(l => !l.off && l.words.length && songTime.value >= l.words[0]!.start - 0.05 && songTime.value <= l.words.at(-1)!.end + 0.05),
)

/** A clip with a video, from this index on (or back). */
const playable = (from: number, step: 1 | -1) => {
  for (let i = from; i >= 0 && i < clips.value.length; i += step) if (clips.value[i]!.video) return i
  return undefined
}
const open = (index: number, at = 0, play = playing.value) => {
  current.value = index
  seekTo = at
  resume = play
  void nextTick(() => video.value?.load())
}
const onLoaded = () => {
  const el = video.value
  if (!el) return
  if (seekTo) el.currentTime = seekTo
  seekTo = undefined
  songTime.value = (clip.value?.start ?? 0) + el.currentTime
  if (resume) void el.play().catch(() => (playing.value = false))
}
const onTime = () => {
  if (video.value && clip.value) songTime.value = clip.value.start + video.value.currentTime
}
const onEnded = () => {
  const next = playable(current.value + 1, 1)
  if (next === undefined) {
    playing.value = false
    return
  }
  open(next, 0, true)
}
const toggle = () => {
  const el = video.value
  if (!el) return
  if (el.paused) {
    if (!src.value) {
      const first = playable(0, 1)
      if (first !== undefined) open(first, 0, true)
    } else void el.play()
  } else el.pause()
}
const step = (direction: 1 | -1) => {
  const index = playable(current.value + direction, direction)
  if (index !== undefined) open(index, 0)
}
const seek = (event: Event) => {
  const t = Number((event.target as HTMLInputElement).value)
  const index = clips.value.findIndex(c => t >= c.start && t < c.end)
  if (index < 0) return
  songTime.value = t
  if (!clips.value[index]!.video) {
    current.value = index
    return
  }
  if (index === current.value && video.value?.readyState) video.value.currentTime = t - clips.value[index]!.start
  else open(index, t - clips.value[index]!.start)
}
// the first clip with a video, when the data comes
watch(
  () => made.value.length,
  () => {
    if (!src.value) {
      const first = playable(0, 1)
      if (first !== undefined) current.value = first
    }
  },
  {immediate: true},
)
const clipLabel = (c: (typeof clips.value)[number]) =>
  `${c.id} · ${clock(c.start, false)}${c.state === 'outdated' ? ' · outdated' : c.state === 'missing' ? ' · not rendered' : ''}`
</script>

<template>
  <details class="lp">
    <summary>Lip-sync preview</summary>
    <p v-if="loading && !data" class="muted">Reading…</p>
    <p v-else-if="error && !data" class="muted">{{ error }}</p>
    <p v-else-if="!data" class="muted">No cut of the song yet - the plan run makes it.</p>
    <template v-else>
      <p class="lp-lead">
        The whole song as a close-up of a dummy singer on a plain background, rendered small ({{ data.settings.scale }} of the video size{{
          data.settings.size ? `, ${data.settings.size}` : ''
        }}; {{ data.settings.dummies === 1 ? 'one dummy' : 'two dummies' }}) from the vocals stem and the full song as a real clip gets them, with the prompt
        built from the <b>saved</b> timing. Watch where the mouth is off, and where it sings without the lyrics: before the real previews and the final render.
        The sizes and the dummies are in Settings.
      </p>
      <CalloutBox v-if="dirty" kind="warn" as="div" class="lp-gap">Moved lines are not saved yet: the preview is made from the saved timing.</CalloutBox>
      <div class="btn-row">
        <button class="btn" :disabled="busy || !todo.length" :title="'bun run lipsync'" @click="render(false)">
          {{
            todo.length === clips.length
              ? `Render the preview (${plural(clips.length, 'clip')})`
              : `Render ${plural(todo.length, 'clip')} that ${todo.length === 1 ? 'is' : 'are'} missing or outdated`
          }}
        </button>
        <button class="btn" :disabled="busy || !made.length" title="Every clip again, the old ones are put away" @click="render(true)">Render all again</button>
        <button v-if="clip" class="btn" :disabled="busy" @click="render(true, [clip.id])">Render {{ clip.id }} again</button>
      </div>
      <CalloutBox v-if="outdated.length" kind="warn" as="div" class="lp-gap">
        {{ plural(outdated.length, 'clip') }} {{ outdated.length === 1 ? 'was' : 'were' }} made from another prompt, size or audio than the project has now:
        {{ outdated.map(c => c.id).join(', ') }}.
      </CalloutBox>
      <div v-if="made.length" class="lp-player">
        <video
          ref="video"
          :src="src"
          playsinline
          preload="metadata"
          @loadedmetadata="onLoaded"
          @timeupdate="onTime"
          @ended="onEnded"
          @play="playing = true"
          @pause="playing = false"
        />
        <div class="lp-controls btn-row">
          <button class="btn mini" :disabled="playable(current - 1, -1) === undefined" @click="step(-1)">◀ Clip</button>
          <button class="btn mini" :aria-pressed="playing" @click="toggle">{{ playing ? 'Pause' : 'Play' }}</button>
          <button class="btn mini" :disabled="playable(current + 1, 1) === undefined" @click="step(1)">Clip ▶</button>
          <span class="muted num">{{ clip ? clipLabel(clip) : '' }} · {{ clock(songTime) }}</span>
        </div>
        <input class="lp-slider" type="range" min="0" :max="duration" step="0.05" :value="songTime" aria-label="Position in the song" @input="seek" />
        <p class="lp-line" aria-live="off">{{ lineNow ? lineNow.text : '' }}&nbsp;</p>
        <p v-if="made.length < clips.length" class="muted">
          {{ plural(clips.length - made.length, 'clip') }} not rendered: the player skips {{ clips.length - made.length === 1 ? 'it' : 'them' }}.
        </p>
      </div>
    </template>
  </details>
</template>

<style scoped>
.lp {
  margin: var(--space-2) 0;
}
.lp summary {
  cursor: pointer;
  font-weight: 500;
}
.lp-lead {
  max-width: 70ch;
}
.lp-gap {
  margin: var(--space-2) 0;
}
.lp-player {
  margin-top: var(--space-3);
  max-width: 420px;
}
.lp-player video {
  width: 100%;
  background: #000;
  border-radius: var(--radius-s);
}
.lp-controls {
  margin-top: var(--space-1);
  align-items: center;
}
.lp-slider {
  width: 100%;
  margin-top: var(--space-1);
}
.lp-line {
  min-height: 1.5em;
  font-weight: 500;
}
</style>
