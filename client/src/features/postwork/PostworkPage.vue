<script setup lang="ts">
import {computed, reactive, ref, watch} from 'vue'
import {useRoute} from 'vue-router'
import type {EditorFinal} from '../../../../shared/workspace'
import PageBar from '../../components/PageBar.vue'
import {mediaUrl} from '../../api/urls'
import {useToasts} from '../../services/toasts'
import {useProject} from '../project/session'
import CreditsForm from './CreditsForm.vue'
import DescriptionForm from './DescriptionForm.vue'
import EditorExport from './EditorExport.vue'
import {
  chainSources,
  creditsRequest,
  descriptionRequest,
  introRequest,
  labelRequest,
  madeByAny,
  newCredits,
  newDescription,
  newIntro,
  newLabel,
  type Step,
  STEPS,
} from './forms'
import IntroForm from './IntroForm.vue'
import LabelForm from './LabelForm.vue'

/**
 * The optional steps on a finished video, for publishing (docs/postwork.md), in the order they are best done: the AI marker, the
 * title card and credits, the intro, the YouTube text. Each starts from what the step before wrote, still to be changed; each runs
 * its command (bun run label, credits, intro, description) and writes a new file next to the video it starts from. What they made
 * plays here - never by itself - and not on the timeline, which is for the music video itself.
 */
const {project, roots, start, busy} = useProject()
const toasts = useToasts()

const finals = computed(() => project.value.finals)
// what a step can start from: every finished video but the low-resolution preview
const sources = computed(() => finals.value.filter(f => !f.preview))
const chain = () => chainSources(project.value.id, finals.value)
const {postwork, kind} = project.value
const first = chain()
const drafts = {
  label: reactive(newLabel(postwork.label, first.label)),
  credits: reactive(newCredits(postwork.credits, kind, first.credits)),
  intro: reactive(newIntro(postwork.intro, first.intro)),
  description: reactive({...newDescription(postwork.description), from: first.description}),
}
// a step that ran: the ones after it start from what it wrote
watch(
  () => sources.value.map(f => f.file).join('\n'),
  () => {
    const next = chain()
    for (const step of STEPS) drafts[step].from = next[step]
  },
)

const STEP_INFO: Record<Step, {title: string; what: string; confirm: string; lines: string[]}> = {
  label: {
    title: 'AI marker',
    what: 'a marker in a corner',
    confirm: 'Put it on',
    lines: [
      'Written next to the video as <name>-labeled.mp4; the sound is copied.',
      'Article 50(4) of the AI Act asks for it on a deep fake: real faces or voices made by AI. For an evidently artistic or fictional work, a marker at the start is enough.',
    ],
  },
  credits: {
    title: 'Title card and credits',
    what: 'before and after it',
    confirm: 'Add them',
    lines: [
      'Written next to the video as <name>-credits.mp4.',
      'What it was made with - the language model, the models, the graphics cards - is collected from what this project ran; nothing is asked of a model.',
    ],
  },
  intro: {
    title: 'Intro',
    what: 'a clip of your own in front',
    confirm: 'Put it in front',
    lines: [
      'A logo or a channel ident in front of the video, written next to it as <name>-intro.mp4.',
      'It takes the size and frame rate of the video; another aspect ratio gets black bars, an intro without sound gets silence.',
    ],
  },
  description: {
    title: 'YouTube text',
    what: 'the description to paste',
    confirm: 'Write it',
    lines: [
      'Written next to the video you choose as <name>.youtube.txt, with .youtube.json (title, tags). Nothing is uploaded.',
      'Only the teaser is written by the language model; the rest is collected from the project. On upload, still set "Altered or synthetic content" in YouTube Studio.',
    ],
  },
}

/** The newest video a step made, from whichever video it started (#832): made once any video of the project went through it. */
const madeBy = (step: Step): EditorFinal | undefined => madeByAny(step, finals.value)
// the first step not made yet is open
const open = ref<Step | ''>(STEPS.find(step => !madeBy(step)) ?? 'label')

const warningsOf = (step: Step) =>
  [
    postwork.problem && `The post-work settings cannot be read, the defaults are shown: ${postwork.problem}`,
    step === 'intro' && !postwork.intro.file && !postwork.introFound && 'There is no input/intro.mp4 in this project: give the path of the intro.',
  ].filter((line): line is string => !!line)

const requestOf = (step: Step) => {
  if (step === 'label') return labelRequest(drafts.label)
  if (step === 'credits') return creditsRequest(drafts.credits, kind)
  if (step === 'intro') return introRequest(drafts.intro)
  if (!drafts.description.from) throw new Error('Choose the video you publish.')
  return descriptionRequest(drafts.description)
}
const run = toasts.guard(async (step: Step) => {
  await start(requestOf(step))
  toasts.show(`${STEP_INFO[step].title}: started - it shows here when it is done`)
})

// the videos the steps made, and any video with a YouTube text: one chosen plays, when you play it
const made = computed(() => finals.value.filter(f => f.postwork || f.youtube !== undefined))
// the start page's card links the newest finished video here (?play=): chosen, played on a click only (#832)
const route = useRoute()
const chosen = ref(typeof route.query.play === 'string' ? route.query.play : '')
const selected = computed(() => made.value.find(f => f.file === chosen.value) ?? made.value.at(-1))
watch(
  () => made.value.length,
  () => {
    chosen.value = made.value.at(-1)?.file ?? ''
  },
)
const copied = ref(false)
const copy = toasts.guard(async (text: string) => {
  await navigator.clipboard.writeText(text)
  copied.value = true
  setTimeout(() => (copied.value = false), 1200)
})
</script>

