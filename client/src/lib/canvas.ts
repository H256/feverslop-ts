/** A canvas as wide and high as asked, sharp on a screen of any pixel ratio: its context, scaled to CSS pixels. */
export function prepareCanvas(canvas: HTMLCanvasElement, width: number, height: number) {
  const ratio = devicePixelRatio || 1
  canvas.width = Math.round(width * ratio)
  canvas.height = Math.round(height * ratio)
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  const context = canvas.getContext('2d')!
  context.scale(ratio, ratio)
  context.clearRect(0, 0, width, height)
  return context
}

/** A colour variable as the page has it now: light-dark() only means something to CSS, so an element says what it comes to. */
export function cssColor(probe: HTMLElement, name: string) {
  const before = probe.style.color
  probe.style.color = `var(${name})`
  const colour = getComputedStyle(probe).color
  probe.style.color = before
  return colour
}
export const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name)

/** The loudest of `peaks` between two of their indexes, at least the one at `from`. */
export function loudest(peaks: number[], from: number, to: number) {
  let level = 0
  for (let i = Math.floor(from); i < Math.max(Math.floor(from) + 1, to) && i < peaks.length; i++) level = Math.max(level, peaks[i]!)
  return level
}
