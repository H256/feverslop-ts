<script setup lang="ts">
import {computed, onMounted, onScopeDispose, ref, watchEffect} from 'vue'
import type {TimingLine, TimingView} from '../../../../shared/workspace'
import {usePointerDrag} from '../../composables/usePointerDrag'
import {cssColor, cssVar, prepareCanvas} from '../../lib/canvas'
import {clock} from '../../lib/format'
import {ChromeService} from '../../services/chrome'
import type {TimingDraft} from './useTimingDraft'
import {cutsIn} from './words'

/**
 * The waveform of the vocals around the chosen line, its words to drag, the lines next to it faded, the cuts of the clips. Drag: a
 * word, its edges, or the bar above the words (the whole line). Keys on it: see the help on the side.
 */
const props = defineProps<{view: TimingView, draft: TimingDraft, peaks?: number[], head?: number, playing: boolean}>()
const emit = defineEmits<{play: [from: number, to: number], stop: [], next: [back: boolean]}>()
const WAVE_RATE = 100
const WAVE_HEIGHT = 120
const editor = ref<HTMLElement>()
const canvas = ref<HTMLCanvasElement>()
const width = ref(0)
const frozen = ref<{from: number, to: number}>()
const snap = ref(true)
const snapped = ref<number>()
const error = ref('')
const {theme} = ChromeService.use()

const observer = new ResizeObserver(([entry]) => { width.value = entry?.contentRect.width ?? 0 })
onMounted(() => {
  if (editor.value) observer.observe(editor.value)
  editor.value?.focus({preventScroll: true})
})
onScopeDispose(() => observer.disconnect())

const span = computed(() => frozen.value ?? props.draft.window.value)
const xOf = (t: number) => (t - span.value.from) / (span.value.to - span.value.from) * width.value
const tOf = (x: number) => span.value.from + x / Math.max(1, width.value) * (span.value.to - span.value.from)
const box = (from: number, to: number, least: number) => ({left: `${xOf(from)}px`, width: `${Math.max(least, xOf(to) - xOf(from))}px`})

watchEffect(() => {
  void theme.value
  const node = canvas.value
  if (!node || !width.value) return
  const {from, to} = span.value
  const g = prepareCanvas(node, width.value, WAVE_HEIGHT)
  const muted = cssColor(node, '--muted')
  g.fillStyle = muted
  if (props.peaks) {
    g.globalAlpha = .55
    for (let x = 0; x < width.value; x++) {
      const a = Math.floor((from + x / width.value * (to - from)) * WAVE_RATE)
      const b = Math.max(a + 1, Math.floor((from + (x + 1) / width.value * (to - from)) * WAVE_RATE))
      let level = 0
      for (let i = a; i < b && i < props.peaks.length; i++) level = Math.max(level, props.peaks[i]!)
      const h = Math.max(1, level * (WAVE_HEIGHT - 8))
      g.fillRect(x, (WAVE_HEIGHT - h) / 2, 1, h)
    }
    g.globalAlpha = 1
  }
  // a second ruler: whole seconds
  g.font = `10px ${cssVar('--sans')}`
  for (let s = Math.ceil(from); s <= to; s++) {
    const x = (s - from) / (to - from) * width.value
    g.fillRect(x, WAVE_HEIGHT - 5, 1, 5)
    g.fillText(clock(s, false), x + 3, WAVE_HEIGHT - 1)
  }
})

const cuts = computed(() => cutsIn(props.view, span.value.from, span.value.to))
const seen = computed(() => props.view.lines.filter(line => {
  const words = props.draft.wordsOf(line)
  return words.length && words.at(-1)!.end >= span.value.from && words[0]!.start <= span.value.to
}))
const own = (line: TimingLine) => line.line === props.draft.selected.value || props.draft.selection.value.some(s => s.line.line === line.line)
const blocks = (line: TimingLine) => {
  const ws = props.draft.wordsOf(line)
  const result: {first: number, last: number, text: string, start: number, end: number, anchor?: boolean, estimated?: boolean, group?: string}[] = []
  for (let n = 0; n < ws.length; n++) {
    const w = ws[n]!
    let last = n
    if (w.group && props.draft.collapsed.value.has(w.group)) while (ws[last + 1]?.group === w.group) last++
    result.push({...w, first: n, last, text: ws.slice(n, last + 1).map((part, i) => `${i && !part.joined ? ' ' : ''}${part.text}`).join(''), end: ws[last]!.end})
    n = last
  }
  return result
}
const crossed = (line: TimingLine, n: number) => {
  const w = props.draft.wordsOf(line)[n]!
  return own(line) && cutsIn(props.view, w.start + 0.02, w.end - 0.02).length > 0
}
const headShown = computed(() => props.head !== undefined && props.head >= span.value.from && props.head <= span.value.to)

