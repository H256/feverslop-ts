<script setup lang="ts">
import {computed} from 'vue'
import {plural} from '../../lib/format'
import {reviewList, stateOf} from './clips'
import {useTimeline} from './context'

/** What the clips are, in numbers, and what can be done with several of them at once. */
const {project, fresh, marked, markedClips, onlyFlagged, isFlagged, markFlagged, markState, stepFlagged, review, actions} = useTimeline()
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
const renderAll = (state: 'stale' | 'missing' | 'all') => { markState(state); return actions.renderMarked() }
const rendered = computed(() => clips.value.some(c => c.video))
const allClips = () => actions.preview(clips.value, `all ${clips.value.length} clips`)
const previewMarked = () => actions.preview(markedClips.value, plural(markedClips.value.length, 'clip'))
const reviewNow = () => review.start(reviewList(project.value, marked, fresh.value))
</script>

<template>
  <div class="legend">
    <span class="num">{{ clips.length - count.missing }} of {{ clips.length }} clips rendered</span>
    <span v-if="count.missing"><i style="background: repeating-linear-gradient(135deg, var(--muted) 0 2px, transparent 2px 4px)" />{{ count.missing }} missing</span>
    <span v-if="count.stale"><i style="background: var(--stale)" />{{ count.stale }} stale</span>
    <span v-if="count.pinned">{{ count.pinned }} pinned</span>
    <span v-if="count.marks"><i style="background: var(--danger)" />{{ plural(count.marks, 'mark') }}</span>
    <span v-if="clips.some(c => c.startsFrom)"><i style="background: var(--accent); border-radius: 50%" />goes on</span>
    <template v-if="count.flagged">
      <label><input v-model="onlyFlagged" type="checkbox">Only flagged</label>
      <button title="The flagged clip before" @click="stepFlagged(-1)">‹</button>
      <button title="The next flagged clip" @click="stepFlagged(1)">›</button>
    </template>
    <template v-if="marked.size">
      <span class="num">{{ marked.size }} marked</span>
      <button @click="actions.renderMarked()">Render marked</button>
      <button @click="previewMarked">Preview marked</button>
      <button @click="marked.clear()">Clear</button>
    </template>
    <button v-if="count.stale" title="Mark the stale clips - made from another request than the plan has now - and render them again: the old versions stay selectable" @click="renderAll('stale')">Render stale ({{ count.stale }})</button>
    <button v-if="count.missing" title="Mark the clips that are not rendered yet and render them" @click="renderAll('missing')">Render missing ({{ count.missing }})</button>
    <button v-if="rendered" title="Mark every clip and render them all again - also those that count as current, e.g. after a change the clips do not notice (a seed, a setting outside the request). The old versions stay selectable" @click="renderAll('all')">Render all ({{ clips.length }})</button>
    <button v-if="count.flagged" title="Mark all flagged clips" @click="markFlagged">Mark flagged</button>
    <template v-if="rendered">
      <button title="Go through the marked clips, else the flagged ones, else all: one by one, with keys" @click="reviewNow">Review</button>
      <button title="Larger, 48 fps, grade and sharpen, from the clips there are: nothing is overwritten" @click="actions.refinish()">Refinish</button>
      <button title="Look through the rendered clips for a grey studio backdrop. Runs on this machine, no GPU" @click="actions.plain({type: 'leak-scan'})">Scan for backdrops</button>
    </template>
    <button v-if="clips.length" title="Cheap renders of all clips into previews/" @click="allClips">Preview all</button>
    <button v-if="clips.some(c => c.preview)" title="A low-resolution video of the whole thing from the previews" @click="actions.plain({type: 'final', preview: true})">Preview video</button>
  </div>
</template>
