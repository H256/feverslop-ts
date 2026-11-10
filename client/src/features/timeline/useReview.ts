import {computed, reactive, ref, shallowRef} from 'vue'
import type {EditorClip} from '../../../../shared/workspace'
import {useToasts} from '../../services/toasts'
import type {ClipActions} from './useClipActions'
import type {Timeline} from './useTimeline'

type Review = {clips: EditorClip[]; index: number; again: Set<string>; restore: () => void}

/**
 * Going through clips one by one, with keys: each one in a loop, fine or to be rendered again. A final video would show the clips as
 * they were when it was made, so a review plays the clips; what was there before comes back after.
 */
// whether a review plays each clip by itself: only when the viewer ticked it - nobody wants a page to start loud videos on its own
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
  const current = computed(() => review.value && review.value.clips[review.value.index])
  const autoplay = ref(readAutoplay())
  const setAutoplay = (on: boolean) => {
    autoplay.value = on
    try {
      localStorage.setItem(AUTOPLAY_KEY, on ? '1' : '0')
    } catch {
      // kept for this visit only
    }
    if (on && current.value) playback.setPlaying(true)
  }

  /** The clip in a loop, from its start - played by itself only with autoplay ticked; Space plays it. */
  function show() {
    const clip = current.value
    if (!clip) return
    playback.loop.value = {from: clip.start, to: clip.end, label: clip.id}
    playback.seek(clip.start)
    playback.setPlaying(autoplay.value)
  }
  function start(clips: EditorClip[]) {
    if (!clips.length) return
    review.value = {clips, index: 0, again: reactive(new Set<string>()), restore: timeline.holdSource('clips')}
    show()
  }
  function step(direction: number) {
    const r = review.value
    if (!r) return
    const next = r.index + direction
    if (next < 0) return
    if (next >= r.clips.length) return end()
    review.value = {...r, index: next}
    show()
  }
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
    const clip = current.value
    if (!clip) return
    const {versions} = await timeline.session.api.versions(clip.id)
    if (!versions[0] || !clip.video) return toasts.show(`${clip.id} has no older version`)
    playback.setPlaying(false)
    timeline.compared.value = {clip, version: versions[0]}
  }
  /** The keys of a review: true when the key was its own. */
  function key(event: KeyboardEvent) {
    const r = review.value
    const clip = current.value
    if (!r || !clip) return false
    const keys: Record<string, () => void> = {
      Enter: () => step(1),
      ArrowRight: () => step(1),
      ArrowLeft: () => step(-1),
      // kept for the render at the end, and on to the next; R on a kept one (after ←) takes it back
      r: () => {
        if (r.again.has(clip.id)) return void r.again.delete(clip.id)
        r.again.add(clip.id)
        step(1)
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
  return {review, current, start, end, key, autoplay, setAutoplay}
}
export type ReviewControl = ReturnType<typeof useReview>