<template>
  <div class="scrollpage view">
    <PageBar title="Post-work">
      <span class="muted">Optional, for publishing. Each step writes a new file next to the video it starts from - nothing is overwritten.</span>
    </PageBar>
    <p v-if="!sources.length" class="warn">There is no final video yet: render it on the Timeline first.</p>
    <div class="pw-grid">
      <ol class="pw-steps">
        <li v-for="(step, n) in STEPS" :key="step" :class="['pw-step', {open: open === step, made: madeBy(step)}]">
          <button class="pw-head" :aria-expanded="open === step" @click="open = open === step ? '' : step">
            <span class="pw-num">{{ n + 1 }}</span>
            <b>{{ STEP_INFO[step].title }}</b>
            <span class="muted">{{ STEP_INFO[step].what }}</span>
            <span class="spacer" />
            <span v-if="madeBy(step)" class="pw-done" :title="madeBy(step)!.file">made</span>
          </button>
          <div v-if="open === step" class="pw-body">
            <p v-for="line in STEP_INFO[step].lines" :key="line" class="muted pw-line">{{ line }}</p>
            <p v-for="line in warningsOf(step)" :key="line" class="warn">{{ line }}</p>
            <LabelForm v-if="step === 'label'" :draft="drafts.label" :finals="sources" :markers="postwork.markers" />
            <CreditsForm v-else-if="step === 'credits'" :draft="drafts.credits" :finals="sources" :markers="postwork.markers" :kind="kind" />
            <IntroForm v-else-if="step === 'intro'" :draft="drafts.intro" :finals="sources" :found="postwork.introFound" />
            <DescriptionForm v-else :draft="drafts.description" :finals="sources" />
            <div class="pw-actions">
              <button class="btn primary" :disabled="!sources.length" @click="run(step)">{{ STEP_INFO[step].confirm }}</button>
              <span v-if="busy" class="muted">A run is going on - this one can wait in the queue behind it.</span>
            </div>
          </div>
        </li>
      </ol>
      <aside class="pw-side">
        <h3>What the steps made</h3>
        <p v-if="!made.length" class="muted">Nothing yet. The videos of the steps play here, and not on the timeline.</p>
        <template v-else>
          <div class="pw-list" role="listbox" aria-label="What the steps made">
            <button
              v-for="final in made"
              :key="final.file"
              role="option"
              :aria-selected="selected?.file === final.file"
              :class="['pw-item', {on: selected?.file === final.file}]"
              @click="chosen = final.file"
            >
              <span>{{ final.label }}</span>
              <code>{{ final.file }}</code>
            </button>
          </div>
          <template v-if="selected">
            <video :key="selected.file" class="pw-video" controls preload="metadata" :src="mediaUrl(selected, roots)" />
            <div v-if="selected.youtube !== undefined" class="pw-text">
              <div class="pw-texthead">
                <b>YouTube text</b>
                <span class="spacer" />
                <button class="btn" @click="copy(selected.youtube)">{{ copied ? 'Copied' : 'Copy' }}</button>
              </div>
              <pre>{{ selected.youtube }}</pre>
            </div>
          </template>
        </template>
        <EditorExport />
      </aside>
    </div>
  </div>
</template>

<style scoped>
/* class names of their own (pw-): .step, .item, .list and .text are styled for other pages in workspace.css */
.pw-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 440px);
  gap: var(--space-4);
  align-items: start;
}
.pw-steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}
.pw-step {
  border: 1px solid var(--line);
  border-left: 3px solid var(--line);
  border-radius: var(--radius-m);
  background: var(--surface);
}
.pw-step.made {
  border-left-color: var(--ok);
}
.pw-step.open {
  border-left-color: var(--accent);
}
.pw-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  padding: 10px 12px;
  background: none;
  border: 0;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.pw-num {
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-round);
  background: var(--raised);
  font-size: var(--text-s);
  font-weight: 600;
}
.pw-done {
  font-size: var(--text-xs);
  padding: 1px 8px;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  color: var(--muted);
}
.pw-body {
  padding: 0 14px 14px 44px;
}
.pw-line {
  font-size: var(--text-s);
  margin: 0 0 6px;
}
.pw-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-top: 10px;
}
.pw-side {
  position: sticky;
  top: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius-m);
  padding: 10px 12px 12px;
  min-width: 0;
}
.pw-side h3 {
  font-size: var(--text-s);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
  margin: 0 0 8px;
}
.pw-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin-bottom: 10px;
}
.pw-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-half);
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-m);
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  min-width: 0;
}
.pw-item code {
  font-size: var(--text-xs);
  color: var(--muted);
  overflow-wrap: anywhere;
}
.pw-item.on {
  border-color: var(--accent);
  background: var(--raised);
}
.pw-video {
  width: 100%;
  border-radius: var(--radius-m);
  background: #000;
  display: block;
}
.pw-text {
  margin-top: 10px;
}
.pw-texthead {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: 6px;
}
.pw-text pre {
  max-height: 320px;
  overflow: auto;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-m);
  background: var(--raised);
  font: var(--text-s)/1.5 var(--mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
@media (max-width: 900px) {
  .pw-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .pw-side {
    position: static;
  }
}
</style>
