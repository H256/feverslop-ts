<script setup lang="ts">
import {computed, onMounted, ref, toRef, watch} from 'vue'
import {useRoute} from 'vue-router'
import type {TimingView} from '../../../../shared/workspace'
import {mediaUrl} from '../../api/urls'
import PageBar from '../../components/PageBar.vue'
import SegmentedControl from '../../components/SegmentedControl.vue'
import {usePending} from '../../composables/usePending'
import {useSnippetPlayer} from '../../composables/useSnippetPlayer'
import {useUnsavedChanges} from '../../composables/useUnsavedChanges'
import {clock, plural} from '../../lib/format'
import {useAsk} from '../../services/ask'
import {useToasts} from '../../services/toasts'
import {usePlanning} from '../plan/usePlanning'
import {useProject} from '../project/session'
import {EARLY_FROM, leadOf} from './fit'
import TimingEditor from './TimingEditor.vue'
import TimingLineList, {type LineFilter} from './TimingLineList.vue'
import TimingSide from './TimingSide.vue'
import {useTimingDraft} from './useTimingDraft'

/**
 * When the lyrics are sung. A line the alignment barely found has guessed times; here its words are moved on the waveform of the vocals.
 * The cut of the song stays: the clips' vocals are worked out again, and the beats whose clips sing something else lose their shot plan.
 */
const props = defineProps<{view: TimingView, peaks?: number[], refresh: () => Promise<boolean>}>()
const {api, roots, start} = useProject()
const ask = useAsk()
const toasts = useToasts()
const {planNow} = usePlanning()
const draft = useTimingDraft(toRef(props, 'view'))
const saved = ref<string>()
const editor = ref<InstanceType<typeof TimingEditor>>()
useUnsavedChanges(() => draft.edits.value.size > 0, 'moved lines')
watch(() => draft.edits.value.size, count => { if (count) saved.value = undefined })

const player = useSnippetPlayer(() => props.view.audio && mediaUrl(props.view.audio, roots), toasts.fail)
const play = (from: number, to: number) => player.play('timing', from, to)

// how early the first word of each line starts against its sound - as the words are now, so a line moved is measured again
const leads = computed(() => new Map(props.view.lines.map(l => [l.line, props.peaks && !(l.unplaced && !draft.isChanged(l)) ? leadOf(draft.wordsOf(l), props.peaks) : 0])))
const earlyLines = computed(() => new Map([...leads.value].filter(([, lead]) => lead >= EARLY_FROM)))
const lead = computed(() => draft.line.value ? leads.value.get(draft.line.value.line) ?? 0 : 0)
// the clips whose prompt still has the old times of a line: by line
const outdated = computed(() => {
  const found = new Map<number, string[]>()
  for (const {clip, lines} of props.view.outdated) for (const n of lines) found.set(n, [...found.get(n) ?? [], clip])
  return found
})
// the lines that want a look, in the order of the song: a clip cut in a word, an early start, an old prompt, a guessed time
const problems = computed(() => props.view.lines.filter(l => draft.crossing(l).length || earlyLines.value.has(l.line) || outdated.value.has(l.line) || (l.estimated && !draft.isChanged(l))))
const nextProblem = (back = false) => {
  const all = problems.value
  if (!all.length) return toasts.show('Nothing left to look at.')
  const at = draft.line.value ? props.view.lines.indexOf(draft.line.value) : -1
  const ordered = back ? [...all].reverse() : all
  const found = ordered.find(l => back ? props.view.lines.indexOf(l) < at : props.view.lines.indexOf(l) > at) ?? ordered[0]!
  choose(found.line)
}
const tightenAll = () => { draft.tighten(earlyLines.value) }

const FILTERS = computed(() => [
  {value: 'all', label: 'All lines'},
  {value: 'estimated', label: `Estimated (${props.view.lines.filter(l => l.estimated).length})`},
  {value: 'changed', label: 'Moved'},
  ...(earlyLines.value.size ? [{value: 'early', label: `Early starts (${earlyLines.value.size})`}] : []),
  ...(outdated.value.size ? [{value: 'old', label: `Prompt old (${outdated.value.size})`}] : []),
] as const)
const filter = ref<LineFilter>('all')
const choose = (n: number) => {
  draft.choose(n)
  editor.value?.focus()
}

