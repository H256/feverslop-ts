import {formatSlotRanges} from '../assemble.ts'
import {log, styles} from '../log.ts'
import type {Renderer} from '../render.ts'
import type {Settings} from '../settings.ts'

// The pieces of the render step the music video and the film share (#1152): the servers of a run, and what is said of the clips
// made from another plan before they are put together.

/** Where a setting comes from, in the words of a run. */
export const sourceNote = (source: string) => styles.muted(`(${source === 'file' ? 'settings' : source})`)

/** The names of the ComfyUI servers, as the estimates and the failure risks count them. */
export const serverNames = (settings: Settings) => settings.comfy.map(s => s.name)

/**
 * The renderer made ready for the run: what it renders again (--refresh), the servers said - and asked first what they still hold
 * when this run puts renders away (--again, --retake, --picture-anchor) or renders stale ones again.
 */
export async function startRenderer(
    renderer: Renderer,
    settings: Settings,
    run: {refresh: Set<string>; again: boolean; retake?: unknown; pictureAnchor?: string},
) {
    renderer.refresh = run.refresh
    log.step('Servers', `${settings.comfy.map(s => `${styles.name(s.name)} ${styles.muted(s.url)}`).join(', ')} ${sourceNote(settings.sources.comfy)}`)
    if (run.again || run.refresh.size || run.retake || run.pictureAnchor) await renderer.serversFirst()
}

/** A clip made from another request than the plan has now is still a clip: said before the video is put together, an error only with --strict. */
export function sayStaleClips(stale: string[], strict: boolean) {
    if (!stale.length) return
    const message = `${stale.length} clip(s) were made from another prompt, picture or start frame than the plan has now: ${formatSlotRanges(stale)} - render them again with --render=videos --refresh=clips`
    if (strict) throw new Error(message)
    log.warn(message)
}
