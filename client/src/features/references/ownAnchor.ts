/** The user's own picture as the anchor of a reference picture, as the question fills it in: the picture, the prompt kept with it, the description. */
export type OwnAnchor = {file?: File; prompt: string; how: 'keep' | 'text' | 'describe'; description: string}

// what the server takes (lib/editor/upload.ts): checked there again, by its first bytes
export const OWN_ANCHOR_TYPES = 'image/png,image/jpeg,image/webp'
export const OWN_ANCHOR_MAX_MB = 50

/** What is wrong with the draft before it is sent, if anything. */
export function ownAnchorProblem(draft: OwnAnchor): string | undefined {
  if (!draft.file) return 'Pick a picture first'
  if (draft.file.size > OWN_ANCHOR_MAX_MB * 1024 * 1024) return `The picture is too large - at most ${OWN_ANCHOR_MAX_MB} MB`
  if (draft.how === 'text' && !draft.description.trim()) return 'Write the description, or keep the one there is'
  return undefined
}

/** The form the server takes it as, with the render servers chosen in the question. */
export function ownAnchorForm(draft: OwnAnchor, servers: string[] | undefined) {
  const form = new FormData()
  form.set('picture', draft.file ?? '')
  form.set('prompt', draft.prompt)
  if (draft.how === 'text') form.set('description', draft.description)
  if (draft.how === 'describe') form.set('describe', 'true')
  if (servers) form.set('servers', JSON.stringify(servers))
  return form
}
