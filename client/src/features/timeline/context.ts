import {computed, type Ref} from 'vue'
import {defineService} from '../../services/service'
import type {ClipActions} from './useClipActions'
import type {ReviewControl} from './useReview'
import type {Compared, Timeline} from './useTimeline'

const readOnly = <T>(source: Ref<T>) => computed(() => source.value)

/**
 * What the parts of the timeline page share - narrower than the timeline itself. What the page reads from the folder (freshness,
 * status, sound, progress, versions) and what it compares are read here and changed only by the timeline; a part asks with a named
 * action. The playback is changed through its own functions. What belongs to the page's own view - the tab, the clips marked, the
 * filter, the peek - is set by its parts.
 */
export function timelineContext(timeline: Timeline, actions: ClipActions, review: ReviewControl) {
  const {fresh, status, peaks, progress, versions, compared, helpOpen, ...rest} = timeline
  return {
    ...rest,
    fresh: readOnly(fresh), status: readOnly(status), peaks: readOnly(peaks), progress: readOnly(progress),
    versions: readOnly(versions), compared: readOnly(compared),
    /** Old and new side by side. */
    compare: (what: Compared) => { compared.value = what },
    showHelp: () => { helpOpen.value = true },
    actions, review,
  }
}
export type TimelineContext = ReturnType<typeof timelineContext>
export const TimelineService = defineService<TimelineContext>('timeline')
export const useTimeline = TimelineService.use
