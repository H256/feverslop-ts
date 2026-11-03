import type {EditorClip, EditorFinal, EditorFreshness, EditorProject} from '../../../../shared/workspace'
import {TERMS} from '../../lib/terms'

/** What a clip is now: not rendered, made from the plan as it is, from another plan, or left alone - or not known yet. */
export type ClipState = 'missing' | 'stale' | 'current' | 'pinned' | 'unknown'
export const stateOf = (clip: EditorClip, fresh: EditorFreshness): ClipState => !clip.video ? 'missing' : fresh.clips[clip.id] ?? 'unknown'
/** A clip to look at: not rendered, stale, or with a mark of a check. */
export const flagged = (clip: EditorClip, fresh: EditorFreshness) => !clip.video || stateOf(clip, fresh) === 'stale' || clip.marks.length > 0
export const clipAt = (project: EditorProject, t: number) => project.clips.find(c => t >= c.start && t < c.end)
/** The clips that go on from this one, one after the other: rendering it again leaves them on a frame that is gone. */
export function chain(project: EditorProject, clip: EditorClip) {
  const later: string[] = []
  for (let next = clip.next; next; next = project.clips.find(c => c.id === next)?.next) later.push(next)
  return later
}
export const STATE_CHIPS: Record<ClipState, {label: string, cls: string, title?: string}> = {
  missing: {label: 'Not rendered', cls: 'chip'},
  stale: {label: 'Stale', cls: 'chip stale', title: TERMS.Stale},
  current: {label: 'Current', cls: 'chip good', title: TERMS.Current},
  pinned: {label: 'Pinned', cls: 'chip', title: TERMS.Pinned},
  unknown: {label: 'Checking…', cls: 'chip'},
}
/** A picture to stand for a clip: its first frame, else its place, else any of its pictures that is there. */
export const standIn = (clip: EditorClip) => clip.firstFrame ?? clip.pictures.find(p => p.kind === 'location' && p.exists) ?? clip.pictures.find(p => p.exists)

/** What the monitor plays: a finished video (final:<file>), the clips, a larger variant of them (variant:<name>), or their previews. */
export type Source = string
export const finalOf = (project: EditorProject, source: Source): EditorFinal | undefined =>
  source.startsWith('final:') ? project.finals.find(f => f.file === source.slice('final:'.length)) : undefined
const refinedOf = (clip: EditorClip, source: Source) => source.startsWith('variant:') ? clip.refined.find(r => r.variant === source.slice('variant:'.length)) : undefined
/** The file a clip plays from: the variant or the preview asked for, or what there is. */
export const fileOf = (clip: EditorClip, source: Source) => refinedOf(clip, source) ?? (source === 'previews' ? clip.preview ?? clip.video : clip.video ?? clip.preview)
export const sizeOf = (item: {width?: number, height?: number}) => item.width ? `${item.width}×${item.height}` : ''
export const fpsOf = (item: {fps?: number}) => item.fps ? `${Math.round(item.fps * 100) / 100} fps` : ''

export function sourceOptions(project: EditorProject): {value: Source, label: string}[] {
  return [
    ...project.finals.map(final => ({value: `final:${final.file}`, label: [final.label, sizeOf(final), final.state === 'older' && 'older than its clips'].filter(Boolean).join(' · ')})),
    {value: 'clips', label: project.song ? 'Clips over the song' : 'Clips'},
    ...project.refinedVariants.map(variant => ({value: `variant:${variant}`, label: `Clips: ${variant}`})),
    ...(project.clips.some(c => c.preview) ? [{value: 'previews', label: 'Previews of the clips'}] : []),
  ]
}
/** Without a choice by hand: the plain final video when it is newer than its clips; all else plays what is there now, clip by clip. */
export function bestSource(project: EditorProject): Source {
  const best = project.finals.find(f => !f.preview && f.state === 'current')
  return best ? `final:${best.file}` : 'clips'
}
/** What a review goes through: the marked clips, else the flagged ones, else all - of those that are rendered. */
export function reviewList(project: EditorProject, marked: ReadonlySet<string>, fresh: EditorFreshness) {
  const clips = project.clips.filter(c => c.video)
  const picked = clips.filter(c => marked.has(c.id))
  if (picked.length) return picked
  const flaggedOnes = clips.filter(c => flagged(c, fresh))
  return flaggedOnes.length ? flaggedOnes : clips
}
