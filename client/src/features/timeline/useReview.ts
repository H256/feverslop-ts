import {computed, reactive, shallowRef} from 'vue'
import type {EditorClip} from '../../../../shared/workspace'
import {useToasts} from '../../services/toasts'
import type {ClipActions} from './useClipActions'
import type {Timeline} from './useTimeline'

type Review = {clips: EditorClip[], index: number, again: Set<string>, restore: () => void}

/**
 * Going through clips one by one, with keys: each one in a loop, fine or to be rendered again. A final video would show the clips as
 * they were when it was made, so a review plays the clips; what was there before comes back after.
 */
export function useReview(timeline: Timeline, actions: ClipActions) {
  const toasts = useToasts()
  const {playback, marked} = timeline
  const review = shallowRef<Review>()
  const current = computed(() => review.value && review.value.clips[review.value.index])

  function show() {
    const clip = current.value
    if (!clip) return
    playback.loop.value = {from: clip.start, to: clip.end, label: clip.id}
    playback.seek(clip.start)
    playback.setPlaying(true)
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
      r: () => { r.again.add(clip.id); step(1) },
      c: () => { compare().catch(toasts.fail) },
      Escape: () => end(),
    }
    const action = keys[event.key] ?? (event.key.length === 1 ? keys[event.key.toLowerCase()] : undefined)
    if (!action) return false
    event.preventDefault()
    action()
    return true
  }
  return {review, current, start, end, key}
}
export type ReviewControl = ReturnType<typeof useReview>
