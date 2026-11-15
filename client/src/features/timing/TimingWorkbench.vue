<script setup lang="ts">
import SplitLayout from '../../components/SplitLayout.vue'
import CalloutBox from '../../components/CalloutBox.vue'
import {computed, h, onMounted, ref, toRef, watch} from 'vue'
import {useRoute} from 'vue-router'
import type {TimingView} from '../../../../shared/workspace'
import type {TimingRefinement, RefinementLanguage} from '../../../../shared/timing-refinement'
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

// the side column - saving, the cut, the library and its help - can be folded away for room, and stays so in this browser (#834)
const SIDE_KEY = 'timing-side-folded'
const sideFolded = ref(
  (() => {
    try {
      return localStorage.getItem(SIDE_KEY) === '1'
    } catch {
      return false
    }
  })(),
)
watch(sideFolded, folded => {
  try {
    if (folded) localStorage.setItem(SIDE_KEY, '1')
    else localStorage.removeItem(SIDE_KEY)
  } catch {
    // a browser that keeps nothing folds it for this visit only
  }
})
import {useTimingDraft} from './useTimingDraft'

/**
 * When the lyrics are sung. A line the alignment barely found has guessed times; here its words are moved on the waveform of the vocals.
 * The cut of the song stays: the clips' vocals are worked out again, and the beats whose clips sing something else lose their shot plan.
 */
const props = defineProps<{view: TimingView; peaks?: number[]; refresh: () => Promise<boolean>}>()
const {api, roots, start, id} = useProject()
const ask = useAsk()
const toasts = useToasts()
const {planNow} = usePlanning()
const draft = useTimingDraft(toRef(props, 'view'))
const saved = ref<string>()
const editor = ref<InstanceType<typeof TimingEditor>>()
const timingTools = ref<InstanceType<typeof TimingTools>>()
// the Reset menu shuts once one of its actions is clicked; a click on its title opens and shuts it as a <details> does
const more = ref<HTMLDetailsElement>()
const closeMore = (event: MouseEvent) => {
  if ((event.target as HTMLElement).closest('.tw-item') && more.value) more.value.open = false
}
useUnsavedChanges(() => draft.edits.value.size > 0, 'moved lines')
watch(
  () => draft.edits.value.size,
  count => {
    if (count) saved.value = undefined
  },
)

const player = useSnippetPlayer(() => props.view.audio && mediaUrl(props.view.audio, roots), toasts.fail)
const play = (from: number, to: number) => player.play('timing', from, to)

// how early the first word of each line starts against its sound - as the words are now, so a line moved is measured again
const leads = computed(
  () => new Map(props.view.lines.map(l => [l.line, props.peaks && !l.off && !(l.unplaced && !draft.isChanged(l)) ? leadOf(draft.wordsOf(l), props.peaks) : 0])),
)
const earlyLines = computed(() => new Map([...leads.value].filter(([, lead]) => lead >= EARLY_FROM)))
const lead = computed(() => (draft.line.value ? (leads.value.get(draft.line.value.line) ?? 0) : 0))
// the clips whose prompt still has the old times of a line: by line
const outdated = computed(() => {
  const found = new Map<number, string[]>()
  for (const {clip, lines} of props.view.outdated) for (const n of lines) found.set(n, [...(found.get(n) ?? []), clip])
  return found
})
// the lines that want a look, in the order of the song: a clip cut in a word, an early start, an old prompt, a guessed time
const problems = computed(() =>
  props.view.lines.filter(l => !l.off && (draft.crossing(l).length || earlyLines.value.has(l.line) || outdated.value.has(l.line) || draft.unchecked(l))),
)
const nextProblem = (back = false) => {
  const all = problems.value
  if (!all.length) return toasts.show('Nothing left to look at.')
  const at = draft.line.value ? props.view.lines.indexOf(draft.line.value) : -1
  const ordered = back ? [...all].reverse() : all
  const found = ordered.find(l => (back ? props.view.lines.indexOf(l) < at : props.view.lines.indexOf(l) > at)) ?? ordered[0]!
  choose(found.line)
}
const nextKind = (kind: 'unchecked' | 'cut') => {
  const all = props.view.lines.filter(l => !l.off && (kind === 'unchecked' ? draft.unchecked(l) : draft.crossing(l).length))
  const at = props.view.lines.findIndex(l => l.line === draft.selected.value)
  const found = all.find(l => props.view.lines.indexOf(l) > at) ?? all[0]
  if (found) choose(found.line)
}
const tightenAll = () => {
  draft.tighten(earlyLines.value)
}
// a line left out (heard, but not sung) or sung again - saved at once, as bun run timing --off / --on does it
const setOff = toasts.guard((line: TimingView['lines'][number], off: boolean) =>
  saving.during(async () => {
    const change = draft.request()
    const entry = change.lines.find(l => l.line === line.line)
    if (entry) entry.off = off
    else change.lines.push({line: line.line, off})
    const result = await api.saveTiming(change)
    if (await props.refresh()) draft.discard()
    saved.value = [
      `"${line.text}" ${off ? 'is left out: no clip sings it' : 'is sung again'}.`,
      result.slots.length && `${plural(result.slots.length, 'clip')} sing${result.slots.length === 1 ? 's' : ''} something else now.`,
      result.replanned.length && `${result.replanned.join(', ')} ${result.replanned.length > 1 ? 'are' : 'is'} planned with the next plan run.`,
    ]
      .filter(Boolean)
      .join(' ')
  }),
)

