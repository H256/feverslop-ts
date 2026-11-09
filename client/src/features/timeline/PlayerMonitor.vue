<script setup lang="ts">
import {computed, onMounted, ref} from 'vue'
import AppIcon from '../../components/AppIcon.vue'
import {clock} from '../../lib/format'
import {useToasts} from '../../services/toasts'
import {sourceOptions} from './clips'
import {useTimeline} from './context'
import ReviewBar from './ReviewBar.vue'

/** The monitor and its transport: it stays dark in both themes - a picture is judged against black. */
const {playback, project, pickSource, showHelp} = useTimeline()
const {fail} = useToasts()
const stage = ref<HTMLElement>()
const a = ref<HTMLVideoElement>()
const b = ref<HTMLVideoElement>()
onMounted(() => {
  b.value!.hidden = true
  playback.attach([a.value!, b.value!])
})
const now = computed(() => {
  const clip = playback.clip.value
  return clip ? `${clip.id} · ${project.value.groups.find(g => g.id === clip.group)?.label ?? clip.group}` : ''
})
const options = computed(() => sourceOptions(project.value))
const toggleFullscreen = () => {
  if (document.fullscreenElement) void document.exitFullscreen()
  else stage.value?.requestFullscreen().catch(fail)
}
defineExpose({toggleFullscreen})
</script>

<template>
  <section class="monitor" aria-label="Monitor">
    <div ref="stage" class="stage">
      <video ref="a" playsinline preload="auto" />
      <video ref="b" playsinline preload="auto" />
      <img v-if="playback.poster.value" class="poster" :src="playback.poster.value" alt="" />
      <div v-if="playback.notice.value" class="notice">{{ playback.notice.value }}</div>
      <div v-if="playback.flag.value" class="preview-flag" :title="playback.flag.value.title">{{ playback.flag.value.text }}</div>
      <div v-if="playback.info.value?.behind" class="stage-note" :title="playback.info.value.behindTitle">{{ playback.info.value.behind }}</div>
      <ReviewBar />
    </div>
    <div class="transport">
      <button class="tbtn" title="Previous clip (←)" aria-label="Previous clip" @click="playback.step(-1)"><AppIcon name="prev" /></button>
      <button
        class="tbtn play"
        title="Play or pause (Space)"
        :aria-label="playback.playing.value ? 'Pause' : 'Play'"
        @click="playback.setPlaying(!playback.playing.value)"
      >
        <AppIcon :name="playback.playing.value ? 'pause' : 'play'" />
      </button>
      <button class="tbtn" title="Next clip (→)" aria-label="Next clip" @click="playback.step(1)"><AppIcon name="next" /></button>
      <span class="time"
        ><span>{{ clock(playback.t.value) }}</span> <span class="muted">/ {{ clock(project.seconds, false) }}</span></span
      >
      <span class="now muted">{{ now }}</span>
      <div class="spacer" />
      <span v-if="playback.speed.value !== 1" class="chip num">{{ playback.speed.value }}×</span>
      <button v-if="playback.loop.value" class="chip" title="Stop the loop (O)" @click="playback.toggleLoop(false)">
        Loop {{ playback.loop.value.label }} ×
      </button>
      <span v-if="playback.info.value?.text" class="chip num" :title="playback.info.value.title">{{ playback.info.value.text }}</span>
      <select
        class="source"
        title="What the monitor plays"
        aria-label="What the monitor plays"
        :value="playback.source.value"
        @change="pickSource(($event.target as HTMLSelectElement).value)"
      >
        <option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option>
      </select>
      <button class="tbtn" title="Keys and words (?)" aria-label="Keys and words" @click="showHelp">?</button>
      <button class="tbtn" title="Sound on or off (M)" aria-label="Sound on or off" @click="playback.toggleMute()">
        <AppIcon :name="playback.muted.value ? 'muted' : 'sound'" />
      </button>
    </div>
  </section>
</template>
