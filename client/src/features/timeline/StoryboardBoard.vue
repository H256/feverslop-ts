<script setup lang="ts">
import {computed, reactive, ref, watch} from 'vue'
import type {EditorClip} from '../../../../shared/workspace'
import {mediaUrl, thumbUrl} from '../../api/urls'
import {viewerStore} from '../../lib/browser-store'
import {STATE_CHIPS, fileOf, flagged, standIn, stateOf} from './clips'
import {useTimeline} from './context'
import {boardRows, castOf, intentOf} from './storyboard'

/**
 * The storyboard (#1194): every clip as a large card under its beat, rows that fold. A card plays its video muted while the mouse is
 * on it - only then, never by itself (no autoplay). A click goes to the clip, as on the timeline; Ctrl or Shift marks clips.
 */
const {project, fresh, playback, clickClip, marked, session} = useTimeline()
const roots = session.roots
type Filter = 'all' | 'todo' | 'failed'
const filter = ref<Filter>('all')
const FOLDED = `board.folded:${session.kind}/${session.id}`
const folded = reactive(new Set<string>(readFolded()))
function readFolded(): string[] {
  try {
    const kept = JSON.parse(viewerStore.get(FOLDED) ?? '[]') as unknown
    return Array.isArray(kept) ? kept.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
watch(folded, now => viewerStore.set(FOLDED, JSON.stringify([...now])))
const fold = (id: string) => (folded.has(id) ? folded.delete(id) : folded.add(id))

const shown = (clip: EditorClip) => filter.value === 'all' || (filter.value === 'todo' ? flagged(clip, fresh.value) : clip.marks.some(m => m.kind === 'failed'))
const rows = computed(() =>
  boardRows(project.value, fresh.value)
    .map(row => ({...row, visible: row.clips.filter(shown)}))
    .filter(row => row.visible.length),
)
const hovered = ref<string>()
const seconds = (clip: EditorClip) => (clip.end - clip.start).toFixed(1)
const videoOf = (clip: EditorClip) => {
  const file = fileOf(clip, 'clips')
  return file ? mediaUrl(file, roots) : undefined
}
</script>

<template>
  <section class="board" aria-label="Storyboard">
    <header class="board-head">
      <strong>Storyboard</strong>
      <span class="muted">{{ project.clips.length }} clips · {{ project.seconds.toFixed(0) }} s</span>
      <div class="spacer" />
      <div class="seg" role="group" aria-label="Show">
        <button :class="{on: filter === 'all'}" :aria-pressed="filter === 'all'" @click="filter = 'all'">All</button>
        <button :class="{on: filter === 'todo'}" :aria-pressed="filter === 'todo'" title="Not rendered, stale or with a mark" @click="filter = 'todo'">
          To look at
        </button>
        <button :class="{on: filter === 'failed'}" :aria-pressed="filter === 'failed'" @click="filter = 'failed'">Failed</button>
      </div>
    </header>
    <p v-if="!rows.length" class="muted board-empty">No clips to show here.</p>
    <div v-for="row in rows" :key="row.id" class="board-row">
      <button class="board-row-head" :aria-expanded="!folded.has(row.id)" @click="fold(row.id)">
        <span class="board-caret">{{ folded.has(row.id) ? '▸' : '▾' }}</span>
        <strong>{{ row.label }}</strong>
        <span class="muted">{{ row.clips.length }} clips · {{ row.seconds.toFixed(1) }} s</span>
        <span class="board-progress" :title="`${row.done} of ${row.clips.length} rendered and current`">
          <span :style="{width: `${(row.done / row.clips.length) * 100}%`}" />
        </span>
      </button>
      <p v-if="row.text && !folded.has(row.id)" class="muted board-row-text">{{ row.text }}</p>
      <div v-if="!folded.has(row.id)" class="board-cards">
        <button
          v-for="clip in row.visible"
          :key="clip.id"
          :class="['board-card', {selected: playback.clip.value?.id === clip.id, marked: marked.has(clip.id)}]"
          :data-id="clip.id"
          @click="clickClip($event, clip)"
          @dblclick="playback.seek(clip.start)"
          @mouseenter="hovered = clip.id"
          @mouseleave="hovered = undefined"
        >
          <span class="board-picture">
            <video v-if="hovered === clip.id && clip.video && videoOf(clip)" :src="videoOf(clip)" muted autoplay loop playsinline />
            <img v-else-if="standIn(clip)" :src="thumbUrl(standIn(clip)!, roots, 640)" alt="" decoding="async" draggable="false" />
            <span v-if="!clip.video" class="board-intent">{{ intentOf(clip) }}</span>
            <span class="board-number">{{ clip.id.replace(/^\D+/, '') }}</span>
            <span :class="['board-state', STATE_CHIPS[stateOf(clip, fresh)].cls]">{{ STATE_CHIPS[stateOf(clip, fresh)].label }}</span>
            <span class="board-length">{{ seconds(clip) }} s</span>
          </span>
          <span class="board-text">
            <strong>{{ [clip.group, clip.shots[0]?.framing].filter(Boolean).join(' · ') || clip.id }}</strong>
            <span v-if="clip.lines[0]" class="board-line"
              ><em>{{ clip.lines[0].who }}:</em> {{ clip.lines[0].text }}</span
            >
            <span v-if="clip.shots[0]?.camera" class="muted board-camera">{{ clip.shots[0].camera }}</span>
          </span>
          <span v-if="castOf(clip).length" class="board-cast">
            <img
              v-for="person in castOf(clip)"
              :key="person.id"
              :src="thumbUrl(person, roots)"
              :alt="person.name"
              :title="person.name"
              decoding="async"
              draggable="false"
            />
          </span>
        </button>
      </div>
    </div>
  </section>
</template>
