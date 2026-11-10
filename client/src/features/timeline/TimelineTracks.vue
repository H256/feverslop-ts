<script setup lang="ts">
import {computed, onMounted, onScopeDispose, ref, watch, watchEffect} from 'vue'
import type {EditorClip} from '../../../../shared/workspace'
import {usePointerDrag} from '../../composables/usePointerDrag'
import {clamp, plural} from '../../lib/format'
import {hueAt} from '../../lib/terms'
import {ChromeService} from '../../services/chrome'
import {drawRuler, drawWave} from './canvas'
import ClipBlock from './ClipBlock.vue'
import ClipPeek from './ClipPeek.vue'
import {stateOf} from './clips'
import {useTimeline} from './context'
import TimelineLegend from './TimelineLegend.vue'
import {lanes, type LaneKey} from './lanes'

/** The timeline: a ruler, the sections or scenes, the sound, the clips and what is sung or said - zoomed, scrolled and scrubbed. */
const {project, fresh, peaks, progress, playback, marked, onlyFlagged, clickClip, isFlagged, peek, session, direct, review} = useTimeline()
const {theme} = ChromeService.use()
const MAX_PPS = 160
const scroller = ref<HTMLElement>()
const ruler = ref<HTMLCanvasElement>()
const wave = ref<HTMLCanvasElement>()
const track = ref<HTMLElement>()
const pps = ref(1)
const fitted = ref(true)
const left = ref(0)
const width = ref(0)
const film = computed(() => project.value.kind === 'film')

const fitScale = () => width.value / Math.max(1, project.value.seconds)
const zoom = computed(() => Math.round((Math.log(pps.value / fitScale()) / Math.log(MAX_PPS / fitScale())) * 100) || 0)
function setScale(next: number, anchorTime?: number, anchorX?: number) {
  pps.value = clamp(next, fitScale(), Math.max(MAX_PPS, fitScale()))
  if (anchorTime !== undefined && scroller.value) scroller.value.scrollLeft = anchorTime * pps.value - anchorX!
}
const fit = () => {
  fitted.value = true
  setScale(fitScale())
  if (scroller.value) scroller.value.scrollLeft = 0
}
const zoomed = (event: Event) => {
  const value = Number((event.target as HTMLInputElement).value)
  const box = scroller.value!
  const centre = playback.t.value * pps.value - box.scrollLeft
  const inView = centre >= 0 && centre <= box.clientWidth
  const anchorX = inView ? centre : box.clientWidth / 2
  const anchorTime = inView ? playback.t.value : (box.scrollLeft + anchorX) / pps.value
  fitted.value = value === 0
  setScale(fitScale() * Math.pow(MAX_PPS / fitScale(), value / 100), anchorTime, anchorX)
}
/** A plain wheel moves along the timeline, which has nothing to scroll up and down; Ctrl+wheel zooms around the pointer. */
const wheel = (event: WheelEvent) => {
  const box = scroller.value!
  if (!event.ctrlKey) {
    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
      box.scrollLeft += event.deltaY
      event.preventDefault()
    }
    return
  }
  event.preventDefault()
  const x = event.clientX - box.getBoundingClientRect().left
  fitted.value = false
  setScale(pps.value * Math.exp(-event.deltaY * 0.002), (x + box.scrollLeft) / pps.value, x)
}
const observer = new ResizeObserver(() => {
  width.value = scroller.value?.clientWidth ?? 0
  setScale(fitted.value ? fitScale() : pps.value)
})
onMounted(() => {
  if (scroller.value) observer.observe(scroller.value)
})
onScopeDispose(() => observer.disconnect())
watch(
  () => project.value.seconds,
  () => setScale(fitted.value ? fitScale() : pps.value),
)

// the playhead moves every frame: set on the track itself, nothing else is drawn again for it - and it stays in sight
watch(playback.t, t => {
  track.value?.style.setProperty('--t', String(t))
  const box = scroller.value
  if (!box) return
  const x = t * pps.value
  if (x < box.scrollLeft || x > box.scrollLeft + box.clientWidth - 40) box.scrollLeft = x - 40
})
watchEffect(() => {
  void theme.value
  if (!ruler.value || !width.value) return
  const view = {left: left.value, width: width.value, pps: pps.value, seconds: project.value.seconds}
  drawRuler(ruler.value, view)
  // the song lane can be hidden (#772): drawn again when it is back
  if (wave.value) drawWave(wave.value, view, peaks.value)
})

