<script setup lang="ts">
import type {MediaRef, MediaRoots} from '../api/urls'
import {dateOf} from '../lib/format'
import MediaThumb from './MediaThumb.vue'

/** A version put away: its picture, when it was made, why - and what can be done with it (the default slot). */
defineProps<{picture?: MediaRef; roots: MediaRoots; made: number; about: string}>()
defineEmits<{view: []}>()
</script>

<template>
  <article class="version">
    <MediaThumb :media="picture" :roots="roots" cls="" :style="picture ? {cursor: 'zoom-in'} : undefined" @click="picture && $emit('view')" />
    <div>
      <div>{{ dateOf(made) }}</div>
      <div class="muted">{{ about }}</div>
      <slot name="note" />
      <div class="btn-row"><slot /></div>
    </div>
  </article>
</template>
