/** What the form of who is in the marked clips holds (BeatCastForm.vue): a .ts of its own, so that lint resolves it where it is used (#891). */
export type BeatCastDraft = {characters: string[]; join: {name: string; role: string}[]; without: string[]; note: string}
