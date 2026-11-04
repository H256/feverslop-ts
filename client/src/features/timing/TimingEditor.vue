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
const {theme} = ChromeService.use()

const observer = new ResizeObserver(([entry]) => { width.value = entry?.contentRect.width ?? 0 })
onMounted(() => {
  if (editor.value) observer.observe(editor.value)
  editor.value?.focus({preventScroll: true})
})
onScopeDispose(() => observer.disconnect())

const span = computed(() => props.draft.window.value)
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
const own = (line: TimingLine) => line.line === props.draft.selected.value
const crossed = (line: TimingLine, n: number) => {
  const w = props.draft.wordsOf(line)[n]!
  return own(line) && cutsIn(props.view, w.start + 0.02, w.end - 0.02).length > 0
}
const headShown = computed(() => props.head !== undefined && props.head >= span.value.from && props.head <= span.value.to)

const follow = usePointerDrag()
/** Dragging in seconds: one undo step per drag, on the window - the boxes are drawn anew while dragging. */
function drag(event: PointerEvent, move: (by: number) => void, pick?: () => void) {
  if (event.button !== 0) return
  event.stopPropagation()
  event.preventDefault()
  pick?.()
  props.draft.remember()
  let last = event.clientX
  const pps = width.value / (span.value.to - span.value.from)
  follow(e => {
    const by = (e.clientX - last) / pps
    if (!by) return
    last = e.clientX
    move(by)
  }, () => props.draft.settle())
}
const dragLine = (event: PointerEvent, line: TimingLine) => drag(event, by => props.draft.moveLine(line, by))
const dragWord = (event: PointerEvent, line: TimingLine, n: number, edge?: 'start' | 'end') => drag(event, by => props.draft.moveWord(line, n, by, edge), () => { props.draft.word.value = n })
const playWord = (line: TimingLine, n: number) => { const w = props.draft.wordsOf(line)[n]!; emit('play', w.start - 0.05, w.end + 0.1) }
const playLine = (line: TimingLine) => emit('play', props.draft.startOf(line) - 0.3, props.draft.endOf(line) + 0.4)
const wheel = (event: WheelEvent) => {
  if (!event.ctrlKey) return
  event.preventDefault()
  props.draft.zoom(event.deltaY > 0 ? 1.25 : 0.8)
}

function key(event: KeyboardEvent) {
  const draft = props.draft
  if (event.ctrlKey && event.key === 'z') { event.preventDefault(); return draft.undo() }
  if (event.ctrlKey || event.metaKey || event.altKey) return
  const line = draft.line.value
  if (!line) return
  const at = props.view.lines.indexOf(line)
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    const by = (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 0.5 : 0.05)
    draft.remember()
    draft.word.value === undefined ? draft.moveLine(line, by) : draft.moveWord(line, draft.word.value, by)
  }
  else if (event.key === 'Tab') draft.nextWord(event.shiftKey)
  else if (event.key === 'n' || event.key === 'N') emit('next', event.key === 'N')
  else if (event.key === 'Escape') draft.word.value = undefined
  else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { const next = props.view.lines[at + (event.key === 'ArrowDown' ? 1 : -1)]; if (next) draft.choose(next.line) }
  else if (event.key === ' ') props.playing ? emit('stop') : draft.word.value !== undefined ? playWord(line, draft.word.value) : playLine(line)
  else if (event.key === '+' || event.key === '-') draft.zoom(event.key === '+' ? 0.8 : 1.25)
  else return
  event.preventDefault()
}
const playFrom = (event: MouseEvent) => { const t = tOf(event.offsetX); emit('play', t, t + 3) }
defineExpose({focus: () => editor.value?.focus({preventScroll: true}), playLine})
</script>

<template>
  <div ref="editor" class="tedit" tabindex="0" @keydown="key" @wheel="wheel">
    <canvas ref="canvas" class="twave" @click="playFrom" />
    <div class="tlayer">
      <div v-for="cut in cuts" :key="cut.id" class="tcut" :style="{left: `${xOf(cut.start)}px`}" :title="`Clip ${cut.id} starts here${cut.beat ? ` (${cut.beat})` : ''}`"><span>{{ cut.id.replace(/^\D+/, '') }}</span></div>
      <template v-for="line in seen" :key="line.line">
        <div v-if="own(line)" :class="['tline', {changed: draft.isChanged(line)}]" :style="box(draft.startOf(line), draft.endOf(line), 4)" title="Drag: move the whole line · ← → with the line chosen" @pointerdown="dragLine($event, line)">{{ line.text }}</div>
        <template v-for="(w, n) in draft.wordsOf(line)" :key="n">
          <div v-if="own(line)" :class="['tword', {chosen: draft.word.value === n, crossed: crossed(line, n)}]" :style="box(w.start, w.end, 3)"
            :title="`${w.text} · ${clock(w.start)}–${clock(w.end)}${crossed(line, n) ? ' · a clip cut falls into this word' : ''}`"
            @pointerdown="dragWord($event, line, n)" @dblclick="playWord(line, n)">
            <span>{{ w.text }}</span>
            <i class="grip l" @pointerdown="dragWord($event, line, n, 'start')" />
            <i class="grip r" @pointerdown="dragWord($event, line, n, 'end')" />
          </div>
          <div v-else class="tword other" :style="box(w.start, w.end, 3)" :title="`${w.text} · ${clock(w.start)}–${clock(w.end)}`" @click="draft.choose(line.line)"><span>{{ w.text }}</span></div>
        </template>
      </template>
    </div>
    <div v-show="headShown" class="thead" :style="{left: `${xOf(head ?? 0)}px`}" />
  </div>
</template>