const drag = usePointerDrag()
/** Pressing and dragging on a lane without clips moves the playhead. */
function scrub(event: PointerEvent) {
  const timeAt = (e: PointerEvent) => (e.clientX - scroller.value!.getBoundingClientRect().left + scroller.value!.scrollLeft) / pps.value
  const wasPlaying = playback.playing.value
  if (wasPlaying) playback.setPlaying(false)
  playback.seek(timeAt(event))
  // playing goes on when the button is let go - not when the drag is cancelled or the page goes with it
  drag(
    e => playback.seek(timeAt(e)),
    released => {
      if (released && wasPlaying) playback.setPlaying(true)
    },
  )
}

const hues = computed(() => {
  const map = new Map<string, number>()
  for (const group of project.value.groups) if (!map.has(group.label)) map.set(group.label, hueAt(map.size))
  return map
})
// The cast lanes (#735): one per character, the stretches of the shots that show them - who is in the picture at all, and where they
// sing, play or speak. Neighbouring shots that show the same are one stretch. A click directs the shot under it.
type CastStretch = {key: string; start: number; length: number; does: string[]; shot?: string; title: string}
const castLanes = computed(() => {
  const lanes = new Map<string, {id: string; name: string; stretches: CastStretch[]}>()
  for (const clip of project.value.clips) {
    clip.shots.forEach((shot, n) => {
      const start = clip.start + shot.at
      const end = clip.start + (clip.shots[n + 1]?.at ?? clip.end - clip.start)
      for (const who of shot.cast ?? []) {
        const lane = lanes.get(who.id) ?? lanes.set(who.id, {id: who.id, name: who.name, stretches: []}).get(who.id)!
        const last = lane.stretches.at(-1)
        const does = [...who.does]
        if (last && Math.abs(last.start + last.length - start) < 0.05 && last.does.join() === does.join()) {
          last.length = end - last.start
          continue
        }
        lane.stretches.push({
          key: `${clip.id}:${n}:${who.id}`,
          start,
          length: Math.max(0.05, end - start),
          does,
          shot: shot.directionId,
          title: `${who.name}${does.length ? ` - ${does.join(', ')}` : ''} · ${clip.id} ${shot.label.replace(/^\[|\]$/g, '')}`,
        })
      }
    })
  }
  return [...lanes.values()]
})
// what can be hidden, for room (#772) - the clips always stay; kept per browser (lanes.ts)
const shownLanes = computed(
  () =>
    [
      {key: 'player', label: 'Player', title: 'The picture and the clip panel above the timeline'},
      {key: 'groups', label: film.value ? 'Scenes' : 'Sections', title: film.value ? 'The scenes' : 'The parts of the song'},
      ...(beats.value.length ? [{key: 'beats', label: 'Beats', title: 'Which beat of the story a clip belongs to'}] : []),
      {key: 'wave', label: project.value.song ? 'Song' : 'Sound', title: 'The waveform'},
      {key: 'lines', label: film.value ? 'Lines' : 'Sung', title: film.value ? 'What is said' : 'What is sung'},
      ...(castLanes.value.length
        ? [{key: 'cast', label: 'Cast', title: 'Who is in which shot - grey: in the picture, orange: sings or speaks, green: plays'}]
        : []),
    ] as {key: LaneKey; label: string; title: string}[],
)
// The beats (#761): which beat a clip belongs to. A click marks the clips of the beat (Ctrl+click: adds them), and the legend
// then offers to plan their shots again (#762). A beat without a shot plan is planned by the next plan run anyway.
const beats = computed(() => project.value.beats ?? [])
function pickBeat(event: MouseEvent, clips: string[]) {
  if (!(event.ctrlKey || event.metaKey || event.shiftKey)) marked.clear()
  const all = clips.every(id => marked.has(id))
  for (const id of clips) all && (event.ctrlKey || event.metaKey) ? marked.delete(id) : marked.add(id)
}
// The sections or scenes (#767): a click marks the clips in it, Shift+click the clips of every section of that name (all the
// choruses), Ctrl+click adds them or takes them out - for "People…" on the chorus clips only, say. A clip counts where its middle is
type Group = {id: string; label: string; start: number; end: number}
const clipsOf = (groups: Group[]) =>
  project.value.clips.filter(c => groups.some(g => (c.start + c.end) / 2 >= g.start && (c.start + c.end) / 2 < g.end)).map(c => c.id)
