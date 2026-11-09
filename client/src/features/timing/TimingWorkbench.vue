<script setup lang="ts">
import {computed, h, onMounted, ref, toRef, watch} from 'vue'
import {useRoute} from 'vue-router'
import type {TimingView} from '../../../../shared/workspace'
import {mediaUrl} from '../../api/urls'
import FormField from '../../components/FormField.vue'
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
import TimingTools from './TimingTools.vue'
import {useTimingDraft} from './useTimingDraft'

/**
 * When the lyrics are sung. A line the alignment barely found has guessed times; here its words are moved on the waveform of the vocals.
 * The cut of the song stays: the clips' vocals are worked out again, and the beats whose clips sing something else lose their shot plan.
 */
const props = defineProps<{view: TimingView, peaks?: number[], refresh: () => Promise<boolean>}>()
const {api, roots, start, id} = useProject()
const ask = useAsk()
const toasts = useToasts()
const {planNow} = usePlanning()
const draft = useTimingDraft(toRef(props, 'view'))
const saved = ref<string>()
const editor = ref<InstanceType<typeof TimingEditor>>()
const timingTools = ref<InstanceType<typeof TimingTools>>()
useUnsavedChanges(() => draft.edits.value.size > 0, 'moved lines')
watch(() => draft.edits.value.size, count => { if (count) saved.value = undefined })

const player = useSnippetPlayer(() => props.view.audio && mediaUrl(props.view.audio, roots), toasts.fail)
const play = (from: number, to: number) => player.play('timing', from, to)

// how early the first word of each line starts against its sound - as the words are now, so a line moved is measured again
const leads = computed(() => new Map(props.view.lines.map(l => [l.line, props.peaks && !l.off && !(l.unplaced && !draft.isChanged(l)) ? leadOf(draft.wordsOf(l), props.peaks) : 0])))
const earlyLines = computed(() => new Map([...leads.value].filter(([, lead]) => lead >= EARLY_FROM)))
const lead = computed(() => draft.line.value ? leads.value.get(draft.line.value.line) ?? 0 : 0)
// the clips whose prompt still has the old times of a line: by line
const outdated = computed(() => {
  const found = new Map<number, string[]>()
  for (const {clip, lines} of props.view.outdated) for (const n of lines) found.set(n, [...found.get(n) ?? [], clip])
  return found
})
// the lines that want a look, in the order of the song: a clip cut in a word, an early start, an old prompt, a guessed time
const problems = computed(() => props.view.lines.filter(l => !l.off && (draft.crossing(l).length || earlyLines.value.has(l.line) || outdated.value.has(l.line) || draft.unchecked(l))))
const nextProblem = (back = false) => {
  const all = problems.value
  if (!all.length) return toasts.show('Nothing left to look at.')
  const at = draft.line.value ? props.view.lines.indexOf(draft.line.value) : -1
  const ordered = back ? [...all].reverse() : all
  const found = ordered.find(l => back ? props.view.lines.indexOf(l) < at : props.view.lines.indexOf(l) > at) ?? ordered[0]!
  choose(found.line)
}
const nextKind = (kind: 'unchecked' | 'cut') => {
  const all = props.view.lines.filter(l => !l.off && (kind === 'unchecked' ? draft.unchecked(l) : draft.crossing(l).length))
  const at = props.view.lines.findIndex(l => l.line === draft.selected.value)
  const found = all.find(l => props.view.lines.indexOf(l) > at) ?? all[0]
  if (found) choose(found.line)
}
const tightenAll = () => { draft.tighten(earlyLines.value) }
// a line left out (heard, but not sung) or sung again - saved at once, as bun run timing --off / --on does it
const setOff = toasts.guard((line: TimingView['lines'][number], off: boolean) => saving.during(async () => {
  const result = await api.saveTiming({lines: [{line: line.line, off}]})
  await props.refresh()
  saved.value = [
    `"${line.text}" ${off ? 'is left out: no clip sings it' : 'is sung again'}.`,
    result.slots.length && `${plural(result.slots.length, 'clip')} sing${result.slots.length === 1 ? 's' : ''} something else now.`,
    result.replanned.length && `${result.replanned.join(', ')} ${result.replanned.length > 1 ? 'are' : 'is'} planned with the next plan run.`,
  ].filter(Boolean).join(' ')
}))

