<script setup lang="ts">
import {computed, nextTick, ref, watch} from 'vue'
import type {TimingLine, TimingView} from '../../../../shared/workspace'
import {clock} from '../../lib/format'
import {EARLY_FROM} from './fit'
import type {TimingDraft} from './useTimingDraft'

/** The lines of the song to pick one: when it starts, its section, and whether it is estimated, moved or cut through. */
export type LineFilter = 'all' | 'estimated' | 'changed' | 'early' | 'old'
const props = defineProps<{view: TimingView; draft: TimingDraft; filter: LineFilter; leads: Map<number, number>; outdated: Map<number, string[]>}>()
const emit = defineEmits<{choose: [line: number, extend: boolean]}>()
const early = (line: TimingLine) => (props.leads.get(line.line) ?? 0) >= EARLY_FROM
const keep: Record<LineFilter, (line: TimingLine) => boolean> = {
  all: () => true,
  estimated: line => line.estimated,
  changed: line => props.draft.isChanged(line),
  early,
  old: line => props.outdated.has(line.line),
}
// the early starts with the worst first: that is where to look
const shown = computed(() => {
  const lines = props.view.lines.filter(keep[props.filter])
  return props.filter === 'early' ? [...lines].sort((a, b) => (props.leads.get(b.line) ?? 0) - (props.leads.get(a.line) ?? 0)) : lines
})
const list = ref<HTMLElement>()
// the chosen line stays in sight, also when it is chosen with the keys in the editor
watch(props.draft.selected, n => void nextTick(() => list.value?.querySelector(`[data-line="${n}"]`)?.scrollIntoView({block: 'nearest'})))
const EMPTY: Record<LineFilter, string> = {
  all: 'No lines.',
  estimated: 'No line is estimated: every line was found in the transcript.',
  changed: 'Nothing moved yet.',
  early: 'No first word starts before its singing.',
  old: 'Every clip has the times of the lines it sings.',
}
const stateOf = (line: TimingLine) =>
  line.adlib
    ? line.off
      ? 'ad-lib'
      : 'ad-lib, sung'
    : line.problem
      ? 'check'
      : line.off
        ? 'left out'
        : line.unplaced && !props.draft.isChanged(line)
          ? 'not found'
          : props.draft.unchecked(line)
            ? 'estimated'
            : props.draft.isChanged(line)
              ? 'moved'
              : line.byHand
                ? 'by hand'
                : ''
</script>

<template>
  <div ref="list" class="tlines">
    <button
      v-for="line in shown"
      :key="line.line"
      :class="['tline-row', {selected: draft.selection.value.some(s => s.line.line === line.line), changed: draft.isChanged(line)}]"
      :data-line="line.line"
      @click="emit('choose', line.line, $event.shiftKey)"
    >
      <time>{{ clock(draft.startOf(line)) }}</time>
      <span class="muted">{{ line.section }}</span>
      <span :style="line.off ? {textDecoration: 'line-through', color: 'var(--muted)'} : undefined">{{ line.text }}</span>
      <span>
        <span
          v-if="stateOf(line)"
          :class="[
            'chip',
            {stale: ['estimated', 'not found', 'ad-lib'].includes(stateOf(line)), bad: stateOf(line) === 'left out' || stateOf(line) === 'check'},
          ]"
          :title="
            stateOf(line) === 'not found'
              ? 'The alignment found this line sung nowhere: its words are only laid out where it stands in the lyrics - listen and drag them where it is sung'
              : stateOf(line).startsWith('ad-lib')
                ? 'Heard, but not in lyrics.txt - a suggestion, sung once taken'
                : line.problem
          "
          :style="stateOf(line) === 'moved' ? {color: 'var(--accent)'} : undefined"
          >{{ stateOf(line) }}</span
        >
        <span v-if="early(line)" class="chip stale" title="The first word starts before the singing does: its box covers silence"
          >early {{ leads.get(line.line)!.toFixed(1) }} s</span
        >
        <span
          v-if="outdated.has(line.line)"
          class="chip stale"
          :title="`The prompt of ${outdated.get(line.line)!.join(', ')} still has this line at its old times: plan again`"
          >prompt old</span
        >
        <span v-if="draft.crossing(line).length" class="chip bad" title="A clip cut falls into a word">cut</span>
      </span>
    </button>
    <div v-if="!shown.length" class="empty">{{ EMPTY[filter] }}</div>
  </div>
</template>
