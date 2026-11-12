<script setup lang="ts">
import {computed} from 'vue'
import {plural} from '../../lib/format'
import {reviewList, stateOf} from './clips'
import {useTimeline} from './context'

/** What the clips are, in numbers, and what can be done with several of them at once. */
const {session, project, fresh, marked, markedClips, onlyFlagged, isFlagged, markFlagged, markState, stepFlagged, review, actions} = useTimeline()
const clips = computed(() => project.value.clips)
const count = computed(() => {
  const states = clips.value.map(c => stateOf(c, fresh.value))
  return {
    missing: clips.value.filter(c => !c.video).length,
    stale: states.filter(s => s === 'stale').length,
    pinned: states.filter(s => s === 'pinned').length,
    marks: clips.value.filter(c => c.marks.length).length,
    flagged: clips.value.filter(isFlagged).length,
  }
})
// the clips a settings or cast change left behind, or that were never rendered: marked, then the usual dialog (estimate, risks) asks
const renderAll = (state: 'stale' | 'missing' | 'all') => {
  markState(state)
  return actions.renderMarked()
}
const rendered = computed(() => clips.value.some(c => c.video))
// a post-work step starts from a finished video
const hasFinal = computed(() => project.value.finals.some(f => !f.preview))
const allClips = () => actions.preview(clips.value, `all ${clips.value.length} clips`)
const previewMarked = () => actions.preview(markedClips.value, plural(markedClips.value.length, 'clip'))
const reviewNow = () => review.start(reviewList(project.value, marked, fresh.value))
// the beats of the marked clips (#762): their shots can be planned again
const markedBeats = computed(() => (project.value.beats ?? []).filter(b => b.clips.some(id => marked.has(id))).map(b => b.id))
</script>

<template>
  <div class="legend">
    <!-- what the clips are, in numbers -->
    <div class="grp counts">
      <span class="num">{{ clips.length - count.missing }} of {{ clips.length }} rendered</span>
      <span v-if="count.missing"
        ><i style="background: repeating-linear-gradient(135deg, var(--muted) 0 2px, transparent 2px 4px)" />{{ count.missing }} missing</span
      >
      <span v-if="count.stale"><i style="background: var(--stale)" />{{ count.stale }} stale</span>
      <span v-if="count.pinned">{{ count.pinned }} pinned</span>
      <span v-if="count.marks"><i style="background: var(--danger)" />{{ plural(count.marks, 'mark') }}</span>
      <span v-if="clips.some(c => c.startsFrom)"><i style="background: var(--accent); border-radius: var(--radius-round)" />goes on</span>
    </div>
    <!-- the marked clips: render them, or plan their beats again (#774: grouped, coloured by what they do) -->
    <div v-if="marked.size" class="grp marked-grp">
      <span class="num">{{ marked.size }} marked</span>
      <button class="b-render strong" @click="actions.renderMarked()">Render marked</button>
      <button @click="previewMarked">Preview marked</button>
      <button
        v-if="markedBeats.length"
        class="b-plan"
        :title="`Plan the shots of ${markedBeats.join(', ')} again with the planner as it is now - the language model only; their clips go stale`"
        @click="actions.replanBeats(markedBeats)"
      >
        Plan {{ markedBeats.length > 1 ? `${markedBeats.length} beats` : markedBeats[0] }} again
      </button>
      <button
        v-if="markedBeats.length && project.kind === 'music'"
        class="b-plan"
        :title="`Who is in the marked clips: people of the cast or new ones come in, others go out, with what they do there - ${markedBeats.join(', ')} are planned again`"
        @click="actions.bringPeople([...marked])"
      >
        People…
      </button>
      <button title="Unmark them all" @click="marked.clear()">Clear</button>
    </div>
    <div v-if="count.stale || count.missing || rendered" class="grp">
      <button
        v-if="count.stale"
        class="b-render"
        title="Mark the stale clips - made from another request than the plan has now - and render them again: the old versions stay selectable"
        @click="renderAll('stale')"
      >
        Render stale ({{ count.stale }})
      </button>
      <button v-if="count.missing" class="b-render" title="Mark the clips that are not rendered yet and render them" @click="renderAll('missing')">
        Render missing ({{ count.missing }})
      </button>
      <button
        v-if="rendered"
        class="b-render"
        title="Mark every clip and render them all again - also those that count as current, e.g. after a change the clips do not notice (a seed, a setting outside the request). The old versions stay selectable"
        @click="renderAll('all')"
      >
        Render all ({{ clips.length }})
      </button>
    </div>
    <div v-if="count.flagged || rendered" class="grp">
      <template v-if="count.flagged">
        <label><input v-model="onlyFlagged" type="checkbox" />Only flagged</label>
        <button title="The flagged clip before" @click="stepFlagged(-1)">‹</button>
        <button title="The next flagged clip" @click="stepFlagged(1)">›</button>
        <button title="Mark all flagged clips" @click="markFlagged">Mark flagged</button>
      </template>
      <template v-if="rendered">
        <button class="b-check" title="Go through the marked clips, else the flagged ones, else all: one by one, with keys" @click="reviewNow">Review</button>
        <button title="Look through the rendered clips for a grey studio backdrop. Runs on this machine, no GPU" @click="actions.plain({type: 'leak-scan'})">
          Scan for backdrops
        </button>
      </template>
    </div>
    <div v-if="clips.length" class="grp">
      <button class="b-finish" title="Cheap renders of all clips into previews/" @click="allClips">Preview all</button>
      <button
        v-if="clips.some(c => c.preview)"
        class="b-finish"
        title="A low-resolution video of the whole thing from the previews"
        @click="actions.plain({type: 'final', preview: true})"
      >
        Preview video
      </button>
      <template v-if="rendered">
        <button class="b-finish" title="Larger, 48 fps, grade and sharpen, from the clips there are: nothing is overwritten" @click="actions.refinish()">
          Refinish
        </button>
        <RouterLink
          v-if="hasFinal"
          class="btn b-finish"
          :to="`${session.root}/postwork`"
          title="Optional, for publishing: the AI marker, a title card and credits, an intro, the YouTube text - in their order, with a player for what they made"
          >Post-work</RouterLink
        >
      </template>
    </div>
  </div>
</template>
