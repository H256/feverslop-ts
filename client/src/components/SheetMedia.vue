<script setup lang="ts">
import {mediaUrl, thumbUrl, type MediaRef, type MediaRoots} from '../api/urls'
import {useViewer} from '../services/viewer'

/**
 * A person or place with its sheet: the picture large on top, what the caller says of it (the default slot), the sequence video
 * the views come from, and the views. A library asset and a project's reference look alike.
 */
defineProps<{
  item: {picture?: MediaRef; video?: MediaRef; frames: MediaRef[]}
  roots: MediaRoots
  name: string
  title: string
  caption?: string
  text?: string
  missing?: string
}>()
const viewer = useViewer()
</script>

<template>
  <img
    v-if="item.picture"
    class="sheet-picture"
    :src="thumbUrl(item.picture, roots, 640)"
    :alt="name"
    @click="viewer.open(item.picture, roots, title, caption, text)"
  />
  <div v-else-if="missing" class="empty">{{ missing }}</div>
  <slot />
  <div v-if="item.video" class="section">
    <h3>Sequence</h3>
    <video :key="item.video.file" :src="mediaUrl(item.video, roots)" controls preload="metadata" style="width: 100%" />
  </div>
  <div v-if="item.frames.length" class="section">
    <h3>Views</h3>
    <div class="strip">
      <img
        v-for="(frame, n) in item.frames"
        :key="frame.file"
        :src="thumbUrl(frame, roots)"
        :alt="`View ${n + 1}`"
        loading="lazy"
        @click="viewer.open(frame, roots, `View ${n + 1}`, name)"
      />
    </div>
  </div>
</template>