function pickSection(event: MouseEvent, group: Group) {
  const groups = event.shiftKey ? project.value.groups.filter(g => g.label === group.label) : [group]
  const ids = clipsOf(groups)
  if (!(event.ctrlKey || event.metaKey)) marked.clear()
  const all = ids.every(id => marked.has(id))
  for (const id of ids) all && (event.ctrlKey || event.metaKey) ? marked.delete(id) : marked.add(id)
}
const sectionMarked = (group: Group) => {
  const ids = clipsOf([group])
  return ids.length > 0 && ids.every(id => marked.has(id))
}
const beatTitle = (beat: {id: string; label: string; planned: boolean; clips: string[]}) =>
  `${beat.id}${beat.label ? `: ${beat.label}` : ''}\n${beat.planned ? '' : 'No shot plan yet: the next plan run plans it.\n'}${plural(beat.clips.length, 'clip')} - click: mark them · Ctrl+click: add or take them out`

// how tall the clips are: dragged at the top edge of the timeline, kept per viewer
const HEIGHT_KEY = 'timeline.clipHeight'
const readHeight = () => {
  try {
    return Number(localStorage.getItem(HEIGHT_KEY)) || 96
  } catch {
    return 96
  }
}
const clipHeight = ref(clamp(readHeight(), 56, 240))
const resizeDrag = usePointerDrag()
function resize(event: PointerEvent) {
  const from = event.clientY
  const before = clipHeight.value
  resizeDrag(
    e => {
      clipHeight.value = clamp(before + from - e.clientY, 56, 240)
    },
    () => {
      try {
        localStorage.setItem(HEIGHT_KEY, String(clipHeight.value))
      } catch {
        // no storage: the height holds for this page only
      }
    },
  )
}

const spoken = computed(() =>
  project.value.clips.flatMap(clip =>
    clip.lines.map((line, n) => ({
      key: `${clip.id}:${n}`,
      line,
      start: clip.start + line.at,
      length: Math.max(0.1, (line.end ?? clip.end - clip.start) - line.at),
    })),
  ),
)

function hover(event: PointerEvent) {
  const node = (event.target as HTMLElement).closest<HTMLElement>('.clip')
  const clip = node && project.value.clips.find(c => c.id === node.dataset.id)
  if (!node || !clip) {
    peek.value = undefined
    return
  }
  const box = node.getBoundingClientRect()
  peek.value = {clip, at: (clip.end - clip.start) * clamp((event.clientX - box.left) / box.width, 0, 0.999), x: event.clientX, top: box.top}
}
const pick = (event: MouseEvent, clip: EditorClip) => clickClip(event, clip)
const hidePeek = () => {
  peek.value = undefined
}
</script>

