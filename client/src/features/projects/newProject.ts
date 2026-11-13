import type {MachineCheck, NewProject} from '../../../../shared/workspace'

/** Who sings on screen (#939): picked from the song by the plan, nobody, or these people - `--singers=auto`, none, or the names. */
export type SingersMode = 'auto' | 'nobody' | 'names'
/** A song chosen in the form and sent to the server: its name as it was, its size - `song` holds where the server put it. */
export type SentSong = {name: string; bytes: number}

/** The form of a new music video: a song there is, one of the library, or one still to be made from an idea. */
export type NewProjectDraft = {
  /** the name the video is known by - the id is suggested from it until it is changed by hand (#939) */
  name: string
  id: string
  idChanged: boolean
  from: 'song' | 'library' | 'idea'
  /** a path on this machine, typed - or where the server put a song chosen and sent (`sent`) */
  song: string
  sent?: SentSong
  librarySong: string
  idea: string
  lyrics: string
  storyIdea: string
  style: string
  singersMode: SingersMode
  singers: string
  language: string
}
export const newProjectDraft = (): NewProjectDraft => ({
  name: '',
  id: '',
  idChanged: false,
  from: 'song',
  song: '',
  librarySong: '',
  idea: '',
  lyrics: '',
  storyIdea: '',
  style: '',
  singersMode: 'nobody',
  singers: '',
  language: '',
})

/** The id a name suggests: lowercase, digits and "-", nothing else - as `bun run init` takes it. */
export function suggestedId(name: string): string {
  return name
    .normalize('NFKD')
    // the marks NFKD takes off the letters (é → e)
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '')
}
/** What is wrong with an id, in the words of the form - a project of that id there already, or a character it cannot have. */
export function idProblem(id: string, taken: readonly string[]): string | undefined {
  const trimmed = id.trim()
  if (!trimmed) return undefined
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(trimmed)) return 'Lowercase letters, digits and "-" only, not at the start or the end - it is the folder name.'
  if (taken.includes(trimmed)) return `There is a project "${trimmed}" already - another id, or open that one.`
  return undefined
}

/** Languages to pick from - any other code can be typed. */
export const LANGUAGES = ['en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'sv', 'no', 'da', 'fi', 'pl', 'cs', 'ru', 'uk', 'tr', 'ja', 'ko', 'zh', 'ar', 'hi', 'is'] as const
/** The name of a language code in English - undefined for a code that is none. */
export function languageLabel(code: string): string | undefined {
  const trimmed = code.trim()
  if (!trimmed) return undefined
  try {
    const name = new Intl.DisplayNames(['en'], {type: 'language', fallback: 'none'}).of(trimmed)
    return name && name.toLowerCase() !== trimmed.toLowerCase() ? name : undefined
  } catch {
    return undefined
  }
}

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
    // the same as before: --singers=auto, the names, or nothing - nobody
    singers: draft.singersMode === 'auto' ? 'auto' : draft.singersMode === 'names' ? said(draft.singers)?.trim() : undefined,
    language: said(draft.language)?.trim(),
  }
}

/** What is wrong with the form before it is sent - undefined when it can be. The command checks the rest. */
export function newProjectProblem(draft: NewProjectDraft, taken: readonly string[] = []): string | undefined {
  if (!draft.id.trim()) return 'The id: a name for it, or the id itself.'
  const id = idProblem(draft.id, taken)
  if (id) return `The id: ${id}`
  if (draft.from === 'song' && !draft.song.trim()) return 'The song: choose its file, or type where it is - or choose "A song to be made".'
  if (draft.from === 'song' && !draft.lyrics.trim() && !draft.storyIdea.trim()) return 'A song needs its lyrics or a story idea: the story is planned from them.'
  if (draft.from === 'idea' && !draft.idea.trim()) return 'The idea the song is made from.'
  if (draft.from === 'library' && !draft.librarySong) return 'The song of the library.'
  if (draft.singersMode === 'names' && !draft.singers.trim()) return 'Who sings: their names, or another choice.'
  if (draft.language.trim() && !languageLabel(draft.language)) return `The language: "${draft.language.trim()}" is no language code - like en or de.`
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
