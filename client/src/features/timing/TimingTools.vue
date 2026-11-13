<script setup lang="ts">
import DisclosureBox from '../../components/DisclosureBox.vue'
import CalloutBox from '../../components/CalloutBox.vue'
import {computed, ref, watch} from 'vue'
import type {TimingView, TimingWord} from '../../../../shared/workspace'
import type {useSnippetPlayer} from '../../composables/useSnippetPlayer'
import type {TimingDraft} from './useTimingDraft'
import {clipText, clipWords} from './edit'
const props = defineProps<{draft: TimingDraft; view: TimingView; player: ReturnType<typeof useSnippetPlayer>}>()
const error = ref(''),
  from = ref(0),
  to = ref(0),
  character = ref(1),
  splitAt = ref(0),
  boundaryAt = ref(0)
const preview = ref<TimingWord[]>()
const listening = ref(false),
  marks = ref<number[]>([]),
  offset = ref(0)
const selected = computed(() => props.draft.selectedWords.value)
const group = computed(() => selected.value[0]?.group)
const unplaced = computed(() => props.draft.selection.value.some(s => s.line.unplaced && !props.draft.isChanged(s.line)))
const joinable = computed(() => props.draft.selection.value.length === 1 && selected.value.length > 1 && selected.value.slice(1).every(w => w.joined))
const run = (action: () => void) => {
  error.value = ''
  try {
    action()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}
watch(
  selected,
  words => {
    from.value = words[0]?.start ?? 0
    to.value = words.at(-1)?.end ?? 0
    character.value = Math.max(1, Math.floor((words[0]?.text.length ?? 2) / 2))
    splitAt.value = props.view.cuts.find(c => c.start > from.value && c.start < to.value)?.start ?? (from.value + to.value) / 2
    boundaryAt.value = words[0]?.end ?? 0
    preview.value = undefined
    if (listening.value) {
      listening.value = false
      marks.value = []
      props.player.stop()
    }
  },
  {immediate: true},
)
const startListening = (cursor = false) => {
  const start = cursor ? (props.player.position() ?? from.value) : from.value
  marks.value = []
  listening.value = true
  props.player.play('marking', Math.max(0, start - 0.5), props.view.duration)
}
watch([from, to], () => {
  preview.value = undefined
})
const captureEndpoint = (end: boolean) => {
  const t = props.player.position()
  if (t !== undefined) {
    if (end) to.value = t
    else from.value = t
  }
}
const tap = (final = false) =>
  run(() => {
    if (!listening.value || !props.player.playing.value) throw new Error('Start or resume listening before marking.')
    if (final !== (marks.value.length === selected.value.length)) throw new Error(final ? 'Mark every onset first.' : 'Use Final end after the last onset.')
    const t = props.player.position()
    if (t === undefined) return
    const mark = t
    if (mark < 0 || (marks.value.length && mark <= marks.value.at(-1)! + 0.05)) throw new Error('Marks must be increasing and at least 0.05 seconds apart.')
    marks.value.push(mark)
  })
const key = (e: KeyboardEvent) => {
  if (/INPUT|SELECT|TEXTAREA/.test((e.target as HTMLElement).tagName)) return
  if (!listening.value) {
    if (e.key.toLowerCase() === 'i' || e.key.toLowerCase() === 'o') {
      e.preventDefault()
      e.stopPropagation()
      captureEndpoint(e.key.toLowerCase() === 'o')
    }
    return
  }
  if (e.repeat) return
  if (e.key.toLowerCase() === 'm') {
    e.preventDefault()
    e.stopPropagation()
    tap(marks.value.length === selected.value.length)
  } else if (e.key === 'Backspace') {
    e.preventDefault()
    e.stopPropagation()
    marks.value.pop()
  } else if (e.key === ' ') {
    e.preventDefault()
    e.stopPropagation()
    props.player.paused.value ? props.player.resume() : props.player.pause()
  }
}
defineExpose({key})
const collapse = () => {
  if (!group.value) return
  const set = new Set(props.draft.collapsed.value)
  set.has(group.value) ? set.delete(group.value) : set.add(group.value)
  props.draft.collapsed.value = set
}
const clips = computed(() =>
  props.view.cuts
    .filter(c => selected.value.some(w => w.end > c.start && w.start < c.end))
    .map(c => {
      const lines = props.view.lines.filter(l => !l.off)
      const words = lines.flatMap(l => clipWords(props.draft.wordsOf(l), c.start, c.end))
      return {
        ...c,
        before: lines
          .map(l => clipText(l.words, c.start, c.end))
          .filter(Boolean)
          .join(' '),
        text: lines
          .map(l => clipText(props.draft.wordsOf(l), c.start, c.end))
          .filter(Boolean)
          .join(' '),
        from: words.length ? Math.max(c.start, Math.min(...words.map(w => w.start)) - 0.2) : undefined,
        to: words.length ? Math.min(c.end, Math.max(...words.map(w => w.end)) + 0.2) : undefined,
      }
    }),
)
</script>

<template>
  <section class="timing-tools" aria-label="Selection tools" @keydown="key">
    <div class="btn-row">
      <b>{{ selected.length }} word{{ selected.length === 1 ? '' : 's' }} selected</b>
      <span class="muted">Shift-click words or lines to select a range.</span>
      <button class="btn" :disabled="unplaced" @click="run(() => draft.patchSelection({anchor: !selected.every(w => w.anchor)}))">
        {{ selected.every(w => w.anchor) ? 'Release anchors' : 'Anchor onsets' }}
      </button>
      <button class="btn" @click="run(() => draft.patchSelection({estimated: false}))">Mark reviewed</button>
      <button class="btn" @click="run(() => draft.patchSelection({estimated: true}))">Mark unchecked</button>
      <button class="btn" :disabled="unplaced || selected.length < 2" @click="run(draft.groupSelection)">Group selection</button>
      <button v-if="group" class="btn" @click="collapse">{{ draft.collapsed.value.has(group) ? 'Expand group' : 'Collapse group' }}</button>
      <button v-if="group" class="btn" @click="run(() => draft.patchSelection({group: undefined}))">Ungroup</button>
      <button class="btn" :disabled="!joinable" @click="run(draft.join)">Join parts</button>
    </div>
    <DisclosureBox title="Fit, split and shared boundary">
      <div class="btn-row">
        <label>Fit start <input v-model.number="from" aria-label="Fit start" type="number" step="0.01" /></label>
        <label>Fit end <input v-model.number="to" aria-label="Fit end" type="number" step="0.01" /></label>
        <button class="btn" :disabled="!player.available()" @click="player.play('fit', Math.max(0, from - 0.5), Math.min(view.duration, to + 2))">
          Listen to fit
        </button>
        <button class="btn" :disabled="player.time.value === undefined" @click="captureEndpoint(false)">Set start (I)</button>
        <button class="btn" :disabled="player.time.value === undefined" @click="captureEndpoint(true)">Set end (O)</button>
        <button
          class="btn"
          @click="
            run(() => {
              preview = draft.previewFit(from, to)
            })
          "
        >
          Preview fit
        </button>
        <button class="btn" :disabled="!preview" @click="run(() => draft.fit(from, to))">Apply fit</button>
      </div>
      <p v-if="preview" role="status">
        Preview (anchors stay fixed): {{ preview.map(w => `${w.text} ${w.start.toFixed(2)}–${w.end.toFixed(2)}`).join(' · ') }}
      </p>
      <div class="btn-row">
        <label>Split after character <input v-model.number="character" aria-label="Split after character" type="number" min="1" /></label>
        <label>Split time <input v-model.number="splitAt" aria-label="Split time" type="number" step="0.01" /></label>
        <button class="btn" :disabled="selected.length !== 1" @click="run(() => draft.split(character, splitAt))">Split word</button>
        <button class="btn" :disabled="!player.available()" @click="player.play('split', Math.max(0, splitAt - 0.7), Math.min(view.duration, splitAt + 0.7))">
          Listen around split
        </button>
        <label>Shared boundary <input v-model.number="boundaryAt" aria-label="Shared boundary" type="number" step="0.01" /></label>
        <button
          class="btn"
          @click="
            run(() => {
              const s = draft.selection.value[0]
              if (s) {
                draft.remember()
                try {
                  draft.boundary(s.line, s.first, boundaryAt)
                } finally {
                  draft.settle()
                }
              }
            })
          "
        >
          Set shared boundary
        </button>
      </div>
      <p v-if="selected.length === 1">{{ selected[0]!.text.slice(0, character) }}<b aria-label="Text split">│</b>{{ selected[0]!.text.slice(character) }}</p>
      <div v-if="selected.length === 1" class="text-boundaries" aria-label="Choose text boundary">
        <template v-for="(letter, i) in Array.from(selected[0]!.text)" :key="i"
          ><span>{{ letter }}</span
          ><button
            v-if="i < Array.from(selected[0]!.text).length - 1"
            type="button"
            :aria-label="`Split after ${Array.from(selected[0]!.text)
              .slice(0, i + 1)
              .join('')}`"
            :aria-pressed="
              character ===
              Array.from(selected[0]!.text)
                .slice(0, i + 1)
                .join('').length
            "
            @click="
              character = Array.from(selected[0]!.text)
                .slice(0, i + 1)
                .join('').length
            "
          >
            │
          </button></template
        >
      </div>
      <p class="muted">
        Split keeps every character and the complete time span. Joining only combines parts of the same source word. Drag an edge with Shift to move a shared
        boundary; Alt bypasses snapping.
      </p>
    </DisclosureBox>
    <DisclosureBox title="Listen and mark onsets">
      <div class="btn-row">
        <button class="btn" :disabled="!player.available() || !selected.length" @click="startListening()">Start marking</button>
        <button class="btn" :disabled="player.time.value === undefined || !selected.length" @click="startListening(true)">Mark from cursor</button>
        <button class="btn" :disabled="!listening" @click="player.paused.value ? player.resume() : player.pause()">
          {{ player.paused.value ? 'Resume' : 'Pause' }}
        </button>
        <button class="btn" :disabled="!listening || marks.length >= selected.length" @click="tap()">Mark onset (M)</button>
        <button class="btn" :disabled="!listening || marks.length !== selected.length" @click="tap(true)">Final end</button>
        <button class="btn" :disabled="!marks.length" @click="marks.pop()">Retract (Backspace)</button>
        <button
          class="btn"
          :disabled="marks.length !== selected.length + 1"
          @click="
            run(() => {
              draft.mark(marks.map(t => t - offset / 1000))
              listening = false
              marks = []
              player.stop()
            })
          "
        >
          Apply marks
        </button>
        <button
          class="btn"
          @click="
            () => {
              listening = false
              marks = []
              player.stop()
            }
          "
        >
          Cancel marking
        </button>
        <label
          >Speed
          <select :value="player.rate.value" @change="player.setRate(Number(($event.target as HTMLSelectElement).value))">
            <option :value="0.5">0.5×</option>
            <option :value="0.75">0.75×</option>
            <option :value="1">1×</option>
          </select></label
        >
        <label><input v-model="player.loop.value" type="checkbox" /> Loop</label>
        <label>Reaction offset (ms) <input v-model.number="offset" type="number" step="10" /></label>
      </div>
      <p v-if="listening" role="status">
        {{ marks.length }}/{{ selected.length + 1 }} marks. Next: {{ selected[marks.length]?.text ?? 'final end' }}. Inferred ends remain unchecked.
      </p>
      <div v-if="listening" class="btn-row">
        <button
          v-for="(w, i) in selected"
          :key="i"
          class="btn"
          @click="
            () => {
              marks = marks.slice(0, i)
              player.play('marking', Math.max(0, w.start - 0.3), Math.min(view.duration, to + 2))
            }
          "
        >
          Restart {{ w.text }}
        </button>
      </div>
    </DisclosureBox>
    <DisclosureBox title="Clip text and windows">
      <p v-for="clip in clips" :key="clip.id">
        <b>{{ clip.id }}</b> · Saved: {{ clip.before || '(silent)' }} → Draft: {{ clip.text || '(silent)' }}
        <span v-if="clip.from !== undefined && clip.to !== undefined"> · singing {{ clip.from.toFixed(2) }}–{{ clip.to.toFixed(2) }} s</span>
      </p>
      <p class="muted">
        Draft text follows clip start-frame assignment. Resolve crossing words before rendering. Windows include 0.2 s padding; singer-specific delivery is
        applied during planning.
      </p>
    </DisclosureBox>
    <CalloutBox v-if="error" role="alert" kind="warn">{{ error }}</CalloutBox>
  </section>
</template>
<style scoped>
.timing-tools {
  padding: 0.6rem 0;
  display: grid;
  gap: var(--space-2);
}
.timing-tools input[type='number'] {
  width: 6rem;
}
.timing-tools label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}
.timing-tools p {
  margin: 0.5rem 0;
}
.text-boundaries {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-half);
}
.text-boundaries button {
  padding: 3px;
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.text-boundaries button[aria-pressed='true'] {
  background: var(--accent);
  color: var(--accent-text);
}
</style>
