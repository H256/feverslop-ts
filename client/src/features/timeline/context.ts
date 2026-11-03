import {defineService} from '../../services/service'
import type {ClipActions} from './useClipActions'
import type {ReviewControl} from './useReview'
import type {Timeline} from './useTimeline'

/** What the parts of the timeline page share: its state, what can be asked for, and the review. Made by TimelinePage. */
export type TimelineContext = Timeline & {actions: ClipActions, review: ReviewControl}
export const TimelineService = defineService<TimelineContext>('timeline')
export const useTimeline = TimelineService.use
