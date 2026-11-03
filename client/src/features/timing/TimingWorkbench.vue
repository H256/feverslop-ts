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

const FILTERS = computed(() => [{value: 'all', label: 'All lines'}, {value: 'estimated', label: `Estimated (${props.view.lines.filter(l => l.estimated).length})`}, {value: 'changed', label: 'Moved'}] as const)
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
          </template>
          <div class="spacer" />
          <button v-if="draft.line.value" class="btn" @click="editor?.playLine(draft.line.value)">Listen</button>
          <button v-if="draft.line.value && draft.isChanged(draft.line.value)" class="btn" title="Back to the saved times" @click="draft.resetLine(draft.line.value)">Reset line</button>
          <button class="btn" :disabled="!draft.history.length" title="Ctrl+Z" @click="draft.undo()">Undo</button>
          <button class="btn" title="Ctrl+wheel, + / -" @click="draft.zoom(0.8)">+</button>
          <button class="btn" title="Ctrl+wheel, + / -" @click="draft.zoom(1.25)">−</button>
        </div>
        <TimingEditor ref="editor" :view="view" :draft="draft" :peaks="peaks" :head="player.time.value" :playing="!!player.playing.value" @play="play" @stop="player.stop()" />
        <div>
          <div v-if="draft.line.value && draft.crossing(draft.line.value).length" class="warn">A clip cut falls into {{ draft.crossing(draft.line.value).map(c => `"${c.word.text}"`).join(', ') }}: the word is then sung half in one clip, half in the next. Move it, or cut the song again on the right.</div>
          <div v-if="draft.overlaps.value.length" class="warn">This line overlaps {{ draft.overlaps.value.map(l => `"${l.text}"`).join(' and ') }}. Fine for two singers at once - otherwise move one of them.</div>
        </div>
      </div>
      <TimingLineList :view="view" :draft="draft" :filter="filter" @choose="choose" />
    </div>
    <aside class="detail"><TimingSide :view="view" :draft="draft" :saved="saved" @save="save" @cut-again="cutAgain" @plan="toasts.guard(planNow)()" /></aside>
  </div>
</template>
