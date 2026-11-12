import type {NewFilm} from '../../../../shared/workspace'

/** The form of a new film (#831): a story idea to write it from, or a screenplay to adopt - the options of `bun run film:init`. */
export type NewFilmDraft = {id: string; from: 'idea' | 'screenplay'; text: string; style: string; length: string; language: string}
export const newFilmDraft = (): NewFilmDraft => ({id: '', from: 'idea', text: '', style: '', length: '', language: ''})

/** What the server is asked for: only what the chosen way has, empty fields left out. */
export function newFilmRequest(draft: NewFilmDraft): NewFilm {
  const said = (text: string) => (text.trim() ? text.trim() : undefined)
  return {
    id: draft.id.trim(),
    ...(draft.from === 'idea' ? {idea: said(draft.text)} : {screenplay: said(draft.text)}),
    style: said(draft.style),
    length: said(draft.length),
    // a screenplay keeps the language it is written in
    language: draft.from === 'idea' ? said(draft.language) : undefined,
  }
}

/** What is wrong with the form before it is sent - undefined when it can be. The command checks the rest. */
export function newFilmProblem(draft: NewFilmDraft): string | undefined {
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(draft.id.trim())) return 'The id: lowercase letters, digits and "-".'
  if (!draft.text.trim()) return draft.from === 'idea' ? 'The story idea the film is written from.' : 'The screenplay, or the path of its file.'
  return undefined
}
