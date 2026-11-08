<script setup lang="ts">
import {computed} from 'vue'
import type {TimingView} from '../../../../shared/workspace'
import FactList from '../../components/FactList.vue'
import PlanChanges from '../../components/PlanChanges.vue'
import {plural} from '../../lib/format'
import {useProject} from '../project/session'
import type {TimingDraft} from './useTimingDraft'

/** How the editor is used, and what saving the moved lines does. */
const props = defineProps<{view: TimingView, draft: TimingDraft, saved?: string, early: number}>()
defineEmits<{save: [then: 'none' | 'plan'], cutAgain: [], plan: [], tighten: [], library: []}>()
const {busy} = useProject()
const c = computed(() => props.draft.changes.value)
const KEYS = [
  {name: 'Drag', value: 'a word, its edges, or the bar above the words: the whole line'},
  {name: '← →', value: 'the line by 0.05 s, with Shift by 0.5 s - Tab picks a word, Esc the line again'},
  {name: 'Space', value: 'listen to the line or the word; a click on the waveform plays from there'},
  {name: '↑ ↓', value: 'the line before or after'},
  {name: 'N', value: 'the next line that wants a look - a cut in a word, an early start, an old prompt, a guessed time; Shift+N goes back'},
  {name: 'Ctrl+Z / Ctrl+Shift+Z', value: 'undo / redo'},
]
// the clips that do not know a move yet, with the line they are out of date for
const outdated = computed(() => props.view.outdated.map(({clip, lines}) => {
  const text = props.view.lines.find(l => l.line === lines[0])?.text ?? ''
  return `${clip} (${text.length > 28 ? `${text.slice(0, 27)}…` : text}${lines.length > 1 ? ` and ${lines.length - 1} more` : ''})`
}))
// what a plan run does: the beats without a shot plan are planned again, so their clips get new shots, not only new times
const replanned = computed(() => props.view.beats.filter(b => !b.planned).flatMap(b => b.clips))
const effects = computed(() => {
  const {replanned, clips} = c.value
  return [
    replanned.length && `${replanned.join(', ')} ${replanned.length > 1 ? 'are' : 'is'} planned again if what ${replanned.length > 1 ? 'their' : 'its'} clips sing changes: the language model, no GPU`,
    clips.length && `up to ${plural(clips.length, 'clip')} go stale${clips.length <= 8 ? `: ${clips.join(', ')}` : ''}. Nothing is rendered on its own.`,
    'Inferred or uncertain times stay unchecked until you mark them reviewed.',
  ].filter((line): line is string => !!line)
})
</script>

<template>
  <div>
    <h2>Timing of the lyrics</h2>
    <p class="muted" style="margin-bottom: 10px">Where the words are sung, from the alignment with the transcript. A line it barely found is only spread over the line: estimated.</p>
    <FactList :facts="KEYS" style="margin-bottom: 12px" />
    <div v-if="early" class="note" style="margin-bottom: 10px">
      {{ plural(early, 'line') }} start{{ early === 1 ? 's' : '' }} before the singing does: the box of the first word covers silence.
      <div class="btn-row" style="margin-top: 6px"><button class="btn" @click="$emit('tighten')">{{ early === 1 ? 'Tighten the start' : `Tighten the ${early} starts` }}</button></div>
    </div>
    <div v-if="outdated.length" class="warn" style="margin-bottom: 10px">
      {{ plural(outdated.length, 'clip') }} still {{ outdated.length === 1 ? 'has' : 'have' }} the old times of a moved line in {{ outdated.length === 1 ? 'its' : 'their' }} prompt: {{ outdated.join(', ') }}.
      A plan run writes {{ outdated.length === 1 ? 'it' : 'them' }} again{{ replanned.length ? `, and with it the shots of ${plural(replanned.length, 'clip')} in ${plural(view.unplanned.length, 'beat')} (the language model, no GPU) - their prompts change beyond the times` : '' }}. Rendered videos stay as they are and count as stale after it.
    </div>
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
    <!-- apart from the changes: the saved timing goes into the library, so it is there with nothing moved -->
    <h3 style="margin-top: 16px">The song in the library</h3>
    <p class="muted" style="margin-bottom: 8px">The song, its lyrics, its stems and the saved timing - with what was placed by hand - for another video of the song, which then starts at the story. A song the library has is never overwritten: a later state goes in under another id.</p>
    <div class="btn-row">
      <button class="btn" :disabled="busy || c.lines.length > 0" :title="c.lines.length ? 'Save the moved lines first - the library gets the timing as it is saved' : 'bun run export-song'" @click="$emit('library')">Put the song into the library…</button>
    </div>
  </div>
</template>
