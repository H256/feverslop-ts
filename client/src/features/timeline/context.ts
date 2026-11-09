import {computed, type Ref} from 'vue'
import {defineService} from '../../services/service'
import type {ClipActions} from './useClipActions'
import type {Playback} from './usePlayback'
import type {ReviewControl} from './useReview'
import type {Compared, Timeline} from './useTimeline'

const readOnly = <T>(source: Ref<T>) => computed(() => source.value)

/** The monitor as the parts see it: what it shows, read only, and what can be asked of it. Its sources and timers stay inside. */
function playerOf(playback: Playback) {
  return {
    t: readOnly(playback.t),
    playing: readOnly(playback.playing),
    clip: readOnly(playback.clip),
    speed: readOnly(playback.speed),
    loop: readOnly(playback.loop),
    muted: readOnly(playback.muted),
    source: readOnly(playback.source),
    notice: readOnly(playback.notice),
    poster: readOnly(playback.poster),
    flag: readOnly(playback.flag),
    info: playback.info,
    attach: playback.attach,
    applySound: playback.applySound,
    seek: playback.seek,
    setPlaying: playback.setPlaying,
    step: playback.step,
    stepFrame: playback.stepFrame,
    setSpeed: playback.setSpeed,
    changeSpeed: playback.changeSpeed,
    toggleLoop: playback.toggleLoop,
    toggleMute: playback.toggleMute,
  }
}

/**
 * What the parts of the timeline page get - named one by one, not the timeline itself. What the page reads from the folder and what
 * the monitor shows are read only and changed by the timeline; a part asks with a named action. What belongs to the page's own view -
 * the tab, the clips marked, the filter, the peek - is set by its parts. The page itself (TimelinePage) keeps the whole timeline.
 */
export function timelineContext(timeline: Timeline, actions: ClipActions, review: ReviewControl) {
  const {session} = timeline
  return {
    session: {kind: session.kind, id: session.id, root: session.root, roots: session.roots},
    project: timeline.project,
    fresh: readOnly(timeline.fresh),
    status: readOnly(timeline.status),
    peaks: readOnly(timeline.peaks),
    progress: readOnly(timeline.progress),
    versions: readOnly(timeline.versions),
    compared: readOnly(timeline.compared),
    markedClips: timeline.markedClips,
    playback: playerOf(timeline.playback),
    // the page's own view
    tab: timeline.tab,
    marked: timeline.marked,
    onlyFlagged: timeline.onlyFlagged,
    peek: timeline.peek,
    // what can be asked for
    clickClip: timeline.clickClip,
    isFlagged: timeline.isFlagged,
    markFlagged: timeline.markFlagged,
    markState: timeline.markState,
    stepFlagged: timeline.stepFlagged,
    loadVersions: timeline.loadVersions,
    pickSource: timeline.pickSource,
    /** Old and new side by side. */
    compare: (what: Compared) => {
      timeline.compared.value = what
    },
    showHelp: () => {
      timeline.helpOpen.value = true
    },
    /** A shot directed in the dialog over the page. */
    direct: (shotId: string) => {
      timeline.directing.value = shotId
    },
    actions,
    review,
  }
}
export type TimelineContext = ReturnType<typeof timelineContext>
export const TimelineService = defineService<TimelineContext>('timeline')
export const useTimeline = TimelineService.use
