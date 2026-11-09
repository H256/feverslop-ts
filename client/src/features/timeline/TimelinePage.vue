<script setup lang="ts">
import {onMounted, onScopeDispose, ref, watch} from 'vue'
import {useRoute, useRouter} from 'vue-router'
import {TOP_CHIPS} from '../../services/chrome'
import {useRunDock} from '../../services/run'
import {useToasts} from '../../services/toasts'
import CompareDialog from './CompareDialog.vue'
import {TimelineService, timelineContext} from './context'
import FailBar from './FailBar.vue'
import HelpDialog from './HelpDialog.vue'
import ShotDirector from '../direction/ShotDirector.vue'
import ClipInspector from './inspector/ClipInspector.vue'
import PlayerMonitor from './PlayerMonitor.vue'
import SummaryChips from './SummaryChips.vue'
import TimelineTracks from './TimelineTracks.vue'
import {useClipActions} from './useClipActions'
import {useReview} from './useReview'
import {createTimeline} from './useTimeline'

/** The timeline, where it all comes together: the monitor, the clip at the playhead, the tracks - and what is rendered from here. */
const timeline = createTimeline()
const actions = useClipActions(timeline)
const review = useReview(timeline, actions)
TimelineService.provide(timelineContext(timeline, actions, review))
// the page keeps the whole timeline; its parts get the narrower context
const {project, playback, session} = timeline
const run = useRunDock()
const toasts = useToasts()
const route = useRoute(), router = useRouter()
const monitor = ref<InstanceType<typeof PlayerMonitor>>()
onScopeDispose(timeline.dispose)

// what a run made is read again; a render of clips that were there before is looked at against what was there
run.onEnd((current, action) => {
  void session.reload().then(() => actions.afterRender(current, action, review.start)).catch(toasts.fail)
})

const linked = () => project.value.clips.find(c => c.id === route.hash.slice(1))
onMounted(() => {
  timeline.chooseSource()
  playback.applySound()
  // a link to a clip opens it
  playback.seek((linked() ?? project.value.clips[0])?.start ?? 0)
  void timeline.loadAround()
})
// the clip at the playhead is in the address, and a clip put into the address (a link, back, forward) is gone to
watch(playback.clip, clip => { if (clip && route.hash !== `#${clip.id}`) void router.replace({hash: `#${clip.id}`}) })
watch(() => route.hash, () => {
  const clip = linked()
  if (clip && clip.id !== playback.clip.value?.id) playback.seek(clip.start)
})

const KEYS: Record<string, () => void> = {
  ' ': () => playback.setPlaying(!playback.playing.value),
  k: () => { playback.setPlaying(false); playback.setSpeed(1) },
  j: () => playback.changeSpeed(-1),
  l: () => playback.changeSpeed(1),
  ',': () => playback.stepFrame(-1),
  '.': () => playback.stepFrame(1),
  o: () => playback.toggleLoop(false),
  O: () => playback.toggleLoop(true),
  f: () => monitor.value?.toggleFullscreen(),
  '?': () => { timeline.helpOpen.value = true },
  ArrowLeft: () => playback.step(-1),
  ArrowRight: () => playback.step(1),
  Home: () => playback.seek(0),
  End: () => playback.seek(project.value.seconds - 0.01),
  m: () => playback.toggleMute(),
  // asked first, as the button of the clip: what it costs, what goes on from it
  r: () => { const clip = playback.clip.value; if (clip) actions.renderAgain(clip).catch(toasts.fail) },
}
function key(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  if (target?.matches?.('input, select, textarea') || document.querySelector('dialog[open]')) return
  if (review.key(event)) return
  // the help names the keys in capitals: a key is the same with Shift or Caps Lock - but Shift+O, which is a key of its own
  const action = KEYS[event.key] ?? (event.key.length === 1 ? KEYS[event.key.toLowerCase()] : undefined)
  if (!action || event.ctrlKey || event.metaKey || event.altKey) return
  event.preventDefault()
  action()
}
addEventListener('keydown', key)
onScopeDispose(() => removeEventListener('keydown', key))
const closeCompare = () => { timeline.compared.value = undefined }
const closeHelp = () => { timeline.helpOpen.value = false }
</script>

<template>
  <Teleport :to="TOP_CHIPS" defer><SummaryChips /></Teleport>
  <div class="timeline-view view">
    <main class="work">
      <PlayerMonitor ref="monitor" />
      <ClipInspector />
    </main>
    <FailBar />
    <TimelineTracks />
  </div>
  <CompareDialog v-if="timeline.compared.value" :key="timeline.compared.value.version.video" :compared="timeline.compared.value" @close="closeCompare" />
  <HelpDialog v-if="timeline.helpOpen.value" @close="closeHelp" />
  <ShotDirector v-if="timeline.directing.value" :key="timeline.directing.value" :shot-id="timeline.directing.value" @close="timeline.directing.value = undefined" />
</template>
