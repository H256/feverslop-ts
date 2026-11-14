<script setup lang="ts">
import {computed} from 'vue'
import {useTimeline} from './context'

/** Where a review stands, and its keys - on the monitor. */
const {review, playback} = useTimeline()
const r = computed(() => review.review.value)
// the clip that is playing: R marks it, in the review's list or not
const here = computed(() => playback.clip.value)
const next = computed(() => (r.value && review.position.value >= 0 ? r.value.clips[review.position.value + 1] : undefined))
</script>

<template>
  <div v-if="r" class="reviewbar">
    <b v-if="here">{{ here.id }}</b>
    <span v-if="review.position.value >= 0" class="num">{{ review.position.value + 1 }} of {{ r.clips.length }}</span>
    <span v-if="here && r.again.has(here.id)" class="kept">↻ kept</span>
    <span
      v-if="next && next.start > (here?.end ?? 0) + 0.001"
      class="muted"
      title="The review plays on into the next clip of its list - the marked ones, else the flagged ones"
      >then {{ next.id }}</span
    >
    <span><kbd>Space</kbd> play</span><span><kbd>R</kbd> render again at the end</span><span><kbd>← →</kbd> clip</span><span><kbd>O</kbd> loop</span
    ><span><kbd>C</kbd> compare</span>
    <span><kbd>Esc</kbd> end</span>
    <label title="The review starts playing as soon as it starts - kept for this browser"
      ><input type="checkbox" :checked="review.autoplay.value" @change="review.setAutoplay(($event.target as HTMLInputElement).checked)" />Play by itself</label
    >
    <span v-if="r.again.size" title="Rendered together when the review ends">{{ r.again.size }} to render at the end</span>
  </div>
</template>
