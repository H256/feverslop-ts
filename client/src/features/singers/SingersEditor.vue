<script setup lang="ts">
import {computed, nextTick, onMounted, ref, toRef, watch} from 'vue'
import {useRoute} from 'vue-router'
import type {SingingLine, SingingView} from '../../../../shared/workspace'
import {mediaUrl} from '../../api/urls'
import PageBar from '../../components/PageBar.vue'
import SegmentedControl from '../../components/SegmentedControl.vue'
import {usePending} from '../../composables/usePending'
import {useSnippetPlayer} from '../../composables/useSnippetPlayer'
import {useUnsavedChanges} from '../../composables/useUnsavedChanges'
import {clock} from '../../lib/format'
import {useToasts} from '../../services/toasts'
import {usePlanning} from '../plan/usePlanning'
import {useProject} from '../project/session'
import {sectionsOf, singersOf} from './parts'
import SingerChip from './SingerChip.vue'
import SingersSide from './SingersSide.vue'
import SungLine from './SungLine.vue'
import {useSingingDraft} from './useSingingDraft'

/** The lines of the song with who sings them, changed here; saved, the page reads them again. */
const props = defineProps<{view: SingingView, refresh: () => Promise<boolean>}>()
const {api, roots, start} = useProject()
const toasts = useToasts()
const {planNow} = usePlanning()
const draft = useSingingDraft(toRef(props, 'view'))
const saved = ref<string>()
useUnsavedChanges(() => draft.changes.value.lines.length > 0, 'changes of who sings')
// a new reading of the lines (a run ended, the page saved) is taken over while nothing is changed here
watch(() => props.view, () => { if (!draft.changes.value.lines.length) draft.reset() })

// listening to a line or a part of it: the vocals stem tells a man's voice from a woman's, which is what a wrong pick usually is
const player = useSnippetPlayer(() => props.view.audio && mediaUrl(props.view.audio, roots), toasts.fail)
const listen = (key: string, start?: number, end?: number) => { if (start !== undefined) player.toggle(key, start - 0.15, (end ?? start + 4) + 0.25) }

type Filter = 'all' | 'changed' | 'together'
const FILTERS = [{value: 'all', label: 'All lines'}, {value: 'changed', label: 'Changed'}, {value: 'together', label: 'Several singers'}] as const
const filter = ref<Filter>('all')
const shown = (line: SingingLine) => filter.value === 'all' || (filter.value === 'changed' ? draft.isChanged(line) : singersOf(draft.partsOf(line)).size > 1)
const sections = computed(() => sectionsOf(props.view.lines).map(section => ({...section, lines: section.lines.filter(shown)})).filter(section => section.lines.length))
const allOf = (lines: SingingLine[], id: string) => {
  const has = lines.filter(l => draft.partsOf(l).every(p => p.singers.has(id))).length
  return has === lines.length ? true : lines.some(l => singersOf(draft.partsOf(l)).has(id)) ? 'mixed' : false
}

const list = ref<HTMLElement>()
/** ↑ ↓ from a line: the one before or after, as shown. */
const move = (from: SingingLine, by: number) => {
  const rows = [...list.value?.querySelectorAll<HTMLElement>('.sung') ?? []]
  rows[rows.findIndex(row => row.dataset.line === String(from.line)) + by]?.focus()
}

// while saving the page is not to be changed: the draft is reset to what was saved - only once that has been read again
const saving = usePending()
const save = toasts.guard((plan: boolean) => saving.during(async () => {
  const result = await api.saveSinging(draft.request())
  if (!await props.refresh()) {
    saved.value = 'Saved - but the page could not read it again: what you see is what was sent.'
    return
  }
  draft.reset()
  saved.value = result.replanned.length ? `Saved. ${result.replanned.join(', ')} ${plan ? 'are planned now' : 'are planned with the next plan run'}.` : 'Saved.'
  if (plan && props.view.unplanned.length) await start({type: 'plan'})
}))
// a new change makes the note of the last save old
watch(() => draft.changes.value.lines.length, count => { if (count) saved.value = undefined })

// a link to a line (the inspector's "Change singers"): it is shown and focused
const route = useRoute()
onMounted(() => {
  const wanted = /^#line-(\d+)$/.exec(route.hash)
  void nextTick(() => {
    const row = wanted && document.getElementById(`line-${wanted[1]}`)
    if (!row) return
    row.scrollIntoView({block: 'center'})
    row.focus({preventScroll: true})
    row.classList.add('flash')
  })
})
</script>

<template>
  <div class="split view" :inert="saving.pending.value" :aria-busy="saving.pending.value">
    <div ref="list" class="scrollpage">
      <PageBar title="Who sings which line">
        <SegmentedControl v-model="filter" :options="FILTERS" label="Lines shown" />
        <span class="muted" style="font-size: 12px"><kbd>1</kbd>–<kbd>{{ Math.min(9, draft.pool.value.length) }}</kbd> a singer · <kbd>←</kbd><kbd>→</kbd> part · <kbd>↑</kbd><kbd>↓</kbd> line · <kbd>Space</kbd> listen · click between two words: the singer changes there</span>
      </PageBar>
      <div v-for="section in sections" :key="`${section.name}:${section.lines[0]!.line}`" class="sung-section">
        <div class="sung-head">
          <h3>{{ section.name || 'Lines' }}</h3>
          <span class="muted num">{{ section.lines[0]!.start !== undefined ? clock(section.lines[0]!.start, false) : '' }}</span>
          <span v-if="draft.pool.value.length > 1" class="all">All of these:
            <SingerChip v-for="(id, n) in draft.pool.value" :key="id" :name="draft.nameOf(id)" :number="n + 1" :hue="draft.hueOf(id)" :pressed="allOf(section.lines, id)" :title="`${draft.nameOf(id)} sings every line of this part - or none`" @toggle="draft.toggleAll(section.lines, id)" />
          </span>
        </div>
        <SungLine v-for="line in section.lines" :key="line.line" :line="line" :draft="draft" :playing="player.playing.value" :can-listen="player.available()" @listen="listen" @move="by => move(line, by)" />
      </div>
      <div v-if="filter !== 'all' && !sections.length" class="empty">{{ filter === 'changed' ? 'Nothing changed yet.' : 'No line is sung by more than one.' }}</div>
    </div>
    <aside class="detail"><SingersSide :view="view" :draft="draft" :saved="saved" @save="save" @plan="toasts.guard(planNow)()" /></aside>
  </div>
</template>
