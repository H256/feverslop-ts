import {onScopeDispose, ref, shallowRef} from 'vue'

/**
 * Listening to a piece of a sound file - a line, a part of it, a word - with what plays now as `playing`, and the time it is at for a
 * playhead. One piece at a time; a second click on the playing one stops it.
 */
export function useSnippetPlayer(url: () => string | undefined, onError: (cause: unknown) => void) {
  const playing = ref<string>()
  const time = shallowRef<number>()
  const paused = ref(false)
  const rate = ref(1)
  const loop = ref(false)
  let range: {key: string, from: number, to: number} | undefined
  let audio: HTMLAudioElement | undefined
  let frame = 0
  const element = () => {
    const src = url()
    if (!src) return undefined
    if (!audio || audio.dataset.url !== src) {
      audio?.pause()
      audio = new Audio(src)
      audio.dataset.url = src
    }
    return audio
  }
  const stop = () => {
    cancelAnimationFrame(frame)
    audio?.pause()
    playing.value = undefined
    time.value = undefined
    paused.value = false
    range = undefined
  }
  const setRate = (value: number) => {
    rate.value = Math.max(0.5, Math.min(1.5, Number.isFinite(value) ? value : 1))
    if (audio) { audio.playbackRate = rate.value; audio.preservesPitch = true }
  }
  const watch = () => {
    if (!audio || !range || paused.value || !playing.value) return
    if (audio.currentTime >= range.to || audio.ended) {
      if (!loop.value) return stop()
      audio.currentTime = range.from
      if (audio.paused) audio.play().catch(cause => { stop(); onError(cause) })
    }
    time.value = audio.currentTime
    frame = requestAnimationFrame(watch)
  }
  const pause = () => {
    if (!audio || !range) return
    cancelAnimationFrame(frame)
    time.value = audio.currentTime
    audio.pause()
    paused.value = true
    playing.value = undefined
  }
  const resume = () => {
    if (!audio || !range) return
    paused.value = false
    playing.value = range.key
    audio.play().catch(cause => { stop(); onError(cause) })
    frame = requestAnimationFrame(watch)
  }
  const play = (key: string, from: number, to: number) => {
    const node = element()
    if (!node) return
    stop()
    range = {key, from: Math.max(0, from), to}
    playing.value = key
    node.currentTime = Math.max(0, from)
    time.value = node.currentTime
    setRate(rate.value)
    node.play().catch(cause => { stop(); onError(cause) })
    frame = requestAnimationFrame(watch)
  }
  /** Plays it, or stops it when it is what plays. */
  const toggle = (key: string, from: number, to: number) => playing.value === key ? stop() : play(key, from, to)
  onScopeDispose(stop)
  return {playing, time, paused, rate, loop, play, toggle, stop, pause, resume, setRate,
    position: () => audio?.currentTime ?? time.value,
    available: () => !!url()}
}