// back to the automatic timing (#738): the line as the alignment makes it from the kept transcript - a correction that was wrong
const reset = toasts.guard((lines: TimingView['lines']) =>
  saving.during(async () => {
    if (
      lines.length > 1 &&
      !(await ask({
        title: `Set ${plural(lines.length, 'line')} back to the automatic timing?`,
        lines: ['Every line placed by hand goes back to where the alignment puts it. Whisper does not run again.'],
        confirm: 'Set them back',
      }))
    )
      return
    const result = await api.saveTiming({lines: lines.map(l => ({line: l.line, reset: true}))})
    await props.refresh()
    saved.value = [
      lines.length === 1 ? `"${lines[0]!.text}" is back at the automatic timing.` : `${plural(result.changed.length, 'line')} back at the automatic timing.`,
      result.replanned.length && `${result.replanned.join(', ')} ${result.replanned.length > 1 ? 'are' : 'is'} planned with the next plan run.`,
    ]
      .filter(Boolean)
      .join(' ')
  }),
)
const byHand = computed(() => props.view.lines.filter(l => l.byHand))

const FILTERS = computed(
  () =>
    [
      {value: 'all', label: 'All lines'},
      {value: 'estimated', label: `Estimated (${props.view.lines.filter(l => l.estimated).length})`},
      {value: 'changed', label: 'Moved'},
      {value: 'adlibs', label: `Ad-libs (${props.view.lines.filter(l => l.adlib).length})`},
      ...(earlyLines.value.size ? [{value: 'early', label: `Early starts (${earlyLines.value.size})`}] : []),
      ...(outdated.value.size ? [{value: 'old', label: `Prompt old (${outdated.value.size})`}] : []),
    ] as const,
)
const filter = ref<LineFilter>('all')
const choose = (n: number, extend = false) => {
  draft.choose(n, extend)
  editor.value?.focus()
}

