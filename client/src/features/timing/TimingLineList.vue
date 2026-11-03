<script setup lang="ts">
import {computed, nextTick, ref, watch} from 'vue'
import type {TimingLine, TimingView} from '../../../../shared/workspace'
import {clock} from '../../lib/format'
import type {TimingDraft} from './useTimingDraft'

/** The lines of the song to pick one: when it starts, its section, and whether it is estimated, moved or cut through. */
export type LineFilter = 'all' | 'estimated' | 'changed'
const props = defineProps<{view: TimingView, draft: TimingDraft, filter: LineFilter}>()
const emit = defineEmits<{choose: [line: number]}>()
const shown = computed(() => props.view.lines.filter(line => props.filter === 'all' || (props.filter === 'estimated' ? line.estimated : props.draft.isChanged(line))))
const list = ref<HTMLElement>()
// the chosen line stays in sight, also when it is chosen with the keys in the editor
watch(props.draft.selected, n => void nextTick(() => list.value?.querySelector(`[data-line="${n}"]`)?.scrollIntoView({block: 'nearest'})))
const stateOf = (line: TimingLine) => line.estimated && !props.draft.isChanged(line) ? 'estimated' : props.draft.isChanged(line) ? 'moved' : line.byHand ? 'by hand' : ''
</script>

<template>
  <div ref="list" class="tlines">
    <button v-for="line in shown" :key="line.line" :class="['tline-row', {selected: line.line === draft.selected.value, changed: draft.isChanged(line)}]" :data-line="line.line" @click="emit('choose', line.line)">
      <time>{{ clock(draft.startOf(line)) }}</time>
      <span class="muted">{{ line.section }}</span>
      <span>{{ line.text }}</span>
      <span>
        <span v-if="stateOf(line)" :class="['chip', {stale: stateOf(line) === 'estimated'}]" :style="stateOf(line) === 'moved' ? {color: 'var(--accent)'} : undefined">{{ stateOf(line) }}</span>
        <span v-if="draft.crossing(line).length" class="chip bad" title="A clip cut falls into a word">cut</span>
      </span>
    </button>
    <div v-if="!shown.length" class="empty">{{ filter === 'estimated' ? 'No line is estimated: every line was found in the transcript.' : 'Nothing moved yet.' }}</div>
  </div>
</template>
