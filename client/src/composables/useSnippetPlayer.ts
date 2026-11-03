import {onScopeDispose, ref, shallowRef} from 'vue'

/**
 * Listening to a piece of a sound file - a line, a part of it, a word - with what plays now as `playing`, and the time it is at for a
 * playhead. One piece at a time; a second click on the playing one stops it.
 */
export function useSnippetPlayer(url: () => string | undefined, onError: (cause: unknown) => void) {
  const playing = ref<string>()
  const time = shallowRef<number>()
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
  }
  const play = (key: string, from: number, to: number) => {
    const node = element()
    if (!node) return
    stop()
    playing.value = key
    node.currentTime = Math.max(0, from)
    node.play().catch(cause => { stop(); onError(cause) })
    const watch = () => {
      if (playing.value !== key) return
      if (node.currentTime >= to || node.paused && node.currentTime > from) return stop()
      time.value = node.currentTime
      frame = requestAnimationFrame(watch)
    }
    frame = requestAnimationFrame(watch)
  }
  /** Plays it, or stops it when it is what plays. */
  const toggle = (key: string, from: number, to: number) => playing.value === key ? stop() : play(key, from, to)
  onScopeDispose(stop)
  return {playing, time, play, toggle, stop, available: () => !!url()}
}
