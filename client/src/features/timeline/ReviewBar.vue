<script setup lang="ts">
import {useTimeline} from './context'

/** Where a review stands, and its keys - on the monitor. */
const {review} = useTimeline()
</script>

<template>
  <div v-if="review.review.value && review.current.value" class="reviewbar">
    <b>{{ review.current.value.id }}</b>
    <span class="num">{{ review.review.value.index + 1 }} of {{ review.review.value.clips.length }}</span>
    <span><kbd>Enter</kbd> fine</span><span><kbd>R</kbd> render again</span><span><kbd>C</kbd> compare</span><span><kbd>Esc</kbd> end</span>
    <span v-if="review.review.value.again.size">{{ review.review.value.again.size }} to render</span>
  </div>
</template>