<template>
  <section class="timeline" aria-label="Timeline" :style="{'--clip-h': `${clipHeight}px`}">
    <div class="tl-resize" title="Drag to make the timeline taller or lower" @pointerdown.prevent="resize" />
    <div class="tbar">
      <TimelineLegend />
    </div>
    <div class="tbody">
      <div class="labels" aria-hidden="true">
        <div class="lane-ruler" />
        <div v-if="lanes.groups" class="lane-groups">{{ film ? 'Scenes' : 'Sections' }}</div>
        <div v-if="beats.length && lanes.beats" class="lane-beats">Beats</div>
        <div v-if="lanes.wave" class="lane-wave">{{ peaks ? (project.song ? 'Song' : 'Sound') : '' }}</div>
        <div class="lane-clips">Clips</div>
        <div v-if="lanes.lines" class="lane-lines">{{ film ? 'Lines' : 'Sung' }}</div>
        <div v-for="lane in lanes.cast ? castLanes : []" :key="lane.id" class="lane-cast" :title="lane.name">{{ lane.name }}</div>
      </div>
      <div ref="scroller" class="scroll" @scroll.passive="left = scroller!.scrollLeft" @wheel="wheel">
        <div ref="track" class="track" :style="{'--seconds': project.seconds, '--pps': pps}">
          <div class="lane lane-ruler" @pointerdown="scrub"><canvas ref="ruler" /></div>
          <div v-if="lanes.groups" class="lane lane-groups" @pointerdown="scrub">
            <div
              v-for="group in project.groups"
              :key="group.id"
              :class="['group', {marked: sectionMarked(group)}]"
              :title="`${group.label} - click: mark its clips · Shift+click: of every ${group.label} · Ctrl+click: add or take them out`"
              :style="{'--s': group.start, '--d': group.end - group.start, '--h': hues.get(group.label)}"
              @pointerdown.stop
              @click="pickSection($event, group)"
            >
              {{ group.label }}
            </div>
          </div>
          <div v-if="beats.length && lanes.beats" class="lane lane-beats" @pointerdown="scrub">
            <button
              v-for="beat in beats"
              :key="beat.id"
              :class="['beat', {unplanned: !beat.planned, marked: beat.clips.every(id => marked.has(id))}]"
              :title="beatTitle(beat)"
              :style="{'--s': beat.start, '--d': beat.end - beat.start}"
              @pointerdown.stop
              @click="pickBeat($event, beat.clips)"
            >
              <b>{{ beat.id.replace(/^beat-0*/, '') }}</b> {{ beat.label }}
            </button>
          </div>
          <div v-if="lanes.wave" class="lane lane-wave" @pointerdown="scrub"><canvas ref="wave" /></div>
          <div :class="['lane lane-clips', {dimmed: onlyFlagged}]" @pointermove="hover" @pointerleave="hidePeek">
            <ClipBlock
              v-for="clip in project.clips"
              :key="clip.id"
              :clip="clip"
              :state="stateOf(clip, fresh)"
              :selected="clip === playback.clip.value"
              :marked="marked.has(clip.id)"
              :flagged="isFlagged(clip)"
              :progress="progress?.clips[clip.id]"
              :again="!!review.review.value?.again.has(clip.id)"
              :reviewed="review.current.value?.id === clip.id"
              :roots="session.roots"
              @pick="pick($event, clip)"
            />
          </div>
          <div v-if="lanes.lines" class="lane lane-lines" @pointerdown="scrub">
            <div
              v-for="item in spoken"
              :key="item.key"
              class="spoken"
              :title="item.line.who ? `${item.line.who}: ${item.line.text}` : item.line.text"
              :style="{'--s': item.start, '--d': item.length}"
            >
              <span>{{ item.line.text }}</span>
            </div>
          </div>
          <div v-for="lane in lanes.cast ? castLanes : []" :key="lane.id" class="lane lane-cast" @pointerdown="scrub">
            <button
              v-for="s in lane.stretches"
              :key="s.key"
              :class="['cast', ...s.does]"
              :title="s.shot ? `${s.title} - click to direct this shot` : s.title"
              :style="{'--s': s.start, '--d': s.length}"
              @pointerdown.stop
              @click="s.shot && direct(s.shot)"
            />
          </div>
          <div class="playhead" />
        </div>
      </div>
    </div>
    <div class="tfoot" aria-label="View">
      <span class="muted">Show</span>
      <button
        v-for="lane in shownLanes"
        :key="lane.key"
        :class="['lane-toggle', {on: lanes[lane.key]}]"
        :aria-pressed="lanes[lane.key]"
        :title="lane.title"
        @click="lanes[lane.key] = !lanes[lane.key]"
      >
        {{ lane.label }}
      </button>
      <div class="spacer" />
      <div class="zoom">
        <button title="Show the whole video" @click="fit">Fit</button>
        <label for="zoom" class="muted">Zoom</label>
        <input id="zoom" type="range" min="0" max="100" :value="zoom" title="Ctrl + wheel over the timeline" @input="zoomed" />
      </div>
    </div>
    <ClipPeek />
  </section>
</template>
