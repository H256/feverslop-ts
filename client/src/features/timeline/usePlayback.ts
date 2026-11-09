import {computed, onScopeDispose, ref, shallowRef, type Ref} from 'vue'
import type {EditorClip, EditorFreshness, EditorProject} from '../../../../shared/workspace'
import {mediaUrl, type MediaRoots} from '../../api/urls'
import {clamp} from '../../lib/format'
import {TERMS} from '../../lib/terms'
import {clipAt, fileOf, finalOf, fpsOf, sizeOf, stateOf, type Source} from './clips'

export const SPEEDS = [0.25, 0.5, 1, 1.5, 2]
// Under the song a clip follows it. A jump would show, so more than a frame off is played away a little faster or slower; only what has
// grown large (a clip still loading) is a jump. Less than a frame is left alone: every change of the rate disturbs the video's clock.
const JUMP_AT = 0.2
const A_FRAME = 1 / 24
const MOST_RATE_CHANGE = 0.1

export type Loop = {from: number; to: number; label: string}
type Elements = {videos: [HTMLVideoElement, HTMLVideoElement]}

/**
 * The monitor: two video elements that take turns - the next clip loaded in advance, so that a cut is a cut and not a wait - and the
 * song under them. A final video newer than all its clips is those clips, cut and with their sound in one file: nothing can run apart in
 * it. Only without one do the clips play one by one, and a song in an element of its own under them stays some hundredths of a second
 * off. Where nothing plays the time goes on by the clock, as it does in the final video.
 *
 * Vue owns the elements; this sets their sources, times and visibility. Per frame only `t` changes.
 */