// while saving the page is not to be changed: the moved lines are let go - only once what was saved has been read again
const saving = usePending()
const save = toasts.guard((then: 'none' | 'plan' | 'cut') => saving.during(async () => {
  const result = await api.saveTiming(draft.request())
  if (!await props.refresh()) {
    saved.value = 'Saved - but the page could not read it again: what you see is what was sent.'
    return
  }
  draft.discard()
  saved.value = [
    `Saved: ${plural(result.slots.length, 'clip')} sing${result.slots.length === 1 ? 's' : ''} something else now.`,
    result.replanned.length && `${result.replanned.join(', ')} ${then === 'plan' ? 'are planned now' : 'are planned with the next plan run'}.`,
  ].filter(Boolean).join(' ')
  if (then === 'plan' && props.view.unplanned.length) await start({type: 'plan'})
  if (then === 'cut') await start({type: 'plan', redo: ['timeline']})
}))
const cutAgain = toasts.guard(async () => {
  const yes = await ask({
    title: 'Cut the song again?',
    lines: ['The new times are saved, then the song is cut into clips again around them (--redo=timeline).', 'Every shot of the video is planned again by the language model, and every clip whose cut or plan changes goes stale. Nothing is rendered on its own.'],
    warnings: ['On a whole song that takes a while: the blocking and the shots of every beat.'],
    confirm: 'Save and cut again',
  })
  if (yes) await save('cut')
})

// a link to a line opens it
const route = useRoute()
onMounted(() => {
  const wanted = /^#line-(\d+)$/.exec(route.hash)
  if (wanted && draft.lineOf(Number(wanted[1]))) draft.choose(Number(wanted[1]))
})
</script>

<template>
  <div class="split view" :inert="saving.pending.value" :aria-busy="saving.pending.value">
    <div class="scrollpage">
      <PageBar title="When the lyrics are sung"><SegmentedControl v-model="filter" :options="FILTERS" label="Lines shown" /></PageBar>
      <div class="tedit-wrap">
        <div class="tedit-head btn-row">
          <template v-if="draft.line.value">
            <b>{{ draft.line.value.text }}</b>
            <span class="muted num">{{ draft.line.value.section }} · {{ clock(draft.startOf(draft.line.value)) }}–{{ clock(draft.endOf(draft.line.value)) }}</span>
            <span v-if="draft.line.value.estimated && !draft.isChanged(draft.line.value)" class="chip stale" title="Barely found in the transcript: the times are spread over the line, a guess">estimated</span>
            <span v-if="draft.isChanged(draft.line.value)" class="chip" style="color: var(--accent)">moved</span>
            <span v-if="lead >= EARLY_FROM" class="chip stale" title="The first word starts before the singing does: its box covers silence. Tighten the start, or drag it.">starts {{ lead.toFixed(1) }} s early</span>
            <span v-if="outdated.has(draft.line.value.line)" class="chip stale" :title="`The prompt of ${outdated.get(draft.line.value.line)!.join(', ')} still has this line at its old times: plan again`">prompt old</span>
          </template>
          <div class="spacer" />
          <button v-if="draft.line.value" class="btn" @click="editor?.playLine(draft.line.value)">Listen</button>
          <button v-if="draft.line.value && lead >= EARLY_FROM" class="btn" title="Move the start of the first word to where the singing begins" @click="draft.tighten(new Map([[draft.line.value.line, lead]]))">Tighten the start</button>
          <button v-if="draft.line.value && draft.crossing(draft.line.value).length" class="btn" title="Cut the part on the shorter side off the word, so that it is sung in one clip" @click="draft.clearCuts(draft.line.value)">Clear the cut</button>
          <button v-if="problems.length" class="btn" :title="`${problems.length} lines want a look: cuts in words, early starts, old prompts, guessed times. Key N, Shift+N back`" @click="nextProblem()">Next problem ({{ problems.length }})</button>
          <button v-if="draft.line.value && draft.isChanged(draft.line.value)" class="btn" title="Back to the saved times" @click="draft.resetLine(draft.line.value)">Reset line</button>
          <button class="btn" :disabled="!draft.history.length" title="Ctrl+Z" @click="draft.undo()">Undo</button>
          <button class="btn" title="Ctrl+wheel, + / -" @click="draft.zoom(0.8)">+</button>
          <button class="btn" title="Ctrl+wheel, + / -" @click="draft.zoom(1.25)">−</button>
        </div>
        <TimingEditor ref="editor" :view="view" :draft="draft" :peaks="peaks" :head="player.time.value" :playing="!!player.playing.value" @play="play" @stop="player.stop()" @next="nextProblem" />
        <div>
          <div v-if="draft.line.value && draft.crossing(draft.line.value).length" class="warn">A clip cut falls into {{ draft.crossing(draft.line.value).map(c => `"${c.word.text}"`).join(', ') }}: the word is then sung half in one clip, half in the next. Clear the cut above (it shortens the word), move it, or cut the song again on the right.</div>
          <div v-if="draft.overlaps.value.length" class="warn">This line overlaps {{ draft.overlaps.value.map(l => `"${l.text}"`).join(' and ') }}. Fine for two singers at once - otherwise move one of them.</div>
        </div>
      </div>
      <TimingLineList :view="view" :draft="draft" :filter="filter" :leads="leads" :outdated="outdated" @choose="choose" />
    </div>
    <aside class="detail"><TimingSide :view="view" :draft="draft" :saved="saved" :early="earlyLines.size" @save="save" @cut-again="cutAgain" @tighten="tightenAll" @plan="toasts.guard(planNow)()" /></aside>
  </div>
</template>