// while saving the page is not to be changed: the moved lines are let go - only once what was saved has been read again
const saving = usePending()
const addWords = toasts.guard(async () => {
  const line = draft.line.value
  if (!line || draft.edits.value.size) return
  const expected = line.words.map(w => ({...w}))
  const at = ref(draft.word.value ?? expected.length)
  const text = ref('')
  const separate = ref(false)
  const startAt = ref(0),
    endAt = ref(0)
  const place = () => {
    const left = expected[at.value - 1]?.end,
      right = expected[at.value]?.start
    startAt.value = left ?? Math.max(0, (right ?? 0) - 0.4)
    endAt.value = right ?? Math.min(props.view.duration, startAt.value + 0.4)
  }
  place()
  const timeField = (label: string, value: typeof startAt) =>
    h(FormField, {label}, () =>
      h('input', {
        type: 'number',
        step: '.001',
        min: 0,
        max: props.view.duration,
        value: value.value,
        onInput: (e: Event) => {
          value.value = Number((e.target as HTMLInputElement).value)
        },
      }),
    )
  await ask({
    title: 'Add missing sung words',
    lines: [
      'The existing words keep their timing. New word boxes are spread across the time range you enter; adjust their boundaries afterwards.',
      'The lyric text is updated and backed up with the timing.',
    ],
    warnings: ['A new separate line, or extending an ad-lib into a regular lyric line, requires rebuilding existing shot plans.'],
    body: () =>
      h('div', [
        h(FormField, {label: 'Add to'}, () =>
          h(
            'select',
            {
              value: separate.value ? 'line' : 'words',
              onChange: (e: Event) => {
                separate.value = (e.target as HTMLSelectElement).value === 'line'
              },
            },
            [h('option', {value: 'words'}, 'Current line'), h('option', {value: 'line'}, 'New separate line in this section')],
          ),
        ),
        separate.value
          ? h('p', {class: 'muted'}, `New line in ${line.section}. Set the time range where it is sung.`)
          : h(FormField, {label: 'Insert at'}, () =>
              h(
                'select',
                {
                  value: at.value,
                  onChange: (e: Event) => {
                    at.value = Number((e.target as HTMLSelectElement).value)
                    place()
                  },
                },
                [
                  ...expected.map((w, n) => h('option', {value: n}, `Before ${n + 1}: ${w.text}`)),
                  h('option', {value: expected.length}, 'After the last word'),
                ],
              ),
            ),
        h(FormField, {label: 'Missing words'}, () =>
          h('input', {
            type: 'text',
            required: true,
            value: text.value,
            onInput: (e: Event) => {
              text.value = (e.target as HTMLInputElement).value
            },
          }),
        ),
        timeField('Start (seconds)', startAt),
        timeField('End (seconds)', endAt),
        h('p', {class: 'muted'}, 'If there is no free interval, move the neighbouring words first. Existing words are never squeezed automatically.'),
      ]),
    confirm: 'Add words & save',
    submit: async () => {
      const texts = text.value.trim().split(/\s+/).filter(Boolean)
      if (!texts.length || !Number.isFinite(startAt.value) || !Number.isFinite(endAt.value) || endAt.value - startAt.value < texts.length * 0.05)
        throw new Error('Enter words and allow at least 0.05 seconds per word.')
      const step = (endAt.value - startAt.value) / texts.length
      const words = texts.map((text, n) => ({text, start: startAt.value + n * step, end: startAt.value + (n + 1) * step, estimated: true}))
      const result = await api.saveTiming(
        separate.value
          ? {lines: [], add: {afterLine: line.line, expectedText: line.text, words}}
          : {lines: [{line: line.line, off: false, insert: {at: at.value, expected, words}}]},
      )
      refinement.value = undefined
      await props.refresh()
      if (result.changed[0] !== undefined) choose(result.changed[0])
      saved.value = 'Words and lyrics saved. Check the new word boundaries; affected shot plans need rebuilding.'
    },
  })
})
const refining = usePending()
const refinement = ref<TimingRefinement>()
const refinementLanguage = ref<RefinementLanguage>('de')
const retryPassage = toasts.guard(async () => {
  const line = draft.line.value
  if (!line || draft.edits.value.size || refining.pending.value || saving.pending.value) return
  await ask({
    title: 'Retry this sung passage',
    lines: [
      `Confirm that “${line.text}” is actually sung.`,
      'A short excerpt will align this line and, if eligible, its following line together. Other lines and manual timing stay.',
      'Nothing is saved yet. Applying the preview also enables this line if it was left out.',
    ],
    body: () =>
      h('label', [
        'Lyrics language ',
        h(
          'select',
          {
            value: refinementLanguage.value,
            onChange: (event: Event) => {
              refinementLanguage.value = (event.target as HTMLSelectElement).value as RefinementLanguage
            },
          },
          [h('option', {value: 'de'}, 'Deutsch'), h('option', {value: 'en'}, 'English'), h('option', {value: 'fr'}, 'Français')],
        ),
      ]),
    confirm: 'This line is sung — prepare',
    submit: () =>
      refining.during(async () => {
        refinement.value = undefined
        refinement.value = await api.refineTiming(refinementLanguage.value, {line: line.line, confirmSung: true})
      }),
  })
})
const prepareRefinement = toasts.guard(() =>
  refining.during(async () => {
    refinement.value = undefined
    refinement.value = await api.refineTiming(refinementLanguage.value)
  }),
)
const takeRefinement = toasts.guard(() =>
  saving.during(async () => {
    if (!refinement.value || draft.edits.value.size) return
    const result = await api.applyTimingRefinement(refinement.value.id)
    refinement.value = undefined
    await props.refresh()
    saved.value = `Refined ${result.changed.length} lines. Listen to the unchecked words. ${result.replanned.length} affected beats need planning again. Original timing was backed up.`
  }),
)
const save = toasts.guard((then: 'none' | 'plan' | 'cut') =>
  saving.during(async () => {
    const result = await api.saveTiming(draft.request())
    if (!(await props.refresh())) {
      saved.value = 'Saved - but the page could not read it again: what you see is what was sent.'
      return
    }
    draft.discard()
    saved.value = [
      `Saved: ${plural(result.slots.length, 'clip')} sing${result.slots.length === 1 ? 's' : ''} something else now.`,
      result.replanned.length && `${result.replanned.join(', ')} ${then === 'plan' ? 'are planned now' : 'are planned with the next plan run'}.`,
    ]
      .filter(Boolean)
      .join(' ')
    if (then === 'plan' && props.view.unplanned.length) await start({type: 'plan'})
    if (then === 'cut') await start({type: 'plan', redo: ['timeline']})
  }),
)
const cutAgain = toasts.guard(async () => {
  const yes = await ask({
    title: 'Cut the song again?',
    lines: [
      'The new times are saved, then the song is cut into clips again around them (--redo=timeline).',
      'Every shot of the video is planned again by the language model, and every clip whose cut or plan changes goes stale. Nothing is rendered on its own.',
    ],
    warnings: ['On a whole song that takes a while: the blocking and the shots of every beat.'],
    confirm: 'Save and cut again',
  })
  if (yes) await save('cut')
})
// the song with its stems and this timing into the library, as bun run export-song does it
const putIntoLibrary = toasts.guard(async () => {
  const songId = ref(id),
    name = ref(id)
  const field = (label: string, value: typeof songId) =>
    h(FormField, {label}, () =>
      h('input', {
        type: 'text',
        required: true,
        value: value.value,
        onInput: (event: Event) => {
          value.value = (event.target as HTMLInputElement).value
        },
      }),
    )
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
  <SplitLayout full :folded="sideFolded" :inert="saving.pending.value" :aria-busy="saving.pending.value" @keydown.capture="timingTools?.key($event)">
    <PageBar title="When the lyrics are sung"
      ><SegmentedControl v-model="filter" :options="FILTERS" label="Lines shown" /><button
        class="btn mini"
        :aria-expanded="!sideFolded"
        title="The column with saving, the cut and the help"
        @click="sideFolded = !sideFolded"
      >
        {{ sideFolded ? 'Show the side column' : 'Hide the side column' }}
      </button></PageBar
    >
    <details class="timing-refinement" :open="refinement?.passage ? true : undefined">
      <summary>Refine timing from vocals</summary>
      <p>Align the existing lyrics to phonemes. Hand edits and anchors stay. Check the proposal before applying; affected shot plans will need rebuilding.</p>
      <div class="btn-row">
        <label
          >Lyrics language
          <select v-model="refinementLanguage" :disabled="refining.pending.value">
            <option value="de">Deutsch</option>
            <option value="en">English</option>
            <option value="fr">Français</option>
          </select></label
        >
        <button class="btn" :disabled="refining.pending.value || draft.edits.value.size > 0" @click="prepareRefinement">
          {{ refining.pending.value ? 'Aligning vocals…' : 'Prepare refinement' }}
        </button>
        <span v-if="draft.edits.value.size" class="muted">Save or discard your edits first.</span>
      </div>
      <p v-if="refining.pending.value" role="status">This can take several minutes. The first run downloads the local model. Your timing is unchanged.</p>
      <template v-if="refinement">
        <p v-if="refinement.passage">
          Passage only: lines {{ refinement.passage.targets.map(n => n + 1).join(', ') }}. Apply the proposed changes together. This also confirms line
          {{ refinement.passage.line + 1 }} is sung; other lines stay unchanged.
        </p>
        <p>
          {{ refinement.entries.filter(e => e.status === 'refined').length }} refined ·
          {{ refinement.entries.filter(e => e.status === 'review' || e.status === 'omit').length }} need manual review.
          <template v-if="!refinement.passage">Refinement keeps lines sung or left out as they are.</template>
          A missing transcript match does not mean a line was not sung.
        </p>
        <div style="max-height: 20rem; overflow: auto">
          <p v-for="entry in refinement.entries" :key="entry.line">
            <button class="btn mini" @click="choose(entry.line)">{{ entry.line + 1 }}</button>
            <b>{{ entry.text }}</b> [{{ entry.status }}] {{ entry.before.map(n => n.toFixed(2)).join('–')
            }}<span v-if="entry.after"> → {{ entry.after.map(n => n.toFixed(2)).join('–') }}</span> — {{ entry.reason }}
            <button class="btn mini" @click="play(Math.max(0, entry.before[0] - 0.3), Math.min(view.duration, entry.before[1] + 0.3))">Listen before</button>
            <button v-if="entry.after" class="btn mini" @click="play(Math.max(0, entry.after[0] - 0.3), Math.min(view.duration, entry.after[1] + 0.3))">
              Listen to proposal
            </button>
          </p>
        </div>
        <button class="btn" :disabled="!refinement.change.lines.length || draft.edits.value.size > 0 || refining.pending.value" @click="takeRefinement">
          {{ refinement.passage ? 'Apply passage' : 'Apply proposal' }}
        </button>
        <button class="btn" @click="refinement = undefined">Dismiss</button>
      </template>
    </details>
    <div class="tedit-wrap">
      <div class="tedit-head btn-row">
        <template v-if="draft.line.value">
          <b>{{ draft.line.value.text }}</b>
          <span class="muted num"
            >{{ draft.line.value.section }} · {{ clock(draft.startOf(draft.line.value)) }}–{{ clock(draft.endOf(draft.line.value)) }}</span
          >
          <span v-if="draft.unchecked(draft.line.value)" class="chip stale" title="Barely found in the transcript: the times are spread over the line, a guess"
            >estimated</span
          >
          <span v-if="draft.isChanged(draft.line.value)" class="chip u-accent">moved</span>
          <span
            v-if="draft.line.value.adlib"
            class="chip stale"
            :title="draft.line.value.off ? 'Heard but not enabled. Sing it includes this line in clips.' : 'Enabled: this ad-lib is included in clips.'"
            >{{ draft.line.value.off ? 'ad-lib, off' : 'ad-lib, sung' }}</span
          >
          <span v-else-if="draft.line.value.off" class="chip bad" title="Left out: heard, but not sung - no clip sings it">left out</span>
          <span v-if="draft.line.value.problem" class="chip bad" :title="`Against lyrics.txt: ${draft.line.value.problem}`">{{
            draft.line.value.problem
          }}</span>
          <span
            v-if="lead >= EARLY_FROM"
            class="chip stale"
            title="The first word starts before the singing does: its box covers silence. Tighten the start, or drag it."
            >starts {{ lead.toFixed(1) }} s early</span
          >
          <span
            v-if="outdated.has(draft.line.value.line)"
            class="chip stale"
            :title="`The prompt of ${outdated.get(draft.line.value.line)!.join(', ')} still has this line at its old times: plan again`"
            >prompt old</span
          >
        </template>
        <div class="spacer" />
        <span v-if="draft.line.value" class="tw-grp">
          <button class="btn" @click="editor?.playLine(draft.line.value)">Listen</button>
          <button
            v-if="draft.line.value && lead >= EARLY_FROM"
            class="btn"
            title="Move the start of the first word to where the singing begins"
            @click="draft.tighten(new Map([[draft.line.value.line, lead]]))"
          >
            Tighten the start
          </button>
          <button
            v-if="draft.line.value"
            class="btn"
            :title="
              draft.edits.value.size
                ? 'Save your pending timing changes and change whether this line is sung'
                : draft.line.value.off
                  ? 'The line is sung again: the clips it falls into sing it'
                  : 'Heard, but not sung (a misheard ad-lib, a line on top of another): no clip sings it. It stays here, to be sung again'
            "
            @click="setOff(draft.line.value, !draft.line.value.off)"
          >
            {{ draft.edits.value.size ? 'Save changes & ' : ''
            }}{{ draft.line.value.off ? (draft.line.value.adlib ? 'Sing it' : 'Sing it again') : 'Leave the line out' }}
          </button>
          <button
            class="btn"
            :disabled="draft.edits.value.size > 0"
            :title="draft.edits.value.size ? 'Save your moved words before adding new words' : 'Insert missing sung words and extend the lyrics'"
            @click="addWords"
          >
            Add words
          </button>
          <button
            class="btn"
            :disabled="!draft.line.value || draft.edits.value.size > 0 || refining.pending.value || saving.pending.value"
            title="Confirm this lyric is sung, then preview a local alignment with its neighbour"
            @click="retryPassage"
          >
            Retry sung passage
          </button>
        </span>
        <span class="tw-grp">
          <button
            v-if="problems.length"
            class="btn"
            :title="`${problems.length} lines want a look: cuts in words, early starts, old prompts, guessed times. Key N, Shift+N back`"
            @click="nextProblem()"
          >
            Next problem ({{ problems.length }})
          </button>
          <button class="btn" @click="nextKind('unchecked')">Next unchecked</button>
          <button class="btn" @click="nextKind('cut')">Next cut</button>
        </span>
        <!-- back to the saved or the automatic times: less often, in a menu (#834) -->
        <details
          v-if="draft.line.value?.byHand || byHand.length > 1 || (draft.line.value && draft.isChanged(draft.line.value))"
          ref="more"
          class="tw-more"
          @click="closeMore"
        >
          <summary class="btn">Reset ▾</summary>
          <div class="tw-menu" role="menu">
            <button
              v-if="draft.line.value?.byHand"
              class="btn tw-item"
              :disabled="draft.edits.value.size > 0"
              :title="
                draft.edits.value.size
                  ? 'Save the moved lines first'
                  : 'Where the alignment puts it, worked out again from the transcript - your placement goes'
              "
              @click="reset([draft.line.value])"
            >
              Back to automatic
            </button>
            <button
              v-if="byHand.length > 1"
              class="btn tw-item"
              :disabled="draft.edits.value.size > 0"
              :title="`All ${byHand.length} lines placed by hand back to the automatic timing`"
              @click="reset(byHand)"
            >
              All back to automatic
            </button>
            <button
              v-if="draft.line.value && draft.isChanged(draft.line.value)"
              class="btn tw-item"
              title="Back to the saved times"
              @click="draft.resetLine(draft.line.value)"
            >
              Reset line
            </button>
          </div>
        </details>
        <span class="tw-grp">
          <button class="btn" :disabled="!draft.history.length" title="Ctrl+Z" @click="draft.undo()">Undo</button>
          <button class="btn" :disabled="!draft.future.length" title="Ctrl+Shift+Z" @click="draft.redo()">Redo</button>
        </span>
        <span class="tw-grp">
          <button class="btn" title="Ctrl+wheel, + / -" @click="draft.zoom(0.8)">+</button>
          <button class="btn" title="Ctrl+wheel, + / -" @click="draft.zoom(1.25)">−</button>
        </span>
      </div>
      <TimingEditor
        ref="editor"
        :view="view"
        :draft="draft"
        :peaks="peaks"
        :head="player.time.value"
        :playing="!!player.playing.value"
        @play="play"
        @stop="player.stop()"
        @next="nextProblem"
      />
      <TimingTools ref="timingTools" :draft="draft" :view="view" :player="player" />
      <div>
        <CalloutBox v-if="draft.line.value && draft.crossing(draft.line.value).length" kind="warn" as="div">
          A clip cut falls into
          {{
            draft
              .crossing(draft.line.value)
              .map(c => `"${c.word.text}"`)
              .join(', ')
          }}: the word is then sung half in one clip, half in the next. Split the word at the cut to preserve its complete audible span, or adjust its timing
          after listening.
        </CalloutBox>
        <CalloutBox v-if="draft.overlaps.value.length" kind="warn" as="div">
          This line overlaps {{ draft.overlaps.value.map(l => `"${l.text}"`).join(' and ') }}. Fine for two singers at once - otherwise move one of them.
        </CalloutBox>
      </div>
    </div>
    <TimingLineList :view="view" :draft="draft" :filter="filter" :leads="leads" :outdated="outdated" @choose="choose" />
    <template #side>
      <TimingSide
        :view="view"
        :draft="draft"
        :saved="saved"
        :early="earlyLines.size"
        @save="save"
        @cut-again="cutAgain"
        @library="putIntoLibrary"
        @tighten="tightenAll"
        @plan="toasts.guard(planNow)()"
      />
    </template>
  </SplitLayout>
</template>

<style scoped>
/* the bar's buttons in groups by what they do, a line between them (#834) */
.tw-grp {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;
  padding-left: 10px;
  border-left: 1px solid var(--line);
}
.tw-more {
  position: relative;
}
.tw-more > summary {
  list-style: none;
}
.tw-more > summary::-webkit-details-marker {
  display: none;
}
.tw-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-1);
  padding: 6px;
  min-width: 220px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-m);
  box-shadow: 0 6px 18px rgb(0 0 0 / 0.18);
}
.tw-menu .btn {
  text-align: left;
}
</style>
