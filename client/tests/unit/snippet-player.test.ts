import {expect, test} from 'bun:test'
import {effectScope} from 'vue'
import {useSnippetPlayer} from '../../src/composables/useSnippetPlayer'

test('audition retains the cursor on pause, resumes, changes speed and loops inside its range', async () => {
  const original = {Audio: globalThis.Audio, request: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame}
  let tick: FrameRequestCallback = () => {}
  const nodes: FakeAudio[] = []
  class FakeAudio {
    dataset: Record<string, string> = {}
    currentTime = 0
    playbackRate = 1
    preservesPitch = true
    paused = true
    ended = false
    constructor(_src: string) { nodes.push(this) }
    pause() { this.paused = true }
    async play() { this.paused = false }
  }
  globalThis.Audio = FakeAudio as unknown as typeof Audio
  globalThis.requestAnimationFrame = cb => { tick = cb; return 1 }
  globalThis.cancelAnimationFrame = () => {}
  const scope = effectScope()
  try {
    const player = scope.run(() => useSnippetPlayer(() => 'vocals.wav', cause => { throw cause }))!
    player.play('mark', 2, 5)
    nodes[0]!.currentTime = 3
    player.pause()
    expect(player.time.value).toBe(3)
    expect(nodes[0]!.paused).toBe(true)
    player.setRate(0.75)
    player.resume()
    expect(nodes[0]!.currentTime).toBe(3)
    expect(nodes[0]!.playbackRate).toBe(0.75)
    expect(nodes[0]!.preservesPitch).toBe(true)
    player.loop.value = true
    nodes[0]!.currentTime = 5.1
    tick(0)
    expect(nodes[0]!.currentTime).toBe(2)
    nodes[0]!.currentTime = 4.8
    nodes[0]!.ended = true
    player.loop.value = false
    tick(0)
    expect(player.playing.value).toBeUndefined()
    player.stop()
    expect(player.playing.value).toBeUndefined()
  } finally {
    scope.stop()
    globalThis.Audio = original.Audio
    globalThis.requestAnimationFrame = original.request
    globalThis.cancelAnimationFrame = original.cancel
  }
})