export function usePlayback(project: Ref<EditorProject>, fresh: Ref<EditorFreshness>, roots: MediaRoots) {
  const t = ref(0)
  const playing = ref(false)
  const clip = shallowRef<EditorClip>()
  const speed = ref(1)
  const loop = ref<Loop>()
  const muted = ref(false)
  const source = ref<Source>('clips')
  // what the monitor shows besides the video
  const notice = ref<string>()
  const poster = ref<string>()
  const flag = shallowRef<{text: string; title: string}>()
  // bumped when what a video element plays changes: the facts read from it are read again
  const shown = ref(0)

  const song = new Audio()
  song.preload = 'auto'
  let elements: Elements | undefined
  let active = 0
  let frame = 0
  let lastTick = 0
  const video = () => elements!.videos[active]!
  const standby = () => elements!.videos[1 - active]!
  const final = () => finalOf(project.value, source.value)
  const usesSong = () => !!project.value.song && !final()
  const setSrc = (node: HTMLMediaElement, url: string) => {
    if (node.dataset.url !== url) {
      node.dataset.url = url
      node.src = url
    }
  }

  const attach = (videos: [HTMLVideoElement, HTMLVideoElement]) => {
    elements = {videos}
    for (const node of videos)
      node.addEventListener('loadedmetadata', () => {
        shown.value++
      })
    songChanged()
  }
  /** The song of the project, when it has one: loaded once per file. */
  const songChanged = () => {
    if (project.value.song) setSrc(song, mediaUrl(project.value.song, roots))
  }

  function applySound() {
    song.muted = muted.value
    for (const node of elements?.videos ?? []) node.muted = muted.value || usesSong()
  }

  function showClip(at: EditorClip | undefined, offset: number) {
    if (!elements) return
    notice.value = undefined
    poster.value = undefined
    flag.value = undefined
    const whole = final()
    if (whole) {
      setSrc(video(), mediaUrl(whole, roots))
      video().hidden = false
      standby().hidden = true
      standby().pause()
      song.pause()
      applySound()
      if (Math.abs(video().currentTime - t.value) > 0.01) video().currentTime = t.value
      video().playbackRate = speed.value
      if (playing.value)
        video()
          .play()
          .catch(() => {})
      shown.value++
      return
    }
    const file = at && fileOf(at, source.value)
    if (!at || !file) {
      for (const node of elements.videos) {
        node.hidden = true
        node.pause()
      }
      shown.value++
      notice.value = at ? 'Not rendered' : project.value.clips.length ? 'No clip here' : 'No clips planned yet'
      const stand = at?.pictures.find(p => p.kind === 'location' && p.exists) ?? at?.pictures.find(p => p.exists)
      if (stand) poster.value = mediaUrl(stand, roots)
      return
    }
    if (file === at.preview)
      flag.value = {text: at.preview.approximate ? 'Preview - approximate' : 'Preview', title: at.preview.approximate ? TERMS.Approximate : ''}
    const url = mediaUrl(file, roots)
    if (video().dataset.url !== url && standby().dataset.url === url) {
      video().pause()
      active = 1 - active
    } else setSrc(video(), url)
    video().hidden = false
    video().playbackRate = speed.value
    standby().hidden = true
    standby().pause()
    applySound()
    if (Math.abs(video().currentTime - offset) > 0.01) video().currentTime = offset
    if (playing.value)
      video()
        .play()
        .catch(() => {})
    // the clip after this one is loaded in advance
    const following = project.value.clips[project.value.clips.indexOf(at) + 1]
    const nextFile = following && fileOf(following, source.value)
    if (nextFile) setSrc(standby(), mediaUrl(nextFile, roots))
    shown.value++
  }
  /** The same place shown again: after another source, another snapshot of the project. */
  const refresh = () => showClip(clip.value, clip.value ? t.value - clip.value.start : 0)

  function seek(to: number) {
    const target = clamp(to, 0, project.value.seconds)
    const here = clipAt(project.value, target)
    if (usesSong()) song.currentTime = target
    t.value = target
    clip.value = here
    showClip(here, here ? target - here.start : 0)
  }

  function setPlaying(on: boolean) {
    playing.value = on
    if (on) {
      if (t.value >= project.value.seconds - 0.05) seek(0)
      lastTick = performance.now()
      if (usesSong()) song.play().catch(() => setPlaying(false))
      const here = clipAt(project.value, t.value)
      if (final() || (here && fileOf(here, source.value)))
        video()
          .play()
          .catch(() => {})
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(tick)
    } else {
      cancelAnimationFrame(frame)
      song.pause()
      for (const node of elements?.videos ?? []) node.pause()
    }
  }

  function tick(now: number) {
    if (!playing.value || !elements) return
    const elapsed = (now - lastTick) / 1000
    lastTick = now
    const p = project.value
    const current = clip.value && t.value >= clip.value.start && t.value < clip.value.end ? clip.value : clipAt(p, t.value)
    let at: number
    if (final()) at = video().ended ? p.seconds : video().currentTime
    else if (usesSong()) at = song.ended ? p.seconds : song.currentTime
    else if (current && fileOf(current, source.value) && !video().hidden) at = video().ended ? current.end : current.start + video().currentTime
    else at = t.value + elapsed * speed.value

    if (loop.value && at >= loop.value.to) {
      seek(loop.value.from)
      if (usesSong() && song.paused) song.play().catch(() => {})
      if (video().paused && !video().hidden)
        video()
          .play()
          .catch(() => {})
      frame = requestAnimationFrame(tick)
      return
    }
    if (at >= p.seconds) {
      t.value = p.seconds
      setPlaying(false)
      return
    }
    const here = clipAt(p, at)
    t.value = at
    if (here !== clip.value) {
      clip.value = here
      showClip(here, here ? at - here.start : 0)
    } else if (usesSong() && here && fileOf(here, source.value)) followSong(at - here.start)
    frame = requestAnimationFrame(tick)
  }
  function followSong(wanted: number) {
    const late = wanted - video().currentTime
    if (Math.abs(late) > JUMP_AT) {
      video().currentTime = wanted
      return setRate(1)
    }
    setRate(Math.abs(late) < A_FRAME ? 1 : 1 + clamp(late, -MOST_RATE_CHANGE, MOST_RATE_CHANGE))
  }
  const setRate = (rate: number) => {
    if (Math.abs(video().playbackRate - rate * speed.value) > 0.004) video().playbackRate = rate * speed.value
  }

  function setSpeed(value: number) {
    speed.value = value
    song.playbackRate = value
    for (const node of elements?.videos ?? []) node.playbackRate = value
  }
  const changeSpeed = (direction: number) => setSpeed(SPEEDS[clamp(SPEEDS.indexOf(speed.value) + direction, 0, SPEEDS.length - 1)]!)
  const stepFrame = (direction: number) => {
    if (playing.value) setPlaying(false)
    seek(t.value + direction / project.value.fps)
  }
  /** O: the clip in a loop, Shift+O: the shot at the playhead - or the loop ended. */
  function toggleLoop(shotOnly: boolean) {
    const c = clip.value
    if (loop.value || !c) {
      loop.value = undefined
      return
    }
    if (!shotOnly) {
      loop.value = {from: c.start, to: c.end, label: c.id}
      return
    }
    const index = c.shots.findLastIndex(shot => shot.at <= t.value - c.start)
    const shot = c.shots[Math.max(0, index)]
    const end = c.shots[index + 1]?.at ?? c.end - c.start
    loop.value = {from: c.start + (shot?.at ?? 0), to: c.start + end, label: `${c.id} ${shot?.label.replace(/^\[|\]$/g, '') ?? ''}`}
  }
  /** ← →: the clip before or the next; back goes first to the start of this clip. */
  function step(direction: number) {
    const clips = project.value.clips
    if (!clips.length) return
    const index = clip.value ? clips.indexOf(clip.value) : clips.findIndex(c => c.start > t.value) - (direction > 0 ? 1 : 0)
    const target = direction < 0 && clip.value && t.value - clip.value.start > 0.5 ? index : clamp(index + direction, 0, clips.length - 1)
    seek(clips[target]!.start)
  }
  const toggleMute = () => {
    muted.value = !muted.value
    applySound()
  }
  const setSource = (value: Source) => {
    source.value = value
    if (usesSong()) song.currentTime = t.value
    else song.pause()
    refresh()
    if (playing.value) setPlaying(true)
    applySound()
  }

  /** What the monitor shows right now: read from the video itself, not from a plan. */
  const info = computed(() => {
    void shown.value
    const whole = final()
    const c = clip.value
    const file = !whole && c ? fileOf(c, source.value) : undefined
    const preview = !!file && file === c?.preview
    const node = elements && video()
    if (!node || node.hidden || (!whole && !file)) return undefined
    const size = node.videoWidth ? `${node.videoWidth}×${node.videoHeight}` : whole ? sizeOf(whole) : (c?.video?.size?.replace('x', '×') ?? '')
    const fps = whole ? fpsOf(whole) : `${project.value.fps} fps`
    const behind = whole
      ? whole.state === 'older'
        ? 'Older than its clips'
        : ''
      : c && !preview && c.video?.moved
        ? `Off by ${c.video.moved > 0 ? '+' : ''}${c.video.moved.toFixed(1)} s: rendered for another part of the song`
        : c && !preview && stateOf(c, fresh.value) === 'stale'
          ? 'Stale: made from another plan'
          : ''
    return {
      text: size ? [size, fps].filter(Boolean).join(' · ') : '',
      title: whole
        ? whole.file
        : [file?.file, preview ? 'a preview' : c?.video?.workflow, c?.video?.seed !== undefined && !preview ? `seed ${c.video.seed}` : '']
            .filter(Boolean)
            .join(' · '),
      // what is on the monitor is not what the project is now: said where one looks
      behind,
      behindTitle: whole ? 'A clip was rendered after this video was made: it does not show that clip.' : TERMS.Stale,
    }
  })

  const dispose = () => {
    cancelAnimationFrame(frame)
    song.pause()
    song.removeAttribute('src')
    for (const node of elements?.videos ?? []) node.pause()
  }
  onScopeDispose(dispose)
  return {
    t,
    playing,
    clip,
    speed,
    loop,
    muted,
    source,
    notice,
    poster,
    flag,
    info,
    attach,
    songChanged,
    seek,
    setPlaying,
    refresh,
    setSpeed,
    changeSpeed,
    stepFrame,
    toggleLoop,
    step,
    toggleMute,
    setSource,
    applySound,
    usesSong,
  }
}
export type Playback = ReturnType<typeof usePlayback>
