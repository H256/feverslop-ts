import type {Freshness} from '../../../shared/workspace'

export const FRESH_LABEL: Record<Freshness, string> = {current: 'Current', stale: 'Stale', pinned: 'Pinned'}
/** The words of the pipeline, where they appear and on the help page. */
export const TERMS = {
  Current: 'Made from the request the plan has now.',
  Stale: 'Made from another prompt, picture or start frame than the plan has now. It still is a usable file: it is only rendered again when you ask.',
  Pinned: 'Your own file, an edited prompt, or made before these checks. The pipeline leaves it alone and does not compare it.',
  Anchor: 'The one picture a person or place starts from. The views of the sheet are drawn from it.',
  Sheet: 'The reference picture of a person or place: several views of it, made from a short video that starts on the anchor.',
  Approximate: 'A preview that starts on the last frame of the preview before it, not of the real clip. It shows the idea, not the exact start.',
  'Goes on': 'The clip starts on the last frame of the clip before. Rendering that one again leaves this one on a picture that is gone.',
  Take: 'Projects whose names differ only by a date or an ending, folded together on the start page.',
} as const
/** A colour per section, scene or singer, the same one wherever it comes back. */
export const HUES = [25, 255, 145, 320, 80, 200, 0, 290]
export const hueAt = (n: number) => HUES[n % HUES.length]!