const follow = usePointerDrag()
/** Dragging in seconds: one undo step per drag, on the window - the boxes are drawn anew while dragging. */
function drag(event: PointerEvent, move: (by: number, event: PointerEvent) => void, pick?: () => void) {
  if (event.button !== 0) return
  event.stopPropagation()
  event.preventDefault()
  frozen.value = {...span.value}
  pick?.()
  editor.value?.focus({preventScroll: true})
  props.draft.remember()
  let last = event.clientX
  const pps = width.value / (span.value.to - span.value.from)
  follow(e => {
    const by = (e.clientX - last) / pps
    if (!by) return
    last = e.clientX
    try { move(by, e); error.value = '' } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  }, () => { props.draft.settle(); frozen.value = undefined; snapped.value = undefined })
}
const snapTime = (time: number, event: PointerEvent, exclude: number[] = []) => {
  snapped.value = undefined
  if (!snap.value || event.altKey) return time
  const threshold = (span.value.to - span.value.from) / Math.max(1, width.value) * 7
  const candidates = [...props.view.cuts.flatMap(c => [c.start, c.end]), ...props.view.lines.flatMap(l => props.draft.wordsOf(l).flatMap(w => [w.start, w.end]))].filter(t => !exclude.some(x => Math.abs(t - x) < .0001))
  const nearest = candidates.sort((a, b) => Math.abs(a - time) - Math.abs(b - time))[0]
  if (nearest !== undefined && Math.abs(nearest - time) < threshold) { snapped.value = nearest; return nearest }
  return time
}
const dragLine = (event: PointerEvent, line: TimingLine) => drag(event, by => props.draft.moveSelection(by), () => {
  if (event.shiftKey || props.draft.selection.value.length === 1 || !props.draft.selection.value.some(s => s.line.line === line.line)) props.draft.choose(line.line, event.shiftKey)
})
const dragWord = (event: PointerEvent, line: TimingLine, n: number, edge?: 'start' | 'end', last = n) => {
  if (event.shiftKey && !edge) { event.stopPropagation(); props.draft.pickWord(line, n, true); editor.value?.focus(); return }
  let initial = 0
  const pps = width.value / (span.value.to - span.value.from)
  drag(event, (_by, e) => {
    const by = (e.clientX - event.clientX) / pps
    const w = props.draft.wordsOf(line)[n]!
    if (edge && event.shiftKey) {
      const index = edge === 'start' ? n - 1 : n
      if (index >= 0) props.draft.boundary(line, index, snapTime(initial + by, e, [w[edge]]))
    } else if (edge) props.draft.moveWord(line, n, snapTime(initial + by, e, [w[edge]]) - w[edge], edge)
    else {
      const selected = props.draft.selectedWords.value
      props.draft.moveSelection(snapTime(initial + by, e, selected.flatMap(x => [x.start, x.end])) - selected[0]!.start)
    }
  }, () => {
    if (edge || props.draft.word.value === undefined || !props.draft.contains(line, n)) props.draft.pickWord(line, n)
    if (!edge && last > n) { props.draft.pickWord(line, n); props.draft.pickWord(line, last, true) }
    initial = edge ? props.draft.wordsOf(line)[n]![edge] : props.draft.selectedWords.value[0]!.start
  })
}
const selectRange = (event: PointerEvent) => {
  if (!event.shiftKey) return
  event.preventDefault()
  const left = canvas.value!.getBoundingClientRect().left
  const start = tOf(event.clientX - left)
  frozen.value = {...span.value}
  follow(e => {
    const end = tOf(e.clientX - left)
    const selected = props.view.lines.flatMap(l => props.draft.wordsOf(l).flatMap((w, n) => w.end >= Math.min(start, end) && w.start <= Math.max(start, end) ? [{l, n}] : []))
    if (selected.length) { props.draft.pickWord(selected[0]!.l, selected[0]!.n); props.draft.pickWord(selected.at(-1)!.l, selected.at(-1)!.n, true) }
  }, () => { frozen.value = undefined; editor.value?.focus() })
}
const selectedSpan = computed(() => {
  const words = props.draft.selectedWords.value
  return words.length ? {from: Math.min(...words.map(w => w.start)), to: Math.max(...words.map(w => w.end))} : undefined
})
const fitEdge = (event: PointerEvent, end: boolean) => {
  const original = selectedSpan.value
  if (!original) return
  const pps = width.value / (span.value.to - span.value.from)
  drag(event, (_by, e) => {
    const target = snapTime((end ? original.to : original.from) + (e.clientX - event.clientX) / pps, e, [selectedSpan.value!.from, selectedSpan.value!.to])
    props.draft.fitLive(end ? original.from : target, end ? target : original.to)
  })
}
const playWord = (line: TimingLine, n: number) => { const w = props.draft.wordsOf(line)[n]!; emit('play', w.start - 0.05, w.end + 0.1) }
const playLine = (line: TimingLine) => emit('play', props.draft.startOf(line) - 0.3, props.draft.endOf(line) + 0.4)
const wheel = (event: WheelEvent) => {
  if (!event.ctrlKey) return
  event.preventDefault()
  props.draft.zoom(event.deltaY > 0 ? 1.25 : 0.8)
}

