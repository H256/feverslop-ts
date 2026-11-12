import type {MachineCheck, NewProject} from '../../../../shared/workspace'

/** The form of a new music video: a song there is, one of the library, or one still to be made from an idea. */
export type NewProjectDraft = {
  id: string
  from: 'song' | 'library' | 'idea'
  song: string
  librarySong: string
  idea: string
  lyrics: string
  storyIdea: string
  style: string
  singers: string
  language: string
}
export const newProjectDraft = (): NewProjectDraft => ({id: '', from: 'song', song: '', librarySong: '', idea: '', lyrics: '', storyIdea: '', style: '', singers: '', language: ''})

/** What the server is asked for: only what the chosen way of the song has, empty fields left out. */
export function newProjectRequest(draft: NewProjectDraft): NewProject {
  const said = (text: string) => (text.trim() ? text : undefined)
  return {
    id: draft.id.trim(),
    ...(draft.from === 'song' ? {song: said(draft.song)} : draft.from === 'library' ? {librarySong: said(draft.librarySong)} : {idea: said(draft.idea)}),
    // a song of the library brings its own lyrics
    lyrics: draft.from === 'library' ? undefined : said(draft.lyrics),
    storyIdea: said(draft.storyIdea),
    style: said(draft.style),
    singers: said(draft.singers)?.trim(),
    language: said(draft.language)?.trim(),
  }
}

/** What is wrong with the form before it is sent - undefined when it can be. The command checks the rest. */
export function newProjectProblem(draft: NewProjectDraft): string | undefined {
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(draft.id.trim())) return 'The id: lowercase letters, digits and "-".'
  if (draft.from === 'song' && !draft.song.trim()) return 'The song file, or choose "A song to be made".'
  if (draft.from === 'song' && !draft.lyrics.trim() && !draft.storyIdea.trim()) return 'A song needs its lyrics or a story idea: the story is planned from them.'
  if (draft.from === 'idea' && !draft.idea.trim()) return 'The idea the song is made from.'
  if (draft.from === 'library' && !draft.librarySong) return 'The song of the library.'
  return undefined
}

/** The checks of the machine in the order they matter: what a run needs and lacks first. */
export const byUrgency = (checks: MachineCheck[]) => {
  const rank = {missing: 0, note: 1, ready: 2} as const
  return [...checks].sort((a, b) => rank[a.state] - rank[b.state])
}
/** In one line: "Ready", or what is missing. */
export const machineSummary = (checks: MachineCheck[]) => {
  const missing = checks.filter(check => check.state === 'missing')
  return missing.length ? `${missing.length} missing: ${missing.map(check => check.what).join(', ')}` : 'Ready'
}