// back to the automatic timing (#738): the line as the alignment makes it from the kept transcript - a correction that was wrong
const reset = toasts.guard((lines: TimingView['lines']) => saving.during(async () => {
  if (lines.length > 1 && !await ask({title: `Set ${plural(lines.length, 'line')} back to the automatic timing?`, lines: ['Every line placed by hand goes back to where the alignment puts it. Whisper does not run again.'], confirm: 'Set them back'})) return
  const result = await api.saveTiming({lines: lines.map(l => ({line: l.line, reset: true}))})
  await props.refresh()
  saved.value = [
    lines.length === 1 ? `"${lines[0]!.text}" is back at the automatic timing.` : `${plural(result.changed.length, 'line')} back at the automatic timing.`,
    result.replanned.length && `${result.replanned.join(', ')} ${result.replanned.length > 1 ? 'are' : 'is'} planned with the next plan run.`,
  ].filter(Boolean).join(' ')
}))
const byHand = computed(() => props.view.lines.filter(l => l.byHand))

const FILTERS = computed(() => [
  {value: 'all', label: 'All lines'},
  {value: 'estimated', label: `Estimated (${props.view.lines.filter(l => l.estimated).length})`},
  {value: 'changed', label: 'Moved'},
  ...(earlyLines.value.size ? [{value: 'early', label: `Early starts (${earlyLines.value.size})`}] : []),
  ...(outdated.value.size ? [{value: 'old', label: `Prompt old (${outdated.value.size})`}] : []),
] as const)
const filter = ref<LineFilter>('all')
const choose = (n: number, extend = false) => {
  draft.choose(n, extend)
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
// the song with its stems and this timing into the library, as bun run export-song does it
const putIntoLibrary = toasts.guard(async () => {
  const songId = ref(id), name = ref(id)
  const field = (label: string, value: typeof songId) => h(FormField, {label}, () => h('input', {type: 'text', required: true, value: value.value, onInput: (event: Event) => { value.value = (event.target as HTMLInputElement).value }}))
  await ask({
    title: 'Put the song into the library?',
    lines: [
      'The song, its lyrics, its six stems, the analysis, the transcript and this timing are copied - with every line placed by hand.',
      'A new project takes it with bun run init or bun run import-song and starts at the story: nothing of the song is worked out again. A song the library already has is never overwritten.',
    ],
    body: () => h('div', [field('Song id', songId), field('Name', name)]),
    confirm: 'Put it in',
    submit: () => start({type: 'export-song', as: songId.value.trim(), name: name.value.trim()}),
  })
})

// a link to a line opens it
const route = useRoute()
onMounted(() => {
  const wanted = /^#line-(\d+)$/.exec(route.hash)
  if (wanted && draft.lineOf(Number(wanted[1]))) draft.choose(Number(wanted[1]))
})
</script>

<template>
  <div class="split view" :inert="saving.pending.value" :aria-busy="saving.pending.value" @keydown.capture="timingTools?.key($event)">
    <div class="scrollpage">
      <PageBar title="When the lyrics are sung"><SegmentedControl v-model="filter" :options="FILTERS" label="Lines shown" /></PageBar>
      <div class="tedit-wrap">
        <div class="tedit-head btn-row">
          <template v-if="draft.line.value">
            <b>{{ draft.line.value.text }}</b>
            <span class="muted num">{{ draft.line.value.section }} · {{ clock(draft.startOf(draft.line.value)) }}–{{ clock(draft.endOf(draft.line.value)) }}</span>
            <span v-if="draft.unchecked(draft.line.value)" class="chip stale" title="Barely found in the transcript: the times are spread over the line, a guess">estimated</span>
            <span v-if="draft.isChanged(draft.line.value)" class="chip" style="color: var(--accent)">moved</span>
            <span v-if="draft.line.value.adlib" class="chip stale" title="Heard by the transcription, but not in lyrics.txt - a repeat the song has, or something heard that nobody sings. Not sung until taken">ad-lib</span>
            <span v-else-if="draft.line.value.off" class="chip bad" title="Left out: heard, but not sung - no clip sings it">left out</span>
            <span v-if="draft.line.value.problem" class="chip bad" :title="`Against lyrics.txt: ${draft.line.value.problem}`">{{ draft.line.value.problem }}</span>
            <span v-if="lead >= EARLY_FROM" class="chip stale" title="The first word starts before the singing does: its box covers silence. Tighten the start, or drag it.">starts {{ lead.toFixed(1) }} s early</span>
            <span v-if="outdated.has(draft.line.value.line)" class="chip stale" :title="`The prompt of ${outdated.get(draft.line.value.line)!.join(', ')} still has this line at its old times: plan again`">prompt old</span>
          </template>
          <div class="spacer" />
          <button v-if="draft.line.value" class="btn" @click="editor?.playLine(draft.line.value)">Listen</button>
          <button v-if="draft.line.value && lead >= EARLY_FROM" class="btn" title="Move the start of the first word to where the singing begins" @click="draft.tighten(new Map([[draft.line.value.line, lead]]))">Tighten the start</button>
          <button class="btn" @click="nextKind('unchecked')">Next unchecked</button>
          <button class="btn" @click="nextKind('cut')">Next cut</button>
          <button v-if="problems.length" class="btn" :title="`${problems.length} lines want a look: cuts in words, early starts, old prompts, guessed times. Key N, Shift+N back`" @click="nextProblem()">Next problem ({{ problems.length }})</button>
          <button v-if="draft.line.value" class="btn" :disabled="draft.edits.value.size > 0" :title="draft.edits.value.size ? 'Save the moved lines first' : draft.line.value.off ? 'The line is sung again: the clips it falls into sing it' : 'Heard, but not sung (a misheard ad-lib, a line on top of another): no clip sings it. It stays here, to be sung again'" @click="setOff(draft.line.value, !draft.line.value.off)">{{ draft.line.value.off ? (draft.line.value.adlib ? 'Sing it' : 'Sing it again') : 'Leave the line out' }}</button>
          <button v-if="draft.line.value?.byHand" class="btn" :disabled="draft.edits.value.size > 0" :title="draft.edits.value.size ? 'Save the moved lines first' : 'Where the alignment puts it, worked out again from the transcript - your placement goes'" @click="reset([draft.line.value])">Back to automatic</button>
          <button v-if="byHand.length > 1" class="btn" :disabled="draft.edits.value.size > 0" :title="`All ${byHand.length} lines placed by hand back to the automatic timing`" @click="reset(byHand)">All back to automatic</button>
          <button v-if="draft.line.value && draft.isChanged(draft.line.value)" class="btn" title="Back to the saved times" @click="draft.resetLine(draft.line.value)">Reset line</button>
          <button class="btn" :disabled="!draft.history.length" title="Ctrl+Z" @click="draft.undo()">Undo</button>
          <button class="btn" :disabled="!draft.future.length" title="Ctrl+Shift+Z" @click="draft.redo()">Redo</button>
          <button class="btn" title="Ctrl+wheel, + / -" @click="draft.zoom(0.8)">+</button>
          <button class="btn" title="Ctrl+wheel, + / -" @click="draft.zoom(1.25)">−</button>
        </div>
        <TimingEditor ref="editor" :view="view" :draft="draft" :peaks="peaks" :head="player.time.value" :playing="!!player.playing.value" @play="play" @stop="player.stop()" @next="nextProblem" />
        <TimingTools ref="timingTools" :draft="draft" :view="view" :player="player" />
        <div>
          <div v-if="draft.line.value && draft.crossing(draft.line.value).length" class="warn">A clip cut falls into {{ draft.crossing(draft.line.value).map(c => `"${c.word.text}"`).join(', ') }}: the word is then sung half in one clip, half in the next. Split the word at the cut to preserve its complete audible span, or adjust its timing after listening.</div>
          <div v-if="draft.overlaps.value.length" class="warn">This line overlaps {{ draft.overlaps.value.map(l => `"${l.text}"`).join(' and ') }}. Fine for two singers at once - otherwise move one of them.</div>
        </div>
      </div>
      <TimingLineList :view="view" :draft="draft" :filter="filter" :leads="leads" :outdated="outdated" @choose="choose" />
    </div>
    <aside class="detail"><TimingSide :view="view" :draft="draft" :saved="saved" :early="earlyLines.size" @save="save" @cut-again="cutAgain" @library="putIntoLibrary" @tighten="tightenAll" @plan="toasts.guard(planNow)()" /></aside>
  </div>
</template>
