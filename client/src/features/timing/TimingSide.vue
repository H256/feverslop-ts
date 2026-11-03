<script setup lang="ts">
import {computed} from 'vue'
import type {TimingView} from '../../../../shared/workspace'
import FactList from '../../components/FactList.vue'
import PlanChanges from '../../components/PlanChanges.vue'
import {plural} from '../../lib/format'
import {useProject} from '../project/session'
import type {TimingDraft} from './useTimingDraft'

/** How the editor is used, and what saving the moved lines does. */
const props = defineProps<{view: TimingView, draft: TimingDraft, saved?: string}>()
defineEmits<{save: [then: 'none' | 'plan'], cutAgain: [], plan: []}>()
const {busy} = useProject()
const c = computed(() => props.draft.changes.value)
const KEYS = [
  {name: 'Drag', value: 'a word, its edges, or the bar above the words: the whole line'},
  {name: '← →', value: 'the line by 0.05 s, with Shift by 0.5 s - Tab picks a word, Esc the line again'},
  {name: 'Space', value: 'listen to the line or the word; a click on the waveform plays from there'},
  {name: '↑ ↓', value: 'the line before or after'},
  {name: 'Ctrl+Z', value: 'undo'},
]
const effects = computed(() => {
  const {replanned, clips} = c.value
  return [
    replanned.length && `${replanned.join(', ')} ${replanned.length > 1 ? 'are' : 'is'} planned again if what ${replanned.length > 1 ? 'their' : 'its'} clips sing changes: the language model, no GPU`,
    clips.length && `up to ${plural(clips.length, 'clip')} go stale${clips.length <= 8 ? `: ${clips.join(', ')}` : ''}. Nothing is rendered on its own.`,
    'The moved lines count as placed by hand: no longer estimated.',
  ].filter((line): line is string => !!line)
})
</script>

<template>
  <div>
    <h2>Timing of the lyrics</h2>
    <p class="muted" style="margin-bottom: 10px">Where the words are sung, from the alignment with the transcript. A line it barely found is only spread over the line: estimated.</p>
    <FactList :facts="KEYS" style="margin-bottom: 12px" />
    <PlanChanges
      :count="c.lines.length ? `${plural(c.lines.length, 'line')} moved` : ''" :effects="effects" :blocked="busy ? 'A run is going on' : ''" :saved="saved"
      :unplanned="view.unplanned" :busy="busy" idle="Move a line, and the clips it is sung in get its new times. The cut of the song stays."
      kept-in="Kept in project.json (lyricsTiming) until lyrics.txt changes or --redo=lyricsTiming aligns the lyrics again."
      @discard="draft.discard()" @save="$emit('save', 'none')" @save-and-plan="$emit('save', 'plan')" @plan="$emit('plan')">
      <template #warning>
        <div v-if="c.crossing.length" class="warn">A clip cut falls into {{ plural(c.crossing.length, 'word') }}. Saving keeps the cut; cutting the song again places the cuts around the new times, but plans every shot again.</div>
      </template>
      <template #more>
        <div class="btn-row" style="margin-top: 8px">
          <button class="btn" :disabled="busy" title="Save, then cut the song into clips again around the new times (--redo=timeline): every shot is planned again" @click="$emit('cutAgain')">Save and cut the song again…</button>
        </div>
      </template>
    </PlanChanges>
  </div>
</template>
