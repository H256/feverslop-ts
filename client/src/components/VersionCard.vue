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
    <button v-if="picture" type="button" class="version-pic" aria-label="View this version bigger" title="View bigger" @click="$emit('view')">
      <MediaThumb :media="picture" :roots="roots" cls="" />
    </button>
    <MediaThumb v-else :media="picture" :roots="roots" cls="" />
    <div>
      <div>{{ dateOf(made) }}</div>
      <div class="muted">{{ about }}</div>
      <slot name="note" />
      <div class="btn-row"><slot /></div>
    </div>
  </article>
</template>
