<script setup lang="ts">
import {computed} from 'vue'
import {thumbUrl, type MediaRef, type MediaRoots} from '../api/urls'

/** A small picture of a file, or the hatched place of one that is not there. Clicking it is the caller's. */
const props = withDefaults(defineProps<{media?: MediaRef; roots: MediaRoots; width?: 320 | 640; alt?: string; cls?: string; missing?: string}>(), {
  media: undefined,
  width: 320,
  alt: '',
  cls: 'thumb',
  missing: undefined,
})
const src = computed(() => props.media && thumbUrl(props.media, props.roots, props.width))
</script>

<template>
  <img v-if="src" :class="cls" :src="src" :alt="alt" loading="lazy" decoding="async" />
  <span v-else :class="cls === 'thumb' ? 'thumb' : 'noimg'">{{ missing }}</span>
</template>
