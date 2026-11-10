<script setup lang="ts">
import {useTimeline} from './context'

/** Where a review stands, and its keys - on the monitor. */
const {review} = useTimeline()
</script>

<template>
  <div v-if="review.review.value && review.current.value" class="reviewbar">
    <b>{{ review.current.value.id }}</b>
    <span class="num">{{ review.review.value.index + 1 }} of {{ review.review.value.clips.length }}</span>
    <span v-if="review.review.value.again.has(review.current.value.id)" class="kept">↻ kept</span>
    <span
      v-if="review.review.value.clips[review.review.value.index + 1]"
      class="muted"
      title="The next clip of the review - the marked ones, else the flagged ones"
      >next {{ review.review.value.clips[review.review.value.index + 1]!.id }}</span
    >
    <span><kbd>Space</kbd> play</span><span><kbd>Enter</kbd> fine</span><span><kbd>R</kbd> render again, later</span><span><kbd>C</kbd> compare</span>
    <span><kbd>Esc</kbd> end</span>
    <label title="Each clip starts playing as soon as the review comes to it - kept for this browser"
      ><input type="checkbox" :checked="review.autoplay.value" @change="review.setAutoplay(($event.target as HTMLInputElement).checked)" />Play by itself</label
    >
    <span v-if="review.review.value.again.size" title="Rendered together when the review ends">{{ review.review.value.again.size }} to render at the end</span>
  </div>
</template>
