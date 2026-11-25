import type {EditorClip, EditorFreshness, EditorPicture, EditorProject} from '../../../../shared/workspace'
import {stateOf} from './clips'

/**
 * The storyboard (#1194): the clips as large cards, in rows under their beat - or under their section or scene where the project has
 * no beats. A row says how many of its clips are rendered and current, and how long it is.
 */
export type BoardRow = {id: string; label: string; text?: string; clips: EditorClip[]; seconds: number; done: number}

const middle = (clip: EditorClip) => (clip.start + clip.end) / 2

export function boardRows(project: EditorProject, fresh: EditorFreshness): BoardRow[] {
  const byId = new Map(project.clips.map(c => [c.id, c]))
  // a beat's label is what happens in it, a sentence: the row is named by its number, the sentence goes under it
  const spans: {id: string; label: string; text?: string; clips: EditorClip[]}[] = project.beats?.length
    ? project.beats.map((b, i) => ({
        id: b.id,
        label: `Beat ${i + 1}`,
        text: b.label,
        clips: b.clips.map(id => byId.get(id)).filter((c): c is EditorClip => !!c),
      }))
    : project.groups.map(g => ({id: g.id, label: g.label, clips: project.clips.filter(c => middle(c) >= g.start && middle(c) < g.end)}))
  // a clip no beat or section holds still gets a row: nothing of the plan is left off the board
  const held = new Set(spans.flatMap(s => s.clips.map(c => c.id)))
  const loose = project.clips.filter(c => !held.has(c.id))
  if (loose.length) spans.push({id: 'other', label: 'Other clips', clips: loose})
  return spans
    .filter(s => s.clips.length)
    .map(s => ({
      ...s,
      seconds: s.clips.reduce((sum, c) => sum + c.end - c.start, 0),
      done: s.clips.filter(c => ['current', 'pinned'].includes(stateOf(c, fresh))).length,
    }))
}

/** Who is in a clip, one chip per person or group with their picture: the places, props and frames are not cast. */
export function castOf(clip: EditorClip): EditorPicture[] {
  const seen = new Set<string>()
  return clip.pictures.filter(p => {
    if (!p.exists || ['location', 'frame', 'prop'].includes(p.kind) || seen.has(p.name)) return false
    seen.add(p.name)
    return true
  })
}

/** What a card says happens: the first shot's action, else the beat or scene. */
export const intentOf = (clip: EditorClip) => clip.shots[0]?.action || clip.context.text || clip.context.label