function key(event: KeyboardEvent) {
  const draft = props.draft
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); return event.shiftKey ? draft.redo() : draft.undo() }
  if (event.ctrlKey && event.key === 'y') { event.preventDefault(); return draft.redo() }
  if (event.ctrlKey || event.metaKey || event.altKey) return
  const line = draft.line.value
  if (!line) return
  const at = props.view.lines.indexOf(line)
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    const by = (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 0.5 : 0.05)
    draft.remember()
    draft.moveSelection(by)
    draft.settle()
  }
  else if (event.key === 'Tab') draft.nextWord(event.shiftKey)
  else if (event.key === 'n' || event.key === 'N') emit('next', event.key === 'N')
  else if (event.key === 'Escape') draft.choose(line.line)
  else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { const next = props.view.lines[at + (event.key === 'ArrowDown' ? 1 : -1)]; if (next) draft.choose(next.line) }
  else if (event.key === ' ') props.playing ? emit('stop') : draft.word.value !== undefined ? playWord(line, draft.word.value) : playLine(line)
  else if (event.key === '+' || event.key === '-') draft.zoom(event.key === '+' ? 0.8 : 1.25)
  else return
  event.preventDefault()
}
const playFrom = (event: MouseEvent) => { if (event.shiftKey) return; const t = tOf(event.offsetX); emit('play', t, t + 3) }
defineExpose({focus: () => editor.value?.focus({preventScroll: true}), playLine})
</script>

<template>
  <div class="btn-row"><label><input v-model="snap" type="checkbox" /> Snap <span class="muted">(Alt bypasses)</span></label><span class="muted">Shift-click selects words; Shift-drag the lower waveform selects a range.</span><span v-if="error" role="alert">{{ error }}</span></div>
  <div ref="editor" class="tedit" tabindex="0" @keydown="key" @wheel="wheel">
    <canvas ref="canvas" class="twave" @click="playFrom" @pointerdown="selectRange" />
    <div class="tlayer">
      <div v-for="cut in cuts" :key="cut.id" class="tcut" :style="{left: `${xOf(cut.start)}px`}" :title="`Clip ${cut.id} starts here${cut.beat ? ` (${cut.beat})` : ''}`"><span>{{ cut.id.replace(/^\D+/, '') }}</span></div>
      <template v-for="line in seen" :key="line.line">
        <div v-if="own(line)" :class="['tline', {changed: draft.isChanged(line)}]" :style="box(draft.startOf(line), draft.endOf(line), 4)" title="Drag: move the whole line · ← → with the line chosen" @pointerdown="dragLine($event, line)">{{ line.text }}</div>
        <template v-for="w in blocks(line)" :key="w.first">
          <div v-if="own(line)" :class="['tword', {chosen: draft.contains(line, w.first), crossed: crossed(line, w.first), off: line.off, anchored: w.anchor, grouped: w.group}]" :style="box(w.start, w.end, 3)"
            :title="`${w.text} · ${clock(w.start)}–${clock(w.end)}${crossed(line, w.first) ? ' · a clip cut falls into this word' : ''}`"
            @pointerdown="dragWord($event, line, w.first, undefined, w.last)" @dblclick="emit('play', w.start - .05, w.end + .1)">
            <span>{{ w.anchor ? '◆ ' : '' }}{{ w.text }}{{ w.last > w.first ? ' ▸' : '' }}</span>
            <i v-if="w.first === w.last" class="grip l" @pointerdown="dragWord($event, line, w.first, 'start')" />
            <i v-if="w.first === w.last" class="grip r" @pointerdown="dragWord($event, line, w.first, 'end')" />
          </div>
          <div v-else :class="['tword', 'other', {off: line.off}]" :style="box(w.start, w.end, 3)" :title="`${w.text} · ${clock(w.start)}–${clock(w.end)}`" @click="draft.pickWord(line, w.first, $event.shiftKey)"><span>{{ w.text }}</span></div>
        </template>
      </template>
      <div v-if="selectedSpan && draft.selectedWords.value.length > 1" class="tselection" :style="box(selectedSpan.from, selectedSpan.to, 8)" title="Drag selection; drag its edges to fit its duration" @pointerdown="drag($event, by => draft.moveSelection(by))">
        <i class="grip l" @pointerdown="fitEdge($event, false)" />
        Selection · {{ draft.selectedWords.value.length }} words
        <i class="grip r" @pointerdown="fitEdge($event, true)" />
      </div>
    </div>
    <div v-show="headShown" class="thead" :style="{left: `${xOf(head ?? 0)}px`}" />
    <div v-if="snapped !== undefined" class="thead" :style="{left: `${xOf(snapped)}px`, background: 'var(--accent)'}" />
  </div>
</template>
