<script setup lang="ts">
import {computed} from 'vue'
import type {ClipProgress, EditorClip} from '../../../../shared/workspace'
import {thumbUrl, type MediaRoots} from '../../api/urls'
import {plural} from '../../lib/format'
import {TERMS} from '../../lib/terms'
import {STATE_CHIPS, movedText, standIn, type ClipState} from './clips'

/** A clip on the timeline: its picture, its shots as ticks, what it is now, and what a run does to it. */
const props = defineProps<{
  clip: EditorClip
  state: ClipState
  selected: boolean
  marked: boolean
  flagged: boolean
  progress?: ClipProgress
  roots: MediaRoots
  again?: boolean // kept with R in a review: rendered when it ends
  reviewed?: boolean // the clip the review is at
}>()
defineEmits<{pick: [event: MouseEvent]}>()
const seconds = computed(() => props.clip.end - props.clip.start)
const stand = computed(() => standIn(props.clip))
const label = computed(
  () => `${props.clip.id}, ${STATE_CHIPS[props.state].label}${props.clip.marks.length ? `, ${plural(props.clip.marks.length, 'mark')}` : ''}`,
)
</script>

<template>
  <button
    :class="['clip', state, {selected, flagged, marked, again, reviewed, [`p-${progress}`]: progress}]"
    :data-id="clip.id"
    :title="[movedText(clip), ...clip.marks.map(m => m.text)].filter(Boolean).join('\n')"
    :style="{'--s': clip.start, '--d': seconds}"
    :aria-label="label"
    @click="$emit('pick', $event)"
  >
    <img v-if="stand" :src="thumbUrl(stand, roots)" alt="" decoding="async" draggable="false" />
    <span v-for="shot in clip.shots.slice(1)" :key="shot.label" class="tick" :style="{left: `${(shot.at / seconds) * 100}%`}" />
    <span class="tag">{{ clip.id.replace(/^\D+/, '') }}</span>
    <span v-if="clip.startsFrom" class="goes" :title="`Goes on from ${clip.startsFrom}. ${TERMS['Goes on']}`" />
    <span v-if="clip.marks.length" class="flag" />
    <span v-if="clip.video?.moved" class="moved">{{ clip.video.moved > 0 ? '+' : '' }}{{ clip.video.moved.toFixed(1) }}s</span>
    <span v-if="clip.preview" class="has-preview" :title="clip.preview.approximate ? 'Has an approximate preview' : 'Has a preview'">P</span>
    <span v-if="marked" class="ticked">✓</span>
    <span v-if="again" class="again" title="Kept with R: rendered again when the review ends">↻ render</span>
    <span v-if="progress" class="progress">{{ progress }}</span>
  </button>
</template>
