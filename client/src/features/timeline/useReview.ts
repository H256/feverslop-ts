import {computed, reactive, ref, shallowRef, watch} from 'vue'
import type {EditorClip} from '../../../../shared/workspace'
import {useToasts} from '../../services/toasts'
import {reviewNext, reviewStep} from './clips'
import type {ClipActions} from './useClipActions'
import type {Timeline} from './useTimeline'

type Review = {clips: EditorClip[]; again: Set<string>; restore: () => void}

/**
 * Watching the clips through and marking the ones to render again, without stopping: Space plays, R marks the clip that is playing
 * (again: takes it back), the playback goes on. A review of some of the clips plays them one after the other and skips the rest. At
 * the end of the last one, or with Esc, what is marked is offered for rendering. O loops a clip when one wants to see it again.
 * A final video would show the clips as they were when it was made, so a review plays the clips; what was there before comes back after.
 */
// whether a review starts playing by itself: only when the viewer ticked it - nobody wants a page to start loud videos on its own
const AUTOPLAY_KEY = 'review.autoplay'
const readAutoplay = () => {
  try {
    return localStorage.getItem(AUTOPLAY_KEY) === '1'
  } catch {
    return false
  }
}

export function useReview(timeline: Timeline, actions: ClipActions) {
  const toasts = useToasts()
  const {playback, marked} = timeline
  const review = shallowRef<Review>()
  const listed = (clip: EditorClip | undefined) => (clip && review.value?.clips.find(c => c.id === clip.id)) || undefined
  /** The clip of the review at the playhead - none while the playhead is on a clip the review does not go through. */
  const current = computed(() => listed(playback.clip.value))
  /** Where the review stands: the clip's place in its list. */
  const position = computed(() => (review.value && current.value ? review.value.clips.findIndex(c => c.id === current.value!.id) : -1))
  const autoplay = ref(readAutoplay())
  const setAutoplay = (on: boolean) => {
    autoplay.value = on
    try {
      localStorage.setItem(AUTOPLAY_KEY, on ? '1' : '0')
    } catch {
      // kept for this visit only
    }
  }

  function start(clips: EditorClip[]) {
    if (!clips.length) return
    review.value = {clips, again: reactive(new Set<string>()), restore: timeline.holdSource('clips')}
    playback.loop.value = undefined
    playback.seek(clips[0]!.start)
    playback.setPlaying(autoplay.value)
  }
  function goTo(clip: EditorClip | undefined) {
    if (!clip) return
    playback.loop.value = undefined
    playback.seek(clip.start)
    if (playback.playing.value) playback.setPlaying(true)
  }

  // playing on out of a clip of the review: into the next one of its list, past the clips it does not go through - or it is through
  watch(playback.clip, (here, left) => {
    const r = review.value
    if (!r || !playback.playing.value || !listed(left) || listed(here) || playback.t.value < left!.end - 0.1) return
    const next = reviewNext(r.clips, left!)
    if (next) goTo(next)
    else end()
  })
  // the end of the whole video, played to: the review is through
  watch(playback.playing, on => {
    if (!on && review.value && playback.t.value >= timeline.project.value.seconds - 0.05) end()
  })

  /** What was gone through is decided: what stays marked is what is to be rendered - asked for right away. */
  function end() {
    const r = review.value
    if (!r) return
    review.value = undefined
    playback.loop.value = undefined
    playback.setPlaying(false)
    r.restore()
    playback.refresh()
    for (const clip of r.clips) marked.delete(clip.id)
    for (const id of r.again) marked.add(id)
    if (!r.again.size) return toasts.show('Review done')
    actions.renderMarkedNow().catch(toasts.fail)
  }
  async function compare() {
    const clip = playback.clip.value
    if (!clip) return
    const {versions} = await timeline.session.api.versions(clip.id)
    if (!versions[0] || !clip.video) return toasts.show(`${clip.id} has no older version`)
    playback.setPlaying(false)
    timeline.compared.value = {clip, version: versions[0]}
  }
  /** The keys of a review: true when the key was its own. Space, O and the others are the timeline's own, as outside a review. */
  function key(event: KeyboardEvent) {
    const r = review.value
    if (!r || event.ctrlKey || event.metaKey || event.altKey) return false
    const keys: Record<string, () => void> = {
      ArrowRight: () => goTo(reviewStep(r.clips, playback.t.value, 1)),
      ArrowLeft: () => goTo(reviewStep(r.clips, playback.t.value, -1)),
      // the clip that is playing, kept for the render at the end - or taken back; the playback goes on
      r: () => {
        const clip = playback.clip.value
        if (!clip?.video) return
        if (r.again.has(clip.id)) r.again.delete(clip.id)
        else r.again.add(clip.id)
      },
      c: () => {
        compare().catch(toasts.fail)
      },
      Escape: () => end(),
    }
    const action = keys[event.key] ?? (event.key.length === 1 ? keys[event.key.toLowerCase()] : undefined)
    if (!action) return false
    event.preventDefault()
    action()
    return true
  }
  return {review, current, position, start, end, key, autoplay, setAutoplay}
}
export type ReviewControl = ReturnType<typeof useReview>
