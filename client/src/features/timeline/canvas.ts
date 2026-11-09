import {cssColor, cssVar, loudest, prepareCanvas} from '../../lib/canvas'
import {clock} from '../../lib/format'

/** What part of the timeline is seen: from `left` pixels on, at `pps` pixels a second, for `seconds` in all. */
export type View = {left: number; width: number; pps: number; seconds: number}
const RULER_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600]

// the canvases stay as wide as the window of the timeline and draw what is in it: a whole song at full zoom is wider than a canvas can be
export function drawRuler(canvas: HTMLCanvasElement, view: View) {
  const g = prepareCanvas(canvas, view.width, 22)
  const step = RULER_STEPS.find(s => s * view.pps >= 70) ?? 600
  g.font = `11px ${cssVar('--mono')}`
  g.textBaseline = 'middle'
  const muted = cssColor(canvas, '--muted')
  g.fillStyle = muted
  g.strokeStyle = muted
  for (let s = Math.floor(view.left / view.pps / step) * step; s * view.pps - view.left < view.width && s <= view.seconds; s += step) {
    const x = Math.round(s * view.pps - view.left) + 0.5
    g.globalAlpha = 0.55
    g.beginPath()
    g.moveTo(x, 15)
    g.lineTo(x, 22)
    g.stroke()
    g.globalAlpha = 1
    g.fillText(clock(s, false), x + 4, 10)
  }
}

export function drawWave(canvas: HTMLCanvasElement, view: View, peaks: number[] | undefined) {
  const g = prepareCanvas(canvas, view.width, 40)
  if (!peaks) return
  g.fillStyle = cssColor(canvas, '--muted')
  g.globalAlpha = 0.75
  for (let x = 0; x < view.width; x += 2) {
    const from = ((x + view.left) / view.pps / view.seconds) * peaks.length
    const to = ((x + 2 + view.left) / view.pps / view.seconds) * peaks.length
    if (from >= peaks.length) break
    const height = Math.max(1, loudest(peaks, from, to) * 36)
    g.fillRect(x, 20 - height / 2, 1.5, height)
  }
}
