<script setup lang="ts">
import {computed, ref, watch} from 'vue'
import {mediaUrl, thumbUrl} from '../../api/urls'
import {clamp, clock} from '../../lib/format'
import {standIn} from './clips'
import {useTimeline} from './context'

/** The larger look over a clip or a picture: a clip's video follows the pointer, as fast as a video can - the newest place wins. */
const {peek, session} = useTimeline()
const box = ref<HTMLElement>()
const video = ref<HTMLVideoElement>()
const clip = computed(() => peek.value?.clip)
const stand = computed(() => (clip.value ? standIn(clip.value) : peek.value?.picture))
let lastSeek = 0
watch(
  () => peek.value?.at,
  at => {
    if (at === undefined || !video.value || performance.now() - lastSeek < 90) return
    lastSeek = performance.now()
    video.value.currentTime = at
  },
)
const place = computed(() => {
  const p = peek.value
  if (!p) return {}
  const height = box.value?.offsetHeight ?? 200
  return {left: `${clamp(p.x - 160, 8, innerWidth - 328)}px`, top: `${clamp(p.top - height - 8, 8, innerHeight - height - 8)}px`}
})
const caption = computed(() => {
  const p = peek.value
  if (!p) return ''
  if (p.clip) return `${p.clip.id} · ${clock(p.clip.start + p.at)}${p.clip.video ? '' : ' · not rendered'}`
  return p.picture?.name || p.picture?.label || ''
})
</script>

<template>
  <div v-if="peek" ref="box" class="peek" :style="place">
    <video
      v-if="clip?.video"
      :key="clip.id"
      ref="video"
      :src="mediaUrl(clip.video, session.roots)"
      muted
      preload="auto"
      :poster="stand ? thumbUrl(stand, session.roots, 640) : undefined"
    />
    <img v-else-if="stand" :src="thumbUrl(stand, session.roots, 640)" alt="" />
    <div class="num">{{ caption }}</div>
  </div>
</template>
