<script setup lang="ts">
import {computed} from 'vue'
import PageBar from '../../components/PageBar.vue'
import ResourceState from '../../components/ResourceState.vue'
import {useDraft} from '../../composables/useDraft'
import {useUnsavedChanges} from '../../composables/useUnsavedChanges'
import {listSteps, stepNames} from '../../lib/format'
import {useAsk} from '../../services/ask'
import {useToasts} from '../../services/toasts'
import {usePageData} from '../project/usePageData'
import {useProject} from '../project/session'
import StoryProposal from './StoryProposal.vue'

/** The book: a music video's story, changed here; a film's screenplay, read here. */
const {project, api, start, busy} = useProject()
const ask = useAsk()
const toasts = useToasts()
const {data: book, loading, error, reload, refresh} = usePageData(signal => api.book(signal))
const film = computed(() => project.value.kind === 'film')
const name = computed(() => (film.value ? 'Screenplay' : 'Story'))
const draft = useDraft(() => book.value?.text)
useUnsavedChanges(() => draft.dirty.value, 'changes to the story')
const builtOn = computed(() => book.value?.builtOn ?? [])

const save = toasts.guard(async () => {
  const yes = await ask({
    title: 'Save the story?',
    lines: [
      'The story in project.json is replaced by this text.',
      builtOn.value.length && 'The next plan run makes what goes again, from this story: the language model only, nothing is rendered.',
    ],
    warnings: builtOn.value.length
      ? [
          `What is built on the story goes: ${listSteps(builtOn.value, project.value.kind)}.`,
          project.value.clips.some(c => c.video) && 'Pictures and clips made before stay, and are stale once the plan has new prompts for them.',
        ]
      : [],
    confirm: 'Save it',
  })
  if (!yes) return
  const result = await api.saveStory(draft.text.value)
  toasts.show(result.changed ? 'The story is saved' : 'Nothing changed')
  await refresh()
})
const writeAgain = toasts.guard(async () => {
  const yes = await ask({
    title: 'Write the story again?',
    lines: ['The language model writes a new story from the lyrics and the story idea, and the run stops after it.'],
    warnings: [
      `The story there is now goes${builtOn.value.length ? `, and with it ${listSteps(builtOn.value, project.value.kind)}` : ''}. A story changed by hand goes too.`,
    ],
    confirm: 'Write it again',
  })
  if (yes) await start({type: 'plan', redo: ['story'], until: 'story'})
})
const adapt = toasts.guard(async () => {
  const yes = await ask({
    title: 'Tell the story anew for the cast?',
    lines: [
      'The language model tells the same story with the characters and places as the Casting page has them now: the plot, the places and the length stay. Nothing changes until you take it - it is shown here next to the story there is.',
    ],
    confirm: 'Have it written',
  })
  if (yes) await start({type: 'adapt-story'})
})
const take = toasts.guard(async () => {
  const kept = book.value?.keptByCast ?? []
  const cast = book.value?.proposalCast
  const yes = await ask(
    film.value
      ? {
          title: 'Take the new screenplay?',
          lines: [
            [cast?.added.length && `new: ${cast.added.join(', ')}`, cast?.removed.length && `gone: ${cast.removed.join(', ')}`].filter(Boolean).join(' · '),
            'Who stays keeps their id and their looks, the look of the film and the places stay. The looks of whoever is new are written by the next plan run.',
          ],
          warnings: [
            kept.length > 0 &&
              `What is read from the script goes: ${listSteps(kept, project.value.kind)}. The next plan run makes it again - the language model only.`,
            project.value.clips.some(c => c.video) && 'Clips made before stay, and are stale once the plan has new shots for them.',
          ],
          confirm: 'Take it',
        }
      : {
          title: 'Take the new story?',
          lines: ['The cast, who sings and the looks stay as they are: the story was told for them.'],
          warnings: kept.length
            ? [`What is planned from the story goes: ${listSteps(kept, project.value.kind)}. The next plan run makes it again - the language model only.`]
            : [],
          confirm: 'Take it',
        },
  )
  if (!yes) return
  await api.storyForCast({proposal: true})
  toasts.show(`The new ${name.value.toLowerCase()} is taken`)
  await refresh()
})
// a film's script that contradicts itself: repaired by a plan run with --fix-script (#836)
const repair = toasts.guard(async () => {
  const yes = await ask({
    title: 'Repair the script?',
    lines: [
      'The language model changes action lines and times of day where the script contradicts itself - never a line of dialogue - and reads it again, up to three rounds. The plan run then goes on as ever.',
      'The old version is kept in old/. The cast and the looks stay; the shots are planned again.',
    ],
    warnings: [project.value.clips.some(c => c.video) && 'Clips made before stay, and are stale once the plan has new shots for them.'],
    confirm: 'Repair it',
  })
  if (yes) await start({type: 'plan', fixScript: true})
})
const drop = toasts.guard(async () => {
  await api.dropStoryProposal()
  await refresh()
})
</script>

<template>
  <div class="scrollpage view">
    <PageBar :title="name" />
    <ResourceState :loading="loading" :error="error" :loaded="!!book" @retry="reload" />
    <template v-if="book">
      <StoryProposal v-if="book.proposal" :now="book.text ?? ''" :proposal="book.proposal" :film="film" :cast="book.proposalCast" @take="take" @drop="drop" />
      <div v-if="book.text === undefined" class="empty">No {{ name.toLowerCase() }} yet - plan it with the button above.</div>
      <template v-else>
        <div v-if="film" class="note">
          The screenplay is read here. It is changed in the script in input/, or in project.json (screenplay), and then planned again with --redo. A character
          added or taken out on the Casting page has the screenplay the pipeline wrote told anew, as a proposal here.
        </div>
        <div v-if="film && book.scriptNotes?.length" class="section sp-notes">
          <b>The script contradicts itself here</b>
          <span v-if="book.scriptFixes" class="muted"> - {{ book.scriptFixes }} repair(s) made so far</span>
          <ul>
            <li v-for="note in book.scriptNotes" :key="note">{{ note }}</li>
          </ul>
          <p class="muted">The film follows the script as it is. Repair it here, or change the script in input/ and plan again.</p>
          <button class="btn" :disabled="busy" @click="repair">Repair the script…</button>
        </div>
        <div class="section"><textarea v-model="draft.text.value" class="book" rows="24" :aria-label="name" :readonly="!book.editable" /></div>
        <div v-if="book.editable" class="section btn-row">
          <button class="btn primary" :disabled="!draft.dirty.value" @click="save">Save the story</button>
          <button class="btn" :disabled="busy" @click="writeAgain">Write it again</button>
          <button class="btn" :disabled="busy" title="The same story with the cast as the Casting page has it now - a proposal next to this one" @click="adapt">
            Tell it anew for the cast
          </button>
        </div>
        <p v-if="book.editable && builtOn.length" class="muted">
          Saving a changed story drops what is built on it: <span :title="stepNames(builtOn)">{{ listSteps(builtOn, project.kind) }}</span
          >. The next plan run makes those again.
        </p>
      </template>
    </template>
  </div>
</template>

<style scoped>
.sp-notes ul {
  margin: var(--space-1) 0;
  padding-left: var(--space-4);
}
.sp-notes p {
  margin: 0 0 var(--space-2);
}
</style>
